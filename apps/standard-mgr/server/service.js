/**
 * Standard Mgr Service - 标准管理核心服务
 *
 * === 唯一写入口 ===
 * `writeAnchorResult()` 是本模块中所有引用记录写入的唯一入口。
 * 三个调用方（清洗 agent 工具、回填流程、人工修正 handler）共用此方法。
 *
 * === 幂等键 ===
 * UNIQUE (source_revision_id, source_outline_id, occurrence_index)
 *
 * === 企业隔离（R2-4 过渡策略） ===
 * 企业对象与企业成员关系尚未建立。当前阶段：
 * - 忽略一切客户端/请求传入的 enterprise_id
 * - 查询不过滤（全部返回），写路径标准必须已在 app_standard 中存在
 * - 公共标准库：enterprise_id IS NULL；企业标准：留待企业表建立后迁移
 *
 * === 状态管理 ===
 * 使用"status 列 + 常量 + 单点转换函数"模式，不引入状态机引擎。
 */

import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';
import jwt from 'jsonwebtoken';
import DocAccessService from '../../../lib/doc-access-service.js';
import { Op } from 'sequelize';

// R18-2: 清洗总超时 15→30 分钟（长标准 + 读写交替策略下 15 分钟偏紧）
const CLEAN_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const TASK_TOKEN_EXPIRY = '4h'; // 后台任务 token 有效期（需长于清洗超时）

// ============================================================
// 常量
// ============================================================

/** 引用记录状态 */
export const REF_STATUS = {
  VALID: 'valid',
  SUSPECTED: 'suspected',
  GAP: 'gap',
  INVALID: 'invalid',
};

/** 引用记录来源 */
export const REF_SOURCE = {
  AUTO: 'auto',
  USER_CONFIRMED: 'user_confirmed',
  MANUAL: 'manual',
  AUTO_BACKFILL: 'auto_backfill',
};

/** 锚点构建状态 */
export const ANCHOR_BUILD_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

/** 引用类型 */
export const REF_TYPE = {
  EXPLICIT: 'explicit',
  IMPLICIT: 'implicit',
};

/**
 * 锚点格式匹配正则（R2-5）
 *
 * 匹配锚点标签 <docid+revid> 或 <docid+revid+outlineid>
 * 其中各部分均为非空、不含尖括号和加号的字符串。
 */
const ANCHOR_PATTERN = /<[^<>+]+\+[^<>+]+(?:\+[^<>]+)?>/g;

/**
 * 人工来源集合（用于统计人工修正次数和最后修正人/时间）
 */
const MANUAL_SOURCES = new Set([REF_SOURCE.MANUAL, REF_SOURCE.USER_CONFIRMED]);

/**
 * 判断一个状态转换是否合法
 *
 * 规则（R3-1 修正，R3-7 收口）：
 * - 新建记录：任意来源可写任意状态（保护对象是已有记录，不是新建记录）
 * - 人工来源（manual/user_confirmed）：可覆盖任何状态
 * - auto_backfill：仅允许 gap 记录或状态不变（R4-3 PM 决策：回填输入域只有 gap）
 * - invalid → *：仅人工/auto_backfill
 * - valid → *：auto 不允许改写（版本冻结）
 * - suspected → valid：auto 不允许（需人工确认）
 * - 其余 transition：auto 来源允许（gap↔suspected, suspected→invalid 等）
 *
 * @param {string|null} fromStatus - 当前状态（null=新建）
 * @param {string} toStatus - 目标状态
 * @param {string} source - 来源类型
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateStatusTransition(fromStatus, toStatus, source) {
  // R3-1：新建记录任意来源可写任意状态
  // 保护对象是"已有记录的稳定性"（版本冻结），不是"新建记录的纯洁性"
  // auto 必须能落 gap/suspected/invalid，否则治理体系无数据
  if (!fromStatus) {
    return { allowed: true };
  }

  // 状态不变：始终允许
  if (fromStatus === toStatus) return { allowed: true };

  // 人工来源可以覆盖任何状态
  if (MANUAL_SOURCES.has(source)) return { allowed: true };

  // auto_backfill 仅允许 gap 记录或状态不变（R4-3 PM 决策：回填输入域只有 gap）
  // 不得改写 valid（人工确认过的）/ invalid（人工判定错误）/ suspected（首洗标记）
  if (source === REF_SOURCE.AUTO_BACKFILL) {
    if (fromStatus === REF_STATUS.GAP || fromStatus === toStatus) return { allowed: true };
    return {
      allowed: false,
      reason: `auto_backfill can only operate on 'gap' records (current: ${fromStatus}).`,
    };
  }

  // invalid → 任何状态：只有人工/auto_backfill 来源允许（已在上方覆盖）
  if (fromStatus === REF_STATUS.INVALID) {
    return {
      allowed: false,
      reason: `Only manual/auto_backfill sources can move a record out of 'invalid'. Source '${source}' is not allowed.`,
    };
  }

  // valid → 任何改变：auto 不允许改写已有 valid 记录（版本冻结）
  if (fromStatus === REF_STATUS.VALID && toStatus !== REF_STATUS.VALID) {
    return {
      allowed: false,
      reason: `Auto source cannot change a 'valid' record. Only manual/user_confirmed/auto_backfill can override.`,
    };
  }

  // suspected → valid：auto 不允许（需人工确认），auto_backfill/人工 已在上面放行
  if (fromStatus === REF_STATUS.SUSPECTED && toStatus === REF_STATUS.VALID) {
    return {
      allowed: false,
      reason: `Auto source cannot confirm a 'suspected' record to 'valid'. Manual review or auto_backfill required.`,
    };
  }

  // 其余 transition：auto 来源允许（gap↔suspected, suspected→invalid 等）
  return { allowed: true };
}

/**
 * R15-2：归一化 source_text 用于去重比较。
 * 去掉常见前缀（"本标准""国标""标准"）、空格、标点符号，统一大小写。
 * 使 "本标准3.10.2条规定的高温试验" 和 "3.10.2条规定的高温试验" 归一到同一字符串。
 */
function _normalizeSourceText(text) {
  if (!text) return '';
  return text
    .replace(/^本标准/g, '')
    .replace(/^本规范/g, '')
    .replace(/^标准/g, '')
    .replace(/[\s,，。．.、/\\-]+/g, '')
    .replace(/^应符合/g, '')
    .replace(/^按/g, '')
    .replace(/^见/g, '')
    .toLowerCase();
}

class StandardMgrService {
  constructor(db) {
    this.db = db;
    this.docAccessService = new DocAccessService(db);
  }

  // ============================================================
  // R15-6: deleteAutoRefAnchors — 清洗前置删除 auto 记录
  // ============================================================

  /**
   * 删除指定标准/版本的 auto + auto_backfill 引用记录。
   * manual / user_confirmed 记录永久保留。
   *
   * @param {string} standardId
   * @param {string} revisionId - 限定版本范围（source_revision_id）
   * @returns {Promise<number>} 删除条数
   */
  async deleteAutoRefAnchors(standardId, revisionId) {
    const RefAnchor = this._refAnchor();
    const deleted = await RefAnchor.destroy({
      where: {
        standard_id: standardId,
        source_revision_id: revisionId,
        source: [REF_SOURCE.AUTO, REF_SOURCE.AUTO_BACKFILL],
      },
    });
    logger.info(
      `[standard-mgr] deleteAutoRefAnchors: standard=${standardId} revision=${revisionId} ` +
      `deleted=${deleted} rows`
    );
    return deleted;
  }

  // ============================================================
  // 模型引用
  // ============================================================

  _appStandard() { return this.db.getModel('app_standard'); }
  _refAnchor() { return this.db.getModel('app_standard_ref_anchor'); }
  _anchoredSection() { return this.db.getModel('app_standard_anchored_section'); }
  _enterprise() { return this.db.getModel('app_enterprise'); }

  // ============================================================
  // P1-2: writeAnchorResult — 唯一写入口
  // ============================================================

  /**
   * R15-2：在同 outline 中查找语义匹配的已有记录。
   *
   * 判定逻辑：
   * 1. 遍历同 outline 下全部已有记录
   * 2. 若已有记录有 target_outline_id（内部引用/已定位 valid）且与新 target 相同 → 匹配
   * 3. 若已有记录的归一化 source_text 包含新 source_text 或被新 source_text 包含 → 匹配
   *
   * 仅匹配一条（最相似），无匹配返回 null。
   */
  async _findDedupCandidate(RefAnchor, source_revision_id, source_outline_id, source_text, target_outline_id, tx) {
    const allExisting = await RefAnchor.findAll({
      where: { source_revision_id, source_outline_id },
      order: [['occurrence_index', 'ASC']],
      transaction: tx,
      raw: true,
    });
    if (!allExisting.length) return null;

    const normNew = _normalizeSourceText(source_text);

    for (const rec of allExisting) {
      // 同 target（内部引用/已定位 valid）
      if (target_outline_id && rec.target_outline_id && target_outline_id === rec.target_outline_id) {
        return rec;
      }
      // 归一化 source_text 互相包含
      const normOld = _normalizeSourceText(rec.source_text);
      if (normNew && normOld) {
        if (normNew.includes(normOld) || normOld.includes(normNew)) {
          return rec;
        }
      }
    }
    return null;
  }

  /**
   * 写入一个引用的完整判断结果
   *
   * 幂等键：(source_revision_id, source_outline_id, occurrence_index)
   * 同事务写：引用记录 + 带锚点副本 + 标准汇总计数
   *
   * R2-4：忽略客户端传入的 enterprise_id（过渡策略）
   * R2-5：修复 anchor_count、双重 rollback、人工治理字段
   * R2-9：状态转换校验改为真实规则
   *
   * @param {object} params
   * @param {string} params.standard_id - 标准 ID（app_standard.id）
   * @param {string} params.source_revision_id - 来源 revision ID
   * @param {string} params.source_outline_id - 来源 outline ID
   * @param {number} params.occurrence_index - 同 section 内出现序号（从 0 开始）
   * @param {string} params.source_text - 原始引用文本
   * @param {string} [params.context_text] - 引用上下文文本
   * @param {string} params.ref_type - 引用类型：explicit | implicit
   * @param {string} params.status - 引用状态：valid | suspected | gap | invalid
   * @param {string} params.source - 来源：auto | user_confirmed | manual | auto_backfill
   * @param {string} [params.target_document_id] - 目标文档 ID
   * @param {string} [params.target_revision_id] - 目标 revision ID
   * @param {string} [params.target_outline_id] - 目标 outline ID
   * @param {object} [params.candidates_json] - 候选列表 JSON
   * @param {string} [params.status_reason] - 状态原因说明
   * @param {string} [params.anchored_text] - 带锚点副本的文本（如有）
   * @param {string} [params.source_text_hash] - 来源文本 hash
   * @param {string} [params.user_id] - 操作用户 ID（人工修正时传入）
   * @returns {Promise<object>} { ref_anchor, anchored_section, standard }
   */
  async writeAnchorResult(params) {
    const {
      standard_id,
      source_revision_id,
      source_outline_id,
      occurrence_index,
      source_text,
      context_text = null,
      ref_type,
      status,
      source,
      target_document_id = null,
      target_revision_id = null,
      target_outline_id = null,
      candidates_json = null,
      status_reason = null,
      anchored_text = null,
      source_text_hash = null,
      user_id = null,
    } = params;

    // ---- 参数校验 ----
    if (!standard_id) throw new Error('standard_id is required');
    if (!source_revision_id) throw new Error('source_revision_id is required');
    if (!source_outline_id) throw new Error('source_outline_id is required');
    if (occurrence_index == null || occurrence_index < 0) throw new Error('occurrence_index is required (>= 0)');
    if (!source_text) throw new Error('source_text is required');
    if (!ref_type || ![REF_TYPE.EXPLICIT, REF_TYPE.IMPLICIT].includes(ref_type)) {
      throw new Error(`Invalid ref_type: ${ref_type}`);
    }
    if (!status || ![REF_STATUS.VALID, REF_STATUS.SUSPECTED, REF_STATUS.GAP, REF_STATUS.INVALID].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    if (!source || ![REF_SOURCE.AUTO, REF_SOURCE.USER_CONFIRMED, REF_SOURCE.MANUAL, REF_SOURCE.AUTO_BACKFILL].includes(source)) {
      throw new Error(`Invalid source: ${source}`);
    }

    // ---- 标准存在性校验 ----
    const AppStandard = this._appStandard();
    const standard = await AppStandard.findByPk(standard_id, { raw: true });
    if (!standard) throw new Error(`Standard not found: ${standard_id}`);

    // R2-4 过渡策略：忽略客户端传入的 enterprise_id
    // 仅校验 standard 实际存在，不校验企业归属（企业映射尚未建立）

    // R2-8/N8：目标文档权限校验从 warn 升级为阻断
    if (target_document_id && user_id) {
      const canRead = await this.docAccessService.canRead(target_document_id, user_id);
      if (!canRead) {
        throw new Error(`User ${user_id} does not have read access to target document ${target_document_id}`);
      }
    }

    // R15：source_outline_id 有效性校验 —— 防止 Agent 编造不存在的 ID
    const DocOutline = this.db.getModel('document_outline');
    const outlineExists = await DocOutline.findByPk(source_outline_id, { attributes: ['id'], raw: true });
    if (!outlineExists) {
      throw new Error(`source_outline_id "${source_outline_id}" 不存在，请从 list_revision_sections 返回值中逐字复制 outline_id，禁止自行编造`);
    }

    // ---- 事务写入 ----
    const tx = await this.db.sequelize.transaction();
    try {
      const RefAnchor = this._refAnchor();
      const AnchoredSection = this._anchoredSection();

      // 1. 查找现有记录（幂等键）
      let effectiveIndex = occurrence_index;
      let existing = await RefAnchor.findOne({
        where: { source_revision_id, source_outline_id, occurrence_index: effectiveIndex },
        transaction: tx,
      });

      let refAnchor;
      if (existing) {
        // 索引冲突检测：同一槽位被不同引用占用
        if (existing.source_text !== source_text) {
          // R15-2：语义去重检查（同 outline + 同 target 或归一化同义 source_text → 更新原记录）
          const dedupMatch = await this._findDedupCandidate(
            RefAnchor, source_revision_id, source_outline_id,
            source_text, target_outline_id, tx
          );
          if (dedupMatch) {
            logger.info(
              `[standard-mgr] writeAnchorResult: semantic dedup merged ` +
              `(outline=${source_outline_id}, dedupWith=#${dedupMatch.occurrence_index} "${dedupMatch.source_text.substring(0,30)}", ` +
              `new="${source_text.substring(0,30)}")`
            );
            existing = dedupMatch;
          } else {
            // 无匹配 → 自动跳到 max+1
            const maxRow = await RefAnchor.findOne({
              where: { source_revision_id, source_outline_id },
              attributes: ['occurrence_index'],
              order: [['occurrence_index', 'DESC']],
              transaction: tx,
            });
            effectiveIndex = (maxRow?.occurrence_index ?? -1) + 1;
            logger.info(
              `[standard-mgr] writeAnchorResult: occurrence_index conflict detected ` +
              `(outline=${source_outline_id}, existing #${occurrence_index}="${existing.source_text.substring(0,30)}", ` +
              `new="${source_text.substring(0,30)}") → auto-bumped to #${effectiveIndex}`
            );
            // 确认新槽位不冲突（理论上不会，但做防御性检查）
            const newSlotExisting = await RefAnchor.findOne({
              where: { source_revision_id, source_outline_id, occurrence_index: effectiveIndex },
              transaction: tx,
            });
            if (newSlotExisting && newSlotExisting.source_text !== source_text) {
              throw new Error(
                `occurrence_index conflict after auto-bump: slot #${effectiveIndex} also occupied by different reference`
              );
            }
            if (newSlotExisting) {
              // 新槽位已有同 source_text 的记录 → 按更新逻辑继续
              existing = newSlotExisting;
            } else {
              existing = null;
            }
          }
        }
      }

      if (existing) {
        // R2-9：状态转换校验（真实规则）
        const transition = validateStatusTransition(existing.status, status, source);
        if (!transition.allowed) {
          throw new Error(
            `Invalid status transition for ref_anchor ${existing.id}: ${transition.reason}`
          );
        }

        await existing.update({
          standard_id,
          source_text,
          context_text,
          ref_type,
          status,
          source,
          target_document_id,
          target_revision_id,
          target_outline_id,
          candidates_json,
          status_reason,
          updated_at: new Date(),
        }, { transaction: tx });
        refAnchor = existing;
      } else {
        // R2-9：新建记录状态合法性校验
        const transition = validateStatusTransition(null, status, source);
        if (!transition.allowed) {
          throw new Error(`Cannot create ref_anchor: ${transition.reason}`);
        }

        refAnchor = await RefAnchor.create({
          id: Utils.newID(),
          standard_id,
          source_revision_id,
          source_outline_id,
          occurrence_index: effectiveIndex,
          source_text,
          context_text,
          ref_type,
          status,
          source,
          target_document_id,
          target_revision_id,
          target_outline_id,
          candidates_json,
          status_reason,
          retry_count: 0,
          created_by: user_id,
        }, { transaction: tx });
      }

      // 2. 写入/更新带锚点副本
      // R2-5：anchor_count 使用真实锚点正则 ANCHOR_PATTERN
      let anchoredSection = null;
      if (anchored_text != null) {
        const anchorCount = (anchored_text.match(ANCHOR_PATTERN) || []).length;

        const existingSection = await AnchoredSection.findOne({
          where: { revision_id: source_revision_id, outline_id: source_outline_id },
          transaction: tx,
        });

        if (existingSection) {
          await existingSection.update({
            anchored_text,
            source_text_hash,
            anchor_count: anchorCount,
            updated_at: new Date(),
          }, { transaction: tx });
          anchoredSection = existingSection;
        } else {
          anchoredSection = await AnchoredSection.create({
            id: Utils.newID(),
            standard_id,
            revision_id: source_revision_id,
            outline_id: source_outline_id,
            anchored_text,
            source_text_hash,
            anchor_count: anchorCount,
          }, { transaction: tx });
        }
      }

      // 3. 更新标准汇总计数（R2-5：同时更新人工治理字段）
      await this._refreshStandardCounts(standard_id, tx, source, user_id);

      await tx.commit();

      // 重新读取以获取最新状态
      const updatedStandard = await AppStandard.findByPk(standard_id, { raw: true });

      return {
        ref_anchor: refAnchor.toJSON ? refAnchor.toJSON() : refAnchor,
        anchored_section: anchoredSection ? (anchoredSection.toJSON ? anchoredSection.toJSON() : anchoredSection) : null,
        standard: updatedStandard,
      };
    } catch (error) {
      // R2-5：统一在 catch 中 rollback，不在内部提前 rollback
      await tx.rollback();
      throw error;
    }
  }

  /**
   * 刷新标准的汇总计数
   *
   * R2-5：当本次写入为人工来源时同步更新 last_manual_fix_at / last_manual_fix_by。
   * 对于 _refreshStandardCounts 的批量重建场景（source=null），按存量数据统计。
   *
   * @param {string} standardId
   * @param {object} transaction
   * @param {string|null} source - 本次写入的来源（null=批量重建，不清零治理时间）
   * @param {string|null} userId - 本次操作人
   */
  async _refreshStandardCounts(standardId, transaction, source = null, userId = null) {
    const RefAnchor = this._refAnchor();
    const AppStandard = this._appStandard();

    const counts = await RefAnchor.findAll({
      where: { standard_id: standardId },
      attributes: [
        [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'total'],
        [this.db.sequelize.fn('SUM', this.db.sequelize.literal(`CASE WHEN status = '${REF_STATUS.VALID}' THEN 1 ELSE 0 END`)), 'valid'],
        [this.db.sequelize.fn('SUM', this.db.sequelize.literal(`CASE WHEN status = '${REF_STATUS.SUSPECTED}' THEN 1 ELSE 0 END`)), 'suspected'],
        [this.db.sequelize.fn('SUM', this.db.sequelize.literal(`CASE WHEN status = '${REF_STATUS.GAP}' THEN 1 ELSE 0 END`)), 'gap'],
        [this.db.sequelize.fn('SUM', this.db.sequelize.literal(`CASE WHEN status = '${REF_STATUS.INVALID}' THEN 1 ELSE 0 END`)), 'invalid'],
      ],
      raw: true,
      transaction,
    });

    const c = counts[0];
    const hasSuspectedOrGapOrInvalid = (c.suspected > 0 || c.gap > 0 || c.invalid > 0);

    const hasManualFix = await RefAnchor.findOne({
      where: {
        standard_id: standardId,
        source: [REF_SOURCE.MANUAL, REF_SOURCE.USER_CONFIRMED],
      },
      raw: true,
      transaction,
    });

    const manualFixCount = await RefAnchor.count({
      where: {
        standard_id: standardId,
        source: [REF_SOURCE.MANUAL, REF_SOURCE.USER_CONFIRMED],
      },
      transaction,
    });

    const updateData = {
      reference_count: c.total || 0,
      valid_reference_count: c.valid || 0,
      suspected_reference_count: c.suspected || 0,
      gap_reference_count: c.gap || 0,
      invalid_reference_count: c.invalid || 0,
      needs_review: hasSuspectedOrGapOrInvalid ? 1 : 0,
      has_manual_fix: !!hasManualFix ? 1 : 0,
      manual_fix_count: manualFixCount || 0,
      updated_at: new Date(),
    };

    // R2-5：人工治理字段——仅当本次写入为人工来源时更新治理时间/人
    // 批量重建（source=null）不动治理时间，避免全量刷新误写
    if (source && MANUAL_SOURCES.has(source)) {
      updateData.last_manual_fix_at = new Date();
      if (userId) {
        updateData.last_manual_fix_by = userId;
      }
    }

    await AppStandard.update(updateData, { where: { id: standardId }, transaction });
  }

  // ============================================================
  // R2-4: 企业隔离查询（过渡策略）
  //
  // 在企业对象与企业成员关系落地前：
  // - listAllStandards / getStandard / findStandards：不过滤 enterprise_id
  // - 旧版 listStandards(enterpriseId) 保留但内部不再按 enterprise_id 过滤
  // ============================================================

  /**
   * 列出所有标准（过渡策略：不过滤企业）
   *
   * @param {object} [options]
   * @param {string} [options.standard_type]
   * @param {number} [options.is_active] 默认 1
   * @returns {Promise<Array>}
   */
  async listAllStandards(options = {}) {
    const AppStandard = this._appStandard();
    const Document = this.db.getModel('document');
    const where = {};

    if (options.is_active !== undefined) {
      where.is_active = options.is_active;
    } else {
      where.is_active = 1;
    }

    if (options.standard_type) {
      where.standard_type = options.standard_type;
    }

    const standards = await AppStandard.findAll({
      where,
      order: [['created_at', 'DESC']],
      raw: true,
    });

    // R2-8: 附上文档的 current_revision_id，用于前端版本差异提示
    if (standards.length > 0) {
      const docIds = [...new Set(standards.map(s => s.document_id).filter(Boolean))];
      const docs = await Document.findAll({
        where: { id: docIds },
        attributes: ['id', 'current_revision_id'],
        raw: true,
      });
      const docMap = {};
      for (const d of docs) docMap[d.id] = d.current_revision_id;

      for (const s of standards) {
        s.document_current_revision_id = docMap[s.document_id] || null;
      }
    }

    return standards;
  }

  /**
   * 按企业查询标准列表（保留兼容，过渡策略下等同 listAllStandards）
   */
  async listStandards(enterpriseId, options = {}) {
    return await this.listAllStandards(options);
  }

  /**
   * 获取单个标准详情
   *
   * R2-4：不再按 enterprise_id 过滤；undefined 与 null 语义统一为"不过滤"
   */
  async getStandard(standardId) {
    const AppStandard = this._appStandard();
    const Document = this.db.getModel('document');

    const standard = await AppStandard.findOne({
      where: { id: standardId },
      raw: true,
    });

    // R2-8: 附上文档的 current_revision_id
    if (standard && standard.document_id) {
      const doc = await Document.findByPk(standard.document_id, {
        attributes: ['current_revision_id'],
        raw: true,
      });
      standard.document_current_revision_id = doc ? doc.current_revision_id : null;
    }

    return standard;
  }

  /**
   * 按标准编号/名称查找标准
   *
   * R2-4 过渡策略：不过滤 enterprise_id
   */
  async findStandards({ standard_code, standard_name }) {
    const AppStandard = this._appStandard();

    const where = { is_active: 1 };

    if (standard_code) {
      where.standard_code = { [Op.like]: `%${standard_code}%` };
    }

    if (standard_name) {
      where.standard_name = { [Op.like]: `%${standard_name}%` };
    }

    if (!standard_code && !standard_name) {
      throw new Error('At least one of standard_code or standard_name is required');
    }

    return await AppStandard.findAll({ where, raw: true });
  }

  /**
   * 获取标准的引用记录列表
   */
  async listRefAnchors(standardId, options = {}) {
    const RefAnchor = this._refAnchor();
    const where = { standard_id: standardId };

    if (options.status) {
      where.status = options.status;
    }

    if (options.ref_type) {
      where.ref_type = options.ref_type;
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const anchors = await RefAnchor.findAll({
      where,
      order: [['source_revision_id', 'ASC'], ['source_outline_id', 'ASC'], ['occurrence_index', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    // R9-3: 批量补 target_document_title + target_outline_title
    return await this._enrichAnchorTargets(anchors);
  }

  /**
   * R9-3: 为锚点列表补全目标文档标题和目标章节标题
   */
  async _enrichAnchorTargets(anchors) {
    if (!anchors || anchors.length === 0) return anchors;

    const Document = this.db.getModel('document');
    const DocOutline = this.db.getModel('document_outline');

    // 收集所有非空 target_document_id / target_outline_id
    const docIds = [...new Set(anchors.map(a => a.target_document_id).filter(Boolean))];
    const outlineIds = [...new Set(anchors.map(a => a.target_outline_id).filter(Boolean))];

    const [docs, outlines] = await Promise.all([
      docIds.length > 0
        ? Document.findAll({ where: { id: docIds }, attributes: ['id', 'title'], raw: true })
        : [],
      outlineIds.length > 0
        ? DocOutline.findAll({ where: { id: outlineIds }, attributes: ['id', 'title'], raw: true })
        : [],
    ]);

    const docTitleMap = {};
    for (const d of docs) docTitleMap[d.id] = d.title;

    const outlineTitleMap = {};
    for (const o of outlines) outlineTitleMap[o.id] = o.title;

    return anchors.map(a => ({
      ...a,
      target_document_title: a.target_document_id ? (docTitleMap[a.target_document_id] || null) : null,
      target_outline_title: a.target_outline_id ? (outlineTitleMap[a.target_outline_id] || null) : null,
    }));
  }

  /**
   * 获取 gap 列表（待回填的引用缺口）
   */
  async listGaps(standardId, options = {}) {
    return await this.listRefAnchors(standardId, {
      ...options,
      status: REF_STATUS.GAP,
    });
  }

  /**
   * P0-2 / R2-5: 获取标准文档所有章节 + 锚点覆盖
   *
   * 返回文档的全部 outline（按 seq 排序），每个 outline 附：
   *  - outline_id, revision_id, seq, title, description, original_text, text_hash
   *  - anchored_text: 若存在锚点副本，返回带锚点的文本；否则为 original_text
   *  - anchor_count: 该章节中锚点数量（0 = 无锚点副本）
   *  - anchors: Array<{ anchor_id, source_text, target_outline_id }>
   *  - has_anchored: boolean（等同于 anchor_count > 0）
   *
   * @param {string} standardId
   * @returns {Promise<Array>}
   */
  async listAnchoredSections(standardId) {
    const AppStandard = this._appStandard();
    const AnchoredSection = this._anchoredSection();
    const DocOutline = this.db.getModel('document_outline');
    const Document = this.db.getModel('document');

    // 1. 获取标准 → 文档 → 当前 revision
    const standard = await AppStandard.findByPk(standardId, {
      attributes: ['id', 'document_id'],
      raw: true,
    });
    if (!standard || !standard.document_id) return [];

    const doc = await Document.findByPk(standard.document_id, {
      attributes: ['id', 'current_revision_id'],
      raw: true,
    });
    if (!doc || !doc.current_revision_id) return [];

    // 2. 获取该 revision 的全部 outline，按 seq 排序
    const allOutlines = await DocOutline.findAll({
      where: { revision_id: doc.current_revision_id },
      attributes: ['id', 'revision_id', 'title', 'description', 'seq', 'original_text', 'text_hash'],
      order: [['seq', 'ASC']],
      raw: true,
    });

    // 3. 获取已存在的 anchored_section 记录
    const anchoredRows = await AnchoredSection.findAll({
      where: { standard_id: standardId },
      attributes: ['outline_id', 'anchored_text', 'anchor_count'],
      raw: true,
    });
    const anchoredMap = {};
    for (const row of anchoredRows) anchoredMap[row.outline_id] = row;

    // 4. 组装返回：所有 outline + 锚点覆盖
    return allOutlines.map(outline => {
      const anchored = anchoredMap[outline.id];
      return {
        outline_id: outline.id,
        revision_id: outline.revision_id,
        seq: outline.seq || 0,
        title: outline.title || '',
        description: outline.description || '',
        original_text: outline.original_text || '',
        text_hash: outline.text_hash || '',
        anchor_count: anchored ? anchored.anchor_count : 0,
        has_anchored: anchored ? anchored.anchor_count > 0 : false,
        anchored_text: anchored ? anchored.anchored_text : outline.original_text,
      };
    });
  }

  // ============================================================
  // P1-3: runGapBackfill — gap 回填最小闭环
  //
  // R2-2（重写匹配）：用标准编号（standard_code）做归一化比较，而非文档标题。
  //   候选键 = 新纳管/新清洗标准的 standard_code；
  //   gap 侧从 source_text 提取编号（确定性正则），双侧归一化后比较。
  //   N2 根因：短文本"按GB/T2828…"不可能包含长标题"GB/T 2828-2012 计数抽样…"
  //
  // R2-3（修正触发②语义）：
  //   clean_done：A 洗完 → 其他标准里引用 A 的 gap 被补齐（链式回填），而非填 A 自己。
  //
  // R2-3（retry 纪律）：skip 路径统一更新 retry_count+1 与 last_retry_at。
  //
  // 三个触发点：
  // ① 纳管完成（createStandard 成功后）—— candidate = 新纳管标准的 standard_code
  // ② 清洗完成（build-status=done 后）—— candidate = 刚洗完标准的 code/name
  // ③ 新 revision 入库（按发布日期规则重指动态引用）
  //
  // 日期规则（README 决议 3）：
  //   target(B) = max{B版本 | B版本.publish_date ≤ A.publish_date}
  // ============================================================

  /**
   * R3-2/R4-1: 从 source_text 中提取标准编号（确定性正则，双通道）
   *
   * 通道 1：已知标准化组织前缀（GB|QC|ISO|JB|YC|TW[/:]?T?数字序列）
   *   - R4-1 补充 QJL/QJLY（Q/JL、Q/JLY 企业标准，注意是 QJL 不是 QJ）、
   *     FMVSS/ECE（国际法规）、SAE/ASTM/DIN/JIS（国际标准）
   *     ——此前企业标准系引用全部提取失败导致 gap 永不回填
   *   - 模式中 `[A-Z]?` 支持"前缀后直接连字母再数字"的连写形态
   *     （如 QJLJ160003、QJLYJ7111029），不影响 GB/T、QC/T 等原有形态
   * 通道 2：通用形态兜底——大写前缀(1-6 字母) + 可选 [/或-]分段 + 数字主体(≥2 位)
   *   - 覆盖 Q/JL J160003（斜杠在 Q 与 JL 之间，连续前缀 QJL 匹配不上）、
   *     Q/JLYJ7210640（连写）、ECE R21.01 等白名单外形态
   *   - 数字要求 ≥2 位，避免把 "E2 条款"、"附录表A.1" 等非编号误提取
   * 示例：GB/T 19001, QC/T 636, ISO 9001, GBT2828, JB/T 12345, Q/JL J160003,
   *       QJLJ160003, Q/JLYJ7210640, FMVSS 118, ECE R21.01
   * 年份后缀（-2000, .1-2012）由正则末尾 `[\d.\-]*` 覆盖。
   */
  _extractStandardCodes(text) {
    if (!text) return [];
    const codes = [];
    // 通道 1：支持的标准化组织前缀（含常见五类 + 行业前缀 + 企业/国际法规）
    // 注意：企业标准代号是 QJL（Q/JL）/ QJLY（Q/JLY），不是 QJ
    const prefix = '(?:GB|QC|ISO|JB|YC|TW|DB|CB|JT|JTJ|SY|SH|HG|NB|DL|SD|YD|QJLY|QJL|FMVSS|ECE|SAE|ASTM|DIN|JIS)';
    // [/:]? 后接可选空格、可选单字母（连写形态）、可选 T，再接数字主体与可选版本/年份后缀
    const re1 = new RegExp(`${prefix}[/:]?\\s*[A-Z]?\\s*T?\\s*\\d+[\\d.\\-]*`, 'gi');
    let m;
    while ((m = re1.exec(text)) !== null) {
      codes.push(m[0]);
    }
    // 通道 2：通用形态兜底（去重合并）
    const re2 = /[A-Z]{1,6}(?:[/-][A-Z]{1,4})?\s*[A-Z]?\d{2,}(?:[.\-]\d+)*[A-Z]?(?:[-–]\d{4})?/g;
    while ((m = re2.exec(text)) !== null) {
      if (!codes.includes(m[0])) codes.push(m[0]);
    }
    return codes;
  }

  /**
   * R3-2: 归一化标准编号——剔除全部非字母数字字符，大写
   *
   * N1 根因：旧实现保留 `/` 和 `-`，导致 QCT636-2000 ≠ QC/T636。
   * 新实现：strip ALL non-alphanumeric → QCT6362000 vs QCT636 → 前缀命中。
   */
  _normalizeCode(code) {
    if (!code) return '';
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  /**
   * R3-2: 双向前缀匹配——任一侧是另一侧的前缀即命中
   *
   * 覆盖真实数据最常见形态：
   * - 年份省略：QCT6362000 vs QCT636 → prefix match ✅
   * - 空格/斜杠变异：QCT636 vs QCT636 → 全等 ✅
   * - GB/T 2828 vs GB/T 2828.1 → 不误配 ✅（2828 不是 28281 的前缀，反之亦然）
   *
   * @param {string} candidate - 候选标准编号（已归一化）
   * @param {string} extracted - gap 中提取的编号（已归一化）
   * @returns {boolean}
   */
  _codeMatches(candidate, extracted) {
    if (!candidate || !extracted) return false;
    return candidate.startsWith(extracted) || extracted.startsWith(candidate);
  }

  /**
   * 执行 gap 回填
   *
   * @param {object} params
   * @param {string} params.trigger - 触发来源：'onboard' | 'clean_done' | 'new_revision'
   * @param {string} [params.document_id] - 新入库文档 ID（onboard / new_revision 触发时传入）
   * @param {string} [params.standard_id] - 标准 ID（onboard / clean_done 触发时传入）
   * @returns {Promise<{filled: number, skipped: number, errors: number, details: Array}>}
   */
  async runGapBackfill({ trigger, document_id, standard_id } = {}) {
    const startTime = Date.now();
    const details = [];
    let filled = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const RefAnchor = this._refAnchor();
      const Document = this.db.getModel('document');
      const AppStandard = this._appStandard();

      let candidateCodes = [];    // 归一化后的标准编号
      let candidateNames = [];    // 标准名称（用于 clean_done 辅助匹配）
      let targetStandards = [];   // 要检查 gap 的目标标准列表
      let candidateStandard = null;

      if ((trigger === 'onboard' || trigger === 'new_revision') && standard_id) {
        // R2-2: 触发①/③——用新纳管标准的 standard_code
        candidateStandard = await this.getStandard(standard_id);
        if (!candidateStandard) {
          logger.warn(`[standard-mgr][backfill] Standard not found: ${standard_id}`);
          return { filled: 0, skipped: 0, errors: 0, details: [] };
        }
        const normCode = this._normalizeCode(candidateStandard.standard_code);
        if (normCode) candidateCodes.push(normCode);
        if (candidateStandard.standard_name) candidateNames.push(candidateStandard.standard_name);

        // R2-2: 同时获取 document 信息（用于写回时的 target）
        // 遍历其他活跃标准（排除自身，onboard 场景自身还没 gap）
        targetStandards = await AppStandard.findAll({
          where: { is_active: true },
          raw: true,
        });
        if (trigger === 'onboard') {
          // 纳管场景：排除刚纳管的自身
          targetStandards = targetStandards.filter(s => s.id !== standard_id);
        }
      } else if (trigger === 'clean_done' && standard_id) {
        // R2-3: 触发②——A 洗完 → 其他标准里引用 A 的 gap 被补齐（链式回填）
        candidateStandard = await this.getStandard(standard_id);
        if (!candidateStandard) {
          logger.warn(`[standard-mgr][backfill] Standard not found: ${standard_id}`);
          return { filled: 0, skipped: 0, errors: 0, details: [] };
        }
        const normCode = this._normalizeCode(candidateStandard.standard_code);
        if (normCode) candidateCodes.push(normCode);
        if (candidateStandard.standard_name) candidateNames.push(candidateStandard.standard_name);

        // R2-3: 排除自身，目标标准 = 其他活跃标准
        targetStandards = await AppStandard.findAll({
          where: { is_active: true },
          raw: true,
        });
        targetStandards = targetStandards.filter(s => s.id !== standard_id);
      } else if ((trigger === 'onboard' || trigger === 'new_revision') && document_id && !standard_id) {
        // 兼容旧调用：仅有 document_id 没 standard_id
        // 尝试从 app_standard 反查 standard_code
        const onboardedStandard = await AppStandard.findOne({
          where: { document_id },
          raw: true,
        });
        if (onboardedStandard) {
          const normCode = this._normalizeCode(onboardedStandard.standard_code);
          if (normCode) candidateCodes.push(normCode);
          if (onboardedStandard.standard_name) candidateNames.push(onboardedStandard.standard_name);
        }
        targetStandards = await AppStandard.findAll({
          where: { is_active: true },
          raw: true,
        });
        if (onboardedStandard) {
          targetStandards = targetStandards.filter(s => s.id !== onboardedStandard.id);
        }
      }

      if (targetStandards.length === 0) {
        logger.info(`[standard-mgr][backfill] No target standards for trigger=${trigger}`);
        return { filled: 0, skipped: 0, errors: 0, details: [] };
      }

      // ── 2. 获取候选标准对应的文档信息（用于写回 target） ──
      let candidateDoc = null;
      if (candidateStandard?.document_id) {
        candidateDoc = await Document.findByPk(candidateStandard.document_id, {
          attributes: ['id', 'current_revision_id'],
          raw: true,
        });
      } else if (document_id) {
        candidateDoc = await Document.findByPk(document_id, {
          attributes: ['id', 'current_revision_id'],
          raw: true,
        });
      }

      // ── 3. 遍历目标标准，查找 gap 记录 ──
      for (const standard of targetStandards) {
        const gaps = await this.listGaps(standard.id);
        if (gaps.length === 0) continue;

        for (const gap of gaps) {
          try {
            // R3-2: 从 gap.source_text 提取标准编号并归一化
            const gapCodes = this._extractStandardCodes(gap.source_text);
            const gapCodesNorm = gapCodes.map(c => this._normalizeCode(c));

            // R3-2: 双向前缀匹配（代替 R2-2 的全等比较）
            // 覆盖 QC/T 636-2000 vs QC/T 636（年份省略 + 空格/斜杠变异）
            const matched = gapCodesNorm.some(gc =>
              candidateCodes.some(cc => this._codeMatches(cc, gc))
            );

            // 辅助检查：按名称模糊匹配（编号匹配失败时）
            const sourceTextLower = (gap.source_text || '').toLowerCase();
            const nameMatched = !matched && candidateNames.some(n =>
              n && sourceTextLower.includes(n.toLowerCase())
            );

            if (!matched && !nameMatched) {
              // R2-3: skip 路径统一更新 retry
              skipped++;
              await this._updateGapRetry(gap);
              details.push({ gap_id: gap.id, result: 'skipped', reason: 'code/name not matched' });
              continue;
            }

            // ── 4. 查找目标文档 ──
            if (!candidateDoc || !candidateDoc.current_revision_id) {
              skipped++;
              await this._updateGapRetry(gap);
              details.push({
                gap_id: gap.id,
                result: 'skipped',
                reason: 'Candidate document has no current_revision_id',
              });
              continue;
            }

            // ── 5. 日期规则校验（仅 new_revision 触发时） ──
            if (trigger === 'new_revision') {
              const DocumentRevision = this.db.getModel('document_revision');
              const sourceRevision = standard.current_revision_id
                ? await DocumentRevision.findByPk(standard.current_revision_id, {
                    attributes: ['publish_date'],
                    raw: true,
                  })
                : null;

              const newRevision = await DocumentRevision.findByPk(candidateDoc.current_revision_id, {
                attributes: ['publish_date'],
                raw: true,
              });

              if (sourceRevision && newRevision) {
                const aDate = sourceRevision.publish_date;
                const bDate = newRevision.publish_date;

                if (!aDate || !bDate) {
                  await RefAnchor.update(
                    {
                      status: REF_STATUS.SUSPECTED,
                      status_reason: '回填时缺少发布日期，无法自动判定版本关系',
                      retry_count: (gap.retry_count || 0) + 1,
                      last_retry_at: new Date(),
                      updated_at: new Date(),
                    },
                    { where: { id: gap.id } },
                  );
                  skipped++;
                  details.push({
                    gap_id: gap.id,
                    result: 'suspected',
                    reason: 'Missing publish_date for date rule',
                  });
                  continue;
                }

                if (bDate > aDate) {
                  skipped++;
                  await this._updateGapRetry(gap);
                  details.push({
                    gap_id: gap.id,
                    result: 'skipped',
                    reason: `B.publish_date(${bDate}) > A.publish_date(${aDate})`,
                  });
                  continue;
                }
              }
            }

            // ── 6. 写回 valid 记录 ──
            await this.writeAnchorResult({
              standard_id: standard.id,
              source_revision_id: gap.source_revision_id,
              source_outline_id: gap.source_outline_id,
              occurrence_index: gap.occurrence_index,
              source_text: gap.source_text,
              context_text: gap.context_text,
              ref_type: gap.ref_type,
              status: REF_STATUS.VALID,
              source: REF_SOURCE.AUTO_BACKFILL,
              target_document_id: candidateDoc.id,
              target_revision_id: candidateDoc.current_revision_id,
              target_outline_id: null,
              status_reason: `backfilled on ${trigger}`,
            });

            filled++;
            details.push({
              gap_id: gap.id,
              result: 'filled',
              target_document_id: candidateDoc.id,
            });
          } catch (gapErr) {
            errors++;
            logger.error(`[standard-mgr][backfill] Error processing gap ${gap.id}: ${gapErr.message}`);
            details.push({
              gap_id: gap.id,
              result: 'error',
              reason: gapErr.message,
            });
            await this._updateGapRetry(gap);
          }
        }
      }
    } catch (err) {
      logger.error(`[standard-mgr][backfill] runGapBackfill failed: ${err.message}`);
      errors++;
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `[standard-mgr][backfill] Completed: filled=${filled} skipped=${skipped} errors=${errors} ` +
        `trigger=${trigger} elapsed=${elapsed}ms`,
    );

    return { filled, skipped, errors, details };
  }

  /**
   * R2-3: 更新 gap 记录的 retry 信息
   */
  async _updateGapRetry(gap) {
    try {
      const RefAnchor = this._refAnchor();
      await RefAnchor.update(
        {
          retry_count: (gap.retry_count || 0) + 1,
          last_retry_at: new Date(),
          updated_at: new Date(),
        },
        { where: { id: gap.id } },
      );
    } catch (_) { /* 静默 */ }
  }

  // ============================================================
  // R2-1: rebuildAnchoredSections — 服务端确定性派生带锚点副本
  //
  // 带锚点副本 = 原文 + 确定性插入锚点标记，这是字符串处理，不是 LLM 任务。
  // 让 LLM 转写原文既贵又会引入内容漂移，违反原文保真原则。
  // ============================================================

  // ── R3-1 归一化字符映射表 ──

  /**
   * 构建字符归一化映射表
   *
   * 归一化规则：
   * - 全角标点 → 半角（：→: 等）
   * - 折叠连续空白为单个空格
   * - 中文引号/破折号归一化
   *
   * @returns {{ normalized: string, origPos: number[] }}
   *   normalized: 归一化后的字符串
   *   origPos: normalized[i] → 原文中的字符位置
   */
  _buildCharNormMap(text) {
    // 全角→半角映射
    const FW_MAP = {
      '\u3000': ' ', '\uff1a': ':', '\uff0c': ',',
      '\uff08': '(', '\uff09': ')', '\u3001': ',',
      '\u3002': '.', '\uff0e': '.',
      '\u2018': "'", '\u2019': "'",
      '\u201c': '"', '\u201d': '"',
      '\uff0d': '-', '\u2013': '-', '\u2014': '-',
      '\uff0f': '/',
    };

    const isWhitespace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

    // ── R5-1：全量去空白（移除所有 \\s） + 全角→半角 ──
    // 不再分两个阶段；去除全部空白（包括 ASCII↔CJK 边界的空格）
    // tMap 保持归一化位置 → 原文坐标的映射
    const chars = [];
    const origPos = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const m = FW_MAP[ch] !== undefined ? FW_MAP[ch] : ch;
      if (isWhitespace(m)) continue; // 跳过所有空白
      chars.push(m);
      origPos.push(i);
    }

    return { normalized: chars.join(''), origPos };
  }

  /**
   * 归一化模糊匹配：在原文（或已插入标记的 anchored text）中定位 source_text
   *
   * R3-1：用于解决全角冒号等 OCR 识别差异导致的精确匹配失败。
   *
   * @param {string} text - 原文（可能含已插入的锚点标记）
   * @param {string} search - 要搜索的源文本
   * @param {number} fromIndex - 原文坐标起始搜索位置
   * @returns {{ pos: number, end: number } | null}
   */
  _findFuzzy(text, search, fromIndex = 0) {
    const { normalized: textN, origPos: tMap } = this._buildCharNormMap(text);
    const { normalized: searchN } = this._buildCharNormMap(search);

    // fromIndex → 归一化坐标
    let nFrom = 0;
    for (let i = 0; i < tMap.length; i++) {
      if (tMap[i] >= fromIndex) { nFrom = i; break; }
    }

    const nPos = textN.indexOf(searchN, nFrom);
    if (nPos < 0) return null;

    const startOrig = tMap[nPos];
    // R5-2: end = 最后一个匹配字符的原文坐标 +1
    const endOrig = tMap[nPos + searchN.length - 1] + 1;

    return { pos: startOrig, end: endOrig };
  }

  /**
   * R9-5: 片段近似匹配 —— 当精确匹配和归一化模糊匹配都失败时的最后手段
   *
   * OCR 极少把一句话的每个字符都打坏。从 source_text 头部取滑动窗口，
   * 在归一化后的 anchored_text 中查找命中片段，映射回原文坐标。
   *
   * @param {string} text - 原文（可能含已插入的锚点标记）
   * @param {string} search - 要搜索的源文本
   * @param {number} fromIndex - 原文坐标起始搜索位置
   * @returns {{ pos: number, end: number } | null}
   */
  _findApproximate(text, search, fromIndex = 0) {
    if (!search || search.length < 4) return null;

    const { normalized: textN, origPos: tMap } = this._buildCharNormMap(text);

    // fromIndex → 归一化坐标
    let nFrom = 0;
    for (let i = 0; i < tMap.length; i++) {
      if (tMap[i] >= fromIndex) { nFrom = i; break; }
    }

    const maxWindow = Math.min(12, search.length);
    const { normalized: searchN } = this._buildCharNormMap(search);

    // 滑动窗口：从 maxWindow 递减到 4
    for (let w = maxWindow; w >= 4; w--) {
      const window = searchN.slice(0, w);
      if (window.length < w) continue; // 归一化后不足窗口长度

      // 先从 searchFrom 后搜索
      let nPos = textN.indexOf(window, nFrom);
      if (nPos >= 0) {
        const startOrig = tMap[nPos];
        const endOrig = tMap[nPos + window.length - 1] + 1;
        return { pos: startOrig, end: endOrig };
      }

      // 再从全文开头搜索
      nPos = textN.indexOf(window, 0);
      if (nPos >= 0) {
        const startOrig = tMap[nPos];
        const endOrig = tMap[nPos + window.length - 1] + 1;
        return { pos: startOrig, end: endOrig };
      }
    }

    return null;
  }

  // ── R3-1+R3-2 带锚点副本重建（唯一实现） ──

  /**
   * 为指定标准重建全部带锚点副本，在自己的事务中完成。
   *
   * R3-2：不再重复实现，委托 _rebuildAnchoredSectionsInTx 处理。
   * R3-4：miss 持久化（needs_review + last_anchor_build_error）。
   *
   * @param {string} standardId
   * @returns {Promise<{sections: number, anchors: number, misses: Array}>}
   */
  async rebuildAnchoredSections(standardId) {
    const AppStandard = this._appStandard();
    const standard = await AppStandard.findByPk(standardId, { raw: true });
    if (!standard) throw new Error(`Standard not found: ${standardId}`);

    const tx = await this.db.sequelize.transaction();
    try {
      const result = await this._rebuildAnchoredSectionsInTx(standardId, tx);
      await this._persistRebuildMisses(standardId, result.misses, tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * R14-2：原子锁 — 条件 UPDATE，只有 pending/error/done 才允许置 processing。
   * 避免 check-then-set 竞态导致同一标准被两个清洗会话同时处理。
   *
   * @returns {boolean} true 表示获取锁成功（已置 processing），false 表示已被占用
   */
  async tryLockForCleaning(standardId) {
    const AppStandard = this._appStandard();
    const [affected] = await AppStandard.update(
      {
        anchor_build_status: ANCHOR_BUILD_STATUS.PROCESSING,
        last_anchor_build_error: null,
        updated_at: new Date(),
      },
      {
        where: {
          id: standardId,
          anchor_build_status: {
            [Op.in]: [
              ANCHOR_BUILD_STATUS.PENDING,
              ANCHOR_BUILD_STATUS.ERROR,
              ANCHOR_BUILD_STATUS.DONE,
            ],
          },
        },
      },
    );
    return affected > 0;
  }

  // ============================================================
  // R17-1: runCleaningPipeline — 清洗流程单一编排点
  // ============================================================

  /**
   * 执行一次完整的锚点清洗生命周期（R17-1 收编）。
   *
   * 编排顺序（全部在本方法内完成，入口层只负责调用本方法）：
   *   1. 校验标准存在且已关联文档/版本
   *   2. 原子锁（tryLockForCleaning）——已被占用时直接返回 { accepted: false }
   *   3. 生成后台任务长期 token（防止工具回调 401）
   *   4. 异步执行清洗会话（_runCleaningAsync）：
   *      - 查找锚点清洗专家
   *      - 清理 auto 记录（deleteAutoRefAnchors）
   *      - 创建 Topic
   *      - 构造开工消息（buildCleanMessage）
   *      - 驱动 agent（streamChat，带超时）
   *      - 成功 → updateAnchorBuildStatus('done')（内部连锁触发副本重建）
   *                 + 异步 runGapBackfill({ trigger: 'clean_done' })
   *      - 失败 → updateAnchorBuildStatus('error', msg)
   *
   * 所有入口（clean 端点、纳管自动清洗钩子）统一走本方法，
   * 禁止在 handler / 脚本中复制编排。
   *
   * @param {string} standardId
   * @param {object} opts
   * @param {object} opts.session - 触发者会话（用于生成长期 token）
   * @param {object} opts.chatService - ChatService 实例（由入口层注入）
   * @returns {Promise<{ accepted: boolean, reason?: string }>}
   *   accepted=false 表示该标准正在清洗中（调用方应返回 409）
   */
  async runCleaningPipeline(standardId, { session, chatService } = {}) {
    // 1. 校验标准
    const standard = await this.getStandard(standardId);
    if (!standard) {
      const err = new Error('Standard not found');
      err.status = 404;
      throw err;
    }

    const documentId = standard.document_id;
    const revisionId = standard.current_revision_id;
    if (!documentId || !revisionId) {
      const err = new Error('标准缺少关联的文档或版本信息');
      err.status = 400;
      throw err;
    }

    if (!chatService) {
      const err = new Error('ChatService 不可用');
      err.status = 500;
      throw err;
    }

    const userId = session?.id;
    if (!userId) {
      const err = new Error('未登录');
      err.status = 401;
      throw err;
    }

    // 2. 原子锁（R14-2）
    const locked = await this.tryLockForCleaning(standardId);
    if (!locked) {
      return { accepted: false, reason: '清洗正在进行中' };
    }

    // 3. 生成长期 token 替代用户短期 JWT，防止工具回调 401
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const taskToken = jwt.sign(
      { userId, role: session.roles?.[0] || 'user' },
      jwtSecret,
      { expiresIn: TASK_TOKEN_EXPIRY },
    );
    const taskSession = { ...session, accessToken: taskToken };

    // 4. 异步执行清洗，不阻塞响应
    this._runCleaningAsync({
      chatService,
      userId,
      session: taskSession,
      standardId,
      documentId,
      revisionId,
    }).catch(err => {
      logger.error(`[standard-mgr] runCleaningPipeline async error for ${standardId}: ${err.message}`);
    });

    return { accepted: true };
  }

  /**
   * 异步清洗会话（内部实现，编排在 runCleaningPipeline 中声明）
   */
  async _runCleaningAsync({ chatService, userId, session, standardId, documentId, revisionId }) {
    let expertId = null;

    try {
      // ── 1. 查找锚点清洗专家 ──
      expertId = await this._findAnchorExpert();
      if (!expertId) {
        throw Object.assign(
          new Error('未找到标准引用清洗专家，请先运行 scripts/setup-anchor-expert.mjs'),
          { status: 404 },
        );
      }

      logger.info(
        `[standard-mgr] 开始清洗: standard=${standardId} doc=${documentId} revision=${revisionId} expert=${expertId}`
      );

      // ── 2. 清空 auto 记录（R15-6），manual/user_confirmed 永久保留 ──
      const deletedCount = await this.deleteAutoRefAnchors(standardId, revisionId);
      logger.info(`[standard-mgr] 清洗前置清理: 删除 ${deletedCount} 条 auto 记录`);

      // ── 3. 创建会话 ──
      const topicId = await chatService.createNewTopic(userId, expertId, `标准清洗 — ${standardId}`, null);

      // ── 4. 构造开工消息 ──
      const content = buildCleanMessage(documentId, revisionId, standardId);

      // ── 5. 驱动 AgentLoop（带超时） ──
      const result = await new Promise((resolve) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (!settled) { settled = true; resolve({ ok: false, error: '清洗超时（15 分钟）' }); }
        }, CLEAN_TIMEOUT_MS);

        chatService.streamChat(
          {
            topic_id: topicId,
            user_id: userId,
            expert_id: expertId,
            content,
            session,
          },
          // onDelta — 清洗不需要实时推送
          () => {},
          // onComplete
          (completeResult) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              resolve({ ok: true, messageId: completeResult.message_id });
            }
          },
          // onError
          (error) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              resolve({ ok: false, error: error.message || String(error) });
            }
          },
        );
      });

      // ── 6. 根据结果更新状态（连锁触发重建）与回填 ──
      if (result.ok) {
        await this.updateAnchorBuildStatus(standardId, 'done');
        logger.info(`[standard-mgr] 清洗完成: standard=${standardId}`);

        // P1-3 触发②：清洗完成后异步执行 gap 回填
        this.runGapBackfill({
          trigger: 'clean_done',
          standard_id: standardId,
        }).catch(err => {
          logger.error(`[standard-mgr] backfill-clean-done failed: ${err.message}`);
        });
      } else {
        await this.updateAnchorBuildStatus(standardId, 'error', result.error);
        logger.warn(`[standard-mgr] 清洗失败: standard=${standardId} error=${result.error}`);
      }
    } catch (err) {
      logger.error(`[standard-mgr] 清洗异常: standard=${standardId} ${err.message}`);
      try {
        await this.updateAnchorBuildStatus(standardId, 'error', err.message);
      } catch (statusErr) {
        logger.error(`[standard-mgr] 更新错误状态失败: ${statusErr.message}`);
      }
    }
  }

  /**
   * 查找绑定 skill-standard-anchor 且启用的专家 ID
   */
  async _findAnchorExpert() {
    const ExpertSkill = this.db.getModel('expert_skill');
    const Expert = this.db.getModel('expert');
    const Skill = this.db.getModel('skill');

    const record = await ExpertSkill.findOne({
      include: [
        { model: Skill, as: 'skill', where: { id: 'skill-standard-anchor' }, required: true },
        { model: Expert, as: 'expert', where: { is_active: true }, required: true },
      ],
      raw: true,
    });

    return record?.expert_id || null;
  }

  /**
   * 更新标准的锚点构建状态
   *
   * R2-2：当 status 转为 done 时，自动调用 _rebuildAnchoredSectionsInTx 生成带锚点副本，
   * 副本生成与状态完成在同一事务内原子化——避免"done 了但副本没建"的中间态。
   * R3-4：status=done 时同时持久化 miss 信息到 needs_review 和 last_anchor_build_error。
   */
  async updateAnchorBuildStatus(standardId, status, errorMessage = null) {
    if (![ANCHOR_BUILD_STATUS.PENDING, ANCHOR_BUILD_STATUS.PROCESSING, ANCHOR_BUILD_STATUS.DONE, ANCHOR_BUILD_STATUS.ERROR].includes(status)) {
      throw new Error(`Invalid anchor_build_status: ${status}`);
    }

    const AppStandard = this._appStandard();
    const updateData = {
      anchor_build_status: status,
      updated_at: new Date(),
    };

    if (status === ANCHOR_BUILD_STATUS.DONE) {
      updateData.last_anchor_build_at = new Date();
      updateData.last_anchor_build_error = null;
    } else if (status === ANCHOR_BUILD_STATUS.ERROR) {
      updateData.last_anchor_build_error = errorMessage || 'Unknown error';
    } else if (status === ANCHOR_BUILD_STATUS.PROCESSING) {
      updateData.last_anchor_build_error = null;
    }

    if (status === ANCHOR_BUILD_STATUS.DONE) {
      const tx = await this.db.sequelize.transaction();
      try {
        const rebuildResult = await this._rebuildAnchoredSectionsInTx(standardId, tx);

        // R3-4：miss 持久化 — 合并到 updateData
        Object.assign(updateData, this._buildMissUpdateData(rebuildResult.misses));

        await AppStandard.update(updateData, { where: { id: standardId }, transaction: tx });
        await tx.commit();
        const updated = await AppStandard.findByPk(standardId, { raw: true });
        return { standard: updated, rebuild: rebuildResult };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }

    await AppStandard.update(updateData, { where: { id: standardId } });
    return { standard: await AppStandard.findByPk(standardId, { raw: true }), rebuild: null };
  }

  /**
   * R3-4：构造 miss 持久化字段
   */
  _buildMissUpdateData(misses) {
    if (!misses || misses.length === 0) {
      return { needs_review: 0, last_anchor_build_error: null };
    }
    const summary = misses.slice(0, 5).map(m =>
      `[${m.ref_anchor_id || m.outline_id}] ${m.reason}`
    ).join('; ');
    const trail = misses.length > 5 ? ` …+${misses.length - 5} more` : '';
    return {
      needs_review: 1,
      last_anchor_build_error: `misses=${misses.length}: ${summary}${trail}`,
    };
  }

  /**
   * R3-4：持久化 miss 信息（供 rebuildAnchoredSections 独立调用使用）
   */
  async _persistRebuildMisses(standardId, misses, tx) {
    const AppStandard = this._appStandard();
    const fields = this._buildMissUpdateData(misses);
    await AppStandard.update(
      { ...fields, updated_at: new Date() },
      { where: { id: standardId }, transaction: tx },
    );
  }

  /**
   * 事务内重建带锚点副本（唯一实现，兼顾独立调用与 updateAnchorBuildStatus 调用）
   *
   * R3-1 算法：
   * 1. 按 section 分组，按 occurrence_index 升序处理
   * 2. 顺序扫描：维护 searchFrom 游标，每个锚点从游标后找 source_text 首次出现
   * 3. 回退 1：游标后找不到 → 从 0 搜一次（容忍 agent 输出顺序小偏差）
   * 4. 回退 2：精确匹配失败 → 归一化模糊匹配（全角/半角/空白折叠）
   * 5. 插入标记并更新游标，为下一条锚点保持推进
   *
   * @param {string} standardId
   * @param {object} tx - Sequelize 事务对象
   * @returns {Promise<{sections: number, anchors: number, misses: Array}>}
   */
  async _rebuildAnchoredSectionsInTx(standardId, tx) {
    const RefAnchor = this._refAnchor();
    const AnchoredSection = this._anchoredSection();

    const anchors = await RefAnchor.findAll({
      where: { standard_id: standardId },
      order: [['source_outline_id', 'ASC'], ['occurrence_index', 'ASC']],
      raw: true,
      transaction: tx,
    });

    if (anchors.length === 0) return { sections: 0, anchors: 0, misses: [] };

    const byOutline = {};
    for (const a of anchors) {
      if (!byOutline[a.source_outline_id]) byOutline[a.source_outline_id] = [];
      byOutline[a.source_outline_id].push(a);
    }

    const DocOutline = this.db.getModel('document_outline');
    const outlineIds = Object.keys(byOutline);
    const outlineRows = await DocOutline.findAll({
      where: { id: outlineIds },
      attributes: ['id', 'revision_id', 'original_text', 'text_hash'],
      raw: true,
      transaction: tx,
    });
    const outlineMap = {};
    for (const o of outlineRows) outlineMap[o.id] = o;

    const misses = [];
    let sectionCount = 0;

    for (const [outlineId, outlineAnchors] of Object.entries(byOutline)) {
      const outline = outlineMap[outlineId];
      if (!outline || !outline.original_text) {
        misses.push({ outline_id: outlineId, reason: 'outline or original_text not found' });
        continue;
      }

      // ── R3-1 顺序扫描算法 ──
      let anchoredText = outline.original_text;
      let searchFrom = 0; // 游标：从此位置开始搜索（原文坐标，随插入增长）
      let sectionMisses = 0;

      for (const anchor of outlineAnchors) {
        let pos = -1;
        let method = 'exact';
        let matchEnd = 0; // R4-1: 匹配区间在原文字符坐标系下的结束位置

        // 1. 从游标后精确匹配
        pos = anchoredText.indexOf(anchor.source_text, searchFrom);

        // 2. 回退：游标后找不到 → 全文搜一次（agent 顺序偏差）
        if (pos < 0) {
          pos = anchoredText.indexOf(anchor.source_text, 0);
          if (pos >= 0) method = 'exact_fallback';
        }

        // 3. 回退：归一化模糊匹配（全角冒号等 OCR 差异）
        if (pos < 0) {
          const fuzzy = this._findFuzzy(anchoredText, anchor.source_text, searchFrom);
          if (fuzzy) {
            pos = fuzzy.pos; matchEnd = fuzzy.end; method = 'fuzzy';
          } else {
            const fuzzy0 = this._findFuzzy(anchoredText, anchor.source_text, 0);
            if (fuzzy0) { pos = fuzzy0.pos; matchEnd = fuzzy0.end; method = 'fuzzy_fallback'; }
          }
        }

        // R9-5: 4. 回退：片段近似匹配（OCR 极少打坏全部字符——取 source_text 头部滑动窗口在原文中找）
        if (pos < 0) {
          const approx = this._findApproximate(anchoredText, anchor.source_text, searchFrom);
          if (approx) {
            pos = approx.pos; matchEnd = approx.end; method = 'approximate';
          }
        }

        if (pos >= 0) {
          const marker = `<anchor+${anchor.id}>`;
          // R4-1: 模糊匹配时原文字符跨度 ≠ source_text.length（归一化前后差异），
          // 必须用 _findFuzzy 返回的 end（经 tMap 映射回原文坐标系）
          const end = (method === 'fuzzy' || method === 'fuzzy_fallback' || method === 'approximate')
            ? matchEnd
            : pos + anchor.source_text.length;
          anchoredText = anchoredText.slice(0, end) + marker + anchoredText.slice(end);
          searchFrom = end + marker.length; // 推进游标到插入点之后
        } else {
          sectionMisses++;
          misses.push({
            ref_anchor_id: anchor.id,
            outline_id: outlineId,
            source_text: (anchor.source_text || '').slice(0, 80),
            reason: 'source_text not found (OCR/fuzzy mismatch)',
          });
        }
      }

      const matchedCount = outlineAnchors.length - sectionMisses;

      const existingSection = await AnchoredSection.findOne({
        where: { revision_id: outline.revision_id, outline_id: outlineId },
        transaction: tx,
      });

      if (existingSection) {
        await existingSection.update({
          anchored_text: anchoredText,
          source_text_hash: outline.text_hash,
          anchor_count: matchedCount,
          updated_at: new Date(),
        }, { transaction: tx });
      } else {
        await AnchoredSection.create({
          id: Utils.newID(),
          standard_id: standardId,
          revision_id: outline.revision_id,
          outline_id: outlineId,
          anchored_text: anchoredText,
          source_text_hash: outline.text_hash,
          anchor_count: matchedCount,
        }, { transaction: tx });
      }

      sectionCount++;
    }

    return { sections: sectionCount, anchors: anchors.length, misses };
  }

  // ============================================================
  // P0-1: createStandard — 纳管新标准
  // ============================================================

  /**
   * 从文档平台纳管一份标准文档
   *
   * 校验：
   * - 文档存在且 processing_status='ready'（已完成 OCR → Clean → Outline → Chunk → Embedding 全链路）
   * - 文档类型不限：contract / knowledge / department_doc / standard 均可纳管，
   *   纳管成功后会把该文档的 doc_type 改写为 'standard'（类型改写，见下方步骤 6）
   * - document_id 唯一：同一文档只能纳管一次
   *
   * @param {object} params
   * @param {string} params.document_id - 文档平台 documents.id
   * @param {string} params.standard_type - national / industry / enterprise / international
   * @param {string} params.standard_code - 标准编号
   * @param {string} params.standard_name - 标准名称
   * @param {string} [params.revision_id] - R9-2: 可选指定版本
   * @param {string} [params.user_id] - 操作人 ID
   * @returns {Promise<object>} 创建的 app_standard 记录
   */
  async createStandard({ document_id, standard_type, standard_code, standard_name, revision_id, user_id, enterprise_id }) {
    // ---- 1. 校验文档存在与处理状态（类型不限，纳管时改写为 standard） ----
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(document_id, {
      attributes: ['id', 'doc_type', 'processing_status', 'current_revision_id', 'collection_id'],
      raw: true,
    });
    if (!doc) {
      const err = new Error(`Document not found: ${document_id}`);
      err.status = 404;
      throw err;
    }

    if (doc.processing_status !== 'ready') {
      const err = new Error(
        `Document processing_status must be 'ready' (current: ${doc.processing_status}). ` +
        'The document has not completed the full pipeline (OCR → Clean → Outline → Chunk → Embedding).'
      );
      err.status = 400;
      throw err;
    }

    // ---- 2. 校验 document_id 唯一 ----
    const AppStandard = this._appStandard();
    const existing = await AppStandard.findOne({
      where: { document_id },
      raw: true,
    });
    if (existing) {
      const err = new Error(`Document already onboarded as standard: ${existing.id} (${existing.standard_code} ${existing.standard_name})`);
      err.status = 409;
      throw err;
    }

    // ---- 3. R9-2: 确定版本 —— 若指定 revision_id 则校验其属于该文档 ----
    let effectiveRevisionId = doc.current_revision_id;

    if (revision_id) {
      const DocRevision = this.db.getModel('document_revision');
      const rev = await DocRevision.findOne({
        where: { id: revision_id, document_id },
        attributes: ['id'],
        raw: true,
      });
      if (!rev) {
        const err = new Error(`Revision not found or not belonging to document: ${revision_id}`);
        err.status = 400;
        throw err;
      }
      effectiveRevisionId = revision_id;
    }

    // ---- 4. R11-3: 校验 enterprise_id（如有） ----
    let effectiveEnterpriseId = null;
    if (enterprise_id) {
      const Enterprise = this._enterprise();
      const ent = await Enterprise.findByPk(enterprise_id, { attributes: ['id', 'is_active'], raw: true });
      if (!ent) {
        const err = new Error(`Enterprise not found: ${enterprise_id}`);
        err.status = 400;
        throw err;
      }
      if (!ent.is_active) {
        const err = new Error(`Enterprise is inactive: ${enterprise_id}`);
        err.status = 400;
        throw err;
      }
      effectiveEnterpriseId = enterprise_id;
    }

    // ---- 5. 纳管 ----
    const id = Utils.newID();
    const standard = await AppStandard.create({
      id,
      document_id,
      standard_type,
      standard_code,
      standard_name,
      enterprise_id: effectiveEnterpriseId,
      current_revision_id: effectiveRevisionId,
      is_active: true,
      anchor_build_status: ANCHOR_BUILD_STATUS.PENDING,
      reference_count: 0,
      valid_reference_count: 0,
      suspected_reference_count: 0,
      gap_reference_count: 0,
      invalid_reference_count: 0,
      needs_review: 0,
      has_manual_fix: 0,
      manual_fix_count: 0,
      created_by: user_id || null,
    });

    // ---- 6. 类型改写：把文档平台的文档类型改写为 standard ----
    // 设计意图：纳管=把任意类型文档收编为标准，documents.doc_type 同步改写，
    // 保证文档平台/检索侧与 app_standard 侧类型语义一致
    if (doc.doc_type !== 'standard') {
      await Document.update(
        { doc_type: 'standard' },
        { where: { id: document_id } },
      );
    }

    return standard.toJSON ? standard.toJSON() : standard;
  }

  /**
   * R2-5: updateStandard — 更新标准元数据
   *
   * 可更新字段：standard_name, standard_code, standard_type, is_active, enterprise_id
   * R11-5: 扩展 enterprise_id 用于人工修改企业归属
   *
   * @param {string} standardId
   * @param {object} updates
   * @returns {Promise<object|null>}
   */
  async updateStandard(standardId, updates = {}) {
    const AppStandard = this._appStandard();
    const standard = await AppStandard.findByPk(standardId, { raw: true });
    if (!standard) return null;

    const allowed = ['standard_name', 'standard_code', 'standard_type', 'is_active', 'enterprise_id'];
    const data = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        data[key] = updates[key];
      }
    }

    // R11-5: 校验 enterprise_id（如有）
    if (data.enterprise_id !== undefined) {
      if (data.enterprise_id !== null) {
        const Enterprise = this._enterprise();
        const ent = await Enterprise.findByPk(data.enterprise_id, { attributes: ['id', 'is_active'], raw: true });
        if (!ent) {
          const err = new Error(`Enterprise not found: ${data.enterprise_id}`);
          err.status = 400;
          throw err;
        }
        if (!ent.is_active) {
          const err = new Error(`Enterprise is inactive: ${data.enterprise_id}`);
          err.status = 400;
          throw err;
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return standard;
    }

    data.updated_at = new Date();
    await AppStandard.update(data, { where: { id: standardId } });
    return await AppStandard.findByPk(standardId, { raw: true });
  }

  // ============================================================
  // R11: 企业花名册 CRUD
  // ============================================================

  /**
   * 列出企业花名册
   * @param {object} [options]
   * @param {boolean} [options.include_counts] 是否附带各企业标准计数
   * @returns {Promise<Array>}
   */
  async listEnterprises(options = {}) {
    const Enterprise = this._enterprise();
    const enterprises = await Enterprise.findAll({
      order: [['name', 'ASC']],
      raw: true,
    });

    if (options.include_counts && enterprises.length > 0) {
      const AppStandard = this._appStandard();
      const counts = await AppStandard.findAll({
        where: { is_active: 1, enterprise_id: { [Op.ne]: null } },
        attributes: ['enterprise_id', [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'cnt']],
        group: ['enterprise_id'],
        raw: true,
      });
      const countMap = {};
      for (const c of counts) countMap[c.enterprise_id] = Number(c.cnt);

      return enterprises.map(e => ({ ...e, standard_count: countMap[e.id] || 0 }));
    }

    return enterprises;
  }

  /** 获取单个企业 */
  async getEnterprise(enterpriseId) {
    const Enterprise = this._enterprise();
    return await Enterprise.findByPk(enterpriseId, { raw: true });
  }

  /**
   * 新建企业
   * name 唯一冲突 → 409
   */
  async createEnterprise({ name, name_en, description, user_id }) {
    const Enterprise = this._enterprise();

    // 唯一性检查（DB 有唯一键兜底，这里提前给出友好错误）
    const existing = await Enterprise.findOne({ where: { name }, raw: true });
    if (existing) {
      const err = new Error(`Enterprise name already exists: "${name}" (id: ${existing.id})`);
      err.status = 409;
      throw err;
    }

    const id = Utils.newID();
    const record = await Enterprise.create({
      id,
      name,
      name_en: name_en || null,
      description: description || null,
      is_active: true,
      created_by: user_id || null,
    });

    return record.toJSON ? record.toJSON() : record;
  }

  /**
   * 更新企业（改名/停用/描述）
   */
  async updateEnterprise(enterpriseId, updates = {}) {
    const Enterprise = this._enterprise();
    const existing = await Enterprise.findByPk(enterpriseId, { raw: true });
    if (!existing) return null;

    const data = {};
    if (updates.name !== undefined) {
      // 唯一性检查
      const dup = await Enterprise.findOne({
        where: { name: updates.name, id: { [Op.ne]: enterpriseId } },
        raw: true,
      });
      if (dup) {
        const err = new Error(`Enterprise name already exists: "${updates.name}" (id: ${dup.id})`);
        err.status = 409;
        throw err;
      }
      data.name = updates.name;
    }
    if (updates.name_en !== undefined) data.name_en = updates.name_en;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.is_active !== undefined) data.is_active = updates.is_active ? 1 : 0;

    if (Object.keys(data).length === 0) return existing;

    data.updated_at = new Date();
    await Enterprise.update(data, { where: { id: enterpriseId } });
    return await Enterprise.findByPk(enterpriseId, { raw: true });
  }

  // ============================================================
  // R11-2: classifyPreview — 归属推断预览
  // ============================================================

  /**
   * 根据文档标题 + 封面文本推断标准归属
   *
   * 规则（确定性，不写 AI）：
   * - standard_code 前缀 → standard_type
   * - Q/ 系 → enterprise，再从标题/封面文本匹配花名册企业名
   *
   * @param {{ document_id: string, revision_id: string }}
   * @returns {Promise<{ standard_type: string, standard_code: string, standard_name: string, enterprise_id: string|null, enterprise_name: string|null }>}
   */
  async classifyPreview({ document_id, revision_id }) {
    const Document = this.db.getModel('document');

    // 1. 获取文档标题
    const doc = await Document.findByPk(document_id, {
      attributes: ['id', 'title'],
      raw: true,
    });
    if (!doc) {
      const err = new Error(`Document not found: ${document_id}`);
      err.status = 404;
      throw err;
    }

    const title = doc.title || '';

    // 2. 尝试获取首节文本（用于企业匹配的辅助文本）
    let firstSectionText = '';
    try {
      const DocOutline = this.db.getModel('document_outline');
      const firstOutline = await DocOutline.findOne({
        where: { revision_id, seq: 0 },
        attributes: ['original_text'],
        raw: true,
      });
      if (firstOutline?.original_text) {
        firstSectionText = firstOutline.original_text;
      }
    } catch (_) {
      // 首节获取失败不阻塞主逻辑
    }

    // 3. 从标题解析编号和名称
    const { standard_code, standard_name, standard_type } = this._parseStandardFromTitle(title);

    // 4. 企业匹配（仅 enterprise 类型）
    let enterprise_id = null;
    let enterprise_name = null;

    if (standard_type === 'enterprise') {
      const searchText = (title + ' ' + firstSectionText.slice(0, 500)).toLowerCase();
      const enterprise = await this._matchEnterprise(searchText);
      if (enterprise) {
        enterprise_id = enterprise.id;
        enterprise_name = enterprise.name;
      }
    }

    return { standard_type, standard_code, standard_name, enterprise_id, enterprise_name };
  }

  /**
   * 从标题解析标准编号和名称
   *
   * 现有导入标题多含前缀编号，如：
   * - "QC T 636-2000 汽车电动玻璃升降器" → code=QC/T 636-2000, name=汽车电动玻璃升降器
   * - "GB/T 19001-2016 质量管理体系" → code=GB/T 19001-2016, name=质量管理体系
   *
   * 解析策略：找标题开头的标准编号前缀，剩余部分为名称
   */
  _parseStandardFromTitle(title) {
    if (!title || !title.trim()) {
      return { standard_code: '', standard_name: '', standard_type: '' };
    }

    const trimmed = title.trim();

    // 已知标准前缀列表（含常见分隔符）
    const prefixPatterns = [
      /^(GB[/\s]*T?\s*[\d.\-]+)/i,
      /^(ISO[/\s]*[\d.\-]+)/i,
      /^(IEC[/\s]*[\d.\-]+)/i,
      /^(Q[/\s]*[\d.\-]+)/i,
      /^([A-Z]{1,4}[/\s]*T?\s*[\d.\-]+)/i,  // QC/T, JB/T, YC/T 等行业标准
    ];

    let standard_code = '';
    let standard_name = trimmed;

    for (const pattern of prefixPatterns) {
      const m = trimmed.match(pattern);
      if (m) {
        standard_code = m[1].replace(/\s+/g, '');  // 去除多余空格：QC T → QCT, 但保留 /
        // 美化常见格式：QCT636 → QC/T 636, GBT19001 → GB/T 19001
        standard_code = this._beautifyCode(standard_code);
        standard_name = trimmed.slice(m[0].length).trim().replace(/^[\s\-—–]+/, '');
        break;
      }
    }

    const standard_type = this._inferStandardType(standard_code);

    return { standard_code, standard_name, standard_type };
  }

  /**
   * 美化标准编号格式
   * QCT6362000 → QC/T 636-2000
   * GBT190012016 → GB/T 19001-2016
   */
  _beautifyCode(raw) {
    if (!raw) return raw;

    // 在常见组织后缀后插入 /：QCT → QC/T, GBT → GB/T, JBT → JB/T
    let code = raw;
    code = code.replace(/^(GB|QC|JB|YC|TW|DB)(T)(\d)/i, '$1/T $3');
    code = code.replace(/^(ISO|IEC)(\d)/i, '$1 $2');
    code = code.replace(/^(Q)(\d)/i, '$1/$2');

    // 如果还是纯连写数字，尝试在字母→数字交界处插入空格
    if (!code.includes(' ') && !code.includes('/')) {
      code = code.replace(/([A-Z])(\d)/i, '$1 $2');
    }

    return code;
  }

  /**
   * 根据标准编号前缀推断类型（确定性规则）
   */
  _inferStandardType(code) {
    if (!code) return '';

    const upperCode = code.toUpperCase().trim();
    const normalized = upperCode.replace(/[/\s]+/g, '');

    if (/^GB/.test(normalized) && !/^GBT/.test(normalized)) {
      // 纯 GB 不带 T 也是国标（如 GB 1495-2002）
      // 但 normalized 去掉 / 后 GBT 也可能变成 GBT, 需要特殊处理
      if (normalized.startsWith('GBT')) return 'national';
      return 'national';
    }
    if (/^GBT/.test(normalized)) return 'national';
    if (/^ISO/.test(normalized)) return 'international';
    if (/^IEC/.test(normalized)) return 'international';
    if (/^Q[/\s]/.test(upperCode) || /^Q\d/.test(upperCode)) return 'enterprise';

    // 其余行业代号：QC/T, JB/T, YC/T 等
    const industryPrefixes = ['QC', 'JB', 'YC', 'TW', 'DB', 'CB', 'JT', 'JTJ', 'SY', 'SH', 'HG', 'NB', 'DL', 'SD', 'YD'];
    for (const prefix of industryPrefixes) {
      if (normalized.startsWith(prefix)) return 'industry';
    }

    return '';
  }

  /**
   * 在文本中匹配花名册企业名（包含匹配）
   * 辅助推断，可错可改——不静默创建
   */
  async _matchEnterprise(searchText) {
    if (!searchText || searchText.length < 2) return null;

    const Enterprise = this._enterprise();
    const all = await Enterprise.findAll({
      where: { is_active: true },
      attributes: ['id', 'name'],
      order: [['name', 'DESC']], // 长名优先（如"浙江吉利"优于"吉利"）
      raw: true,
    });

    for (const ent of all) {
      if (searchText.includes(ent.name.toLowerCase())) {
        return ent;
      }
    }

    return null;
  }
}

/**
 * R17-1：构造清洗开工消息（原位于 handlers/standards/clean.js，随编排收编迁入 service）
 */
function buildCleanMessage(documentId, revisionId, standardId) {
  return `请对以下标准文档执行完整的引用清洗（含外部引用和内部交叉引用）。

文档 ID: ${documentId}
版本 ID: ${revisionId}
标准 ID: ${standardId}

请按以下流程执行：

### 阶段 1：获取章节结构
1. 调用 list_revision_sections 获取章节列表，记录 outline_id → title 映射

### 阶段 2：读写交替（核心）
2. **逐批读**：每轮调用 1-3 个 read_section_context（建议 1-3 节），跳过"规范性引用文件""参考文献""前言""范围"等书目章。**读完立刻分析并写入，不攒！**
3. **立刻写**：读完当前这批后，立即识别所有引用并调用 write_anchor_result 写入：
   - 外部引用：对其他标准（GB/T、ISO、QC/T 等）的引用，先落 gap（定位在阶段 3 做）
   - 内部交叉引用：对本文档其他章节的引用（如"符合 3.2.2 条""见 4.3"等），从步骤 1 的章节列表匹配目标 outline_id，直接落 valid
4. **写入前查重**：写某个 section 前先调 list_section_references 看一眼已有记录，从 max(existing_index)+1 开始编号，同 source_text/同 target 的不重复写
5. 写入后立刻回到步骤 2 读下一批，不攒、不等
   效率目标：每批 1-3 章节，~30 轮覆盖全部 51 章节

### 阶段 2.5：长章节必须翻页读完（关键！）
- read_section_context 返回 page_has_more=true 时，**必须**用 page_next_offset 作为 page 继续调用，直到 page_has_more=false 为止
- **禁止**只读第一页就跳过剩余内容；禁止用 read_revision_content 一次性读大节（全文 >5000 字符会被工具结果摘要化，你只能看到摘要看不到正文）
- 返回 overlap_lines>0 表示本页与上一页有行重叠（embedding 上下文连续性设计），写锚点时按 from_line 去重，**不要把重叠处的引用写两遍**
- 读完每页**立即**写该页发现的引用，再翻下一页（与读写交替一致，防止翻页过程中遗忘）
- 同一章节翻页各页共用一个 outline_id，occurrence_index 按页累计递增，不要跨页重复从 0 编号

### 阶段 3：补定位
6. 对已写入的外部 gap 引用，逐条定位目标文档/章节并回写

### 阶段 3.5：完成前 gap 检查（阶段 2 全部完成后执行一次，必须执行）
7. **阶段 2 全部章节处理完毕后**，调用一次 list_reference_gaps(standard_id) 检查剩余 gap：
  - **刚完成清洗时 gap 列表为空属正常**（阶段 2 尚未对任何 gap 做过定位尝试），不要因为"gap 为空"就反复调用或打转，直接进入阶段 3 补定位
  - 如果还有 **尚未尝试处理** 的 gap，**禁止**输出“完成/处理完毕/最终报告”，必须继续做阶段 3
  - 如果这些 gap 你已经逐条尝试定位，但因为系统内缺少对应标准、没有合适版本、没有足够线索等原因仍无法回填，则**允许保留 gap 并收尾**
  - 收尾时必须明确说明：哪些 gap 已尝试处理但仍无法定位，以及无法定位的原因
8. 阶段 3 中，外部引用定位必须优先组合使用以下工具：
  - find_documents_by_standard_code
  - find_documents_by_standard_name
  - get_document_revisions
  - select_revision_candidate
  - find_section_candidates
9. **禁止跳过阶段 3**：即使阶段 2 已经把所有外部引用先落成 gap，也不代表任务完成；gap 只是待回填中间态，不是最终完成态

⚠️ 关键约束：
- source_outline_id 必须是 list_revision_sections 返回的 outline_id 的**逐字复制**
- **禁止重复读取（关键！）**：某个 outline 的正文一旦已被 read_section_context 完整读过（page_has_more=false），**不得再次读取**同一 outline，除非是翻页续读。章节列表（list_revision_sections）每轮返回的内容相同，**不要反复调用它刷新列表**——只有第一次进入阶段 2 或需要确认章节 ID 时才调用。重复读取会把相同内容反复累积进上下文，导致请求超出模型窗口而失败（已发生：GB 11552 因前 5 轮重复读同一章节撑爆 128k 窗口）。
- **跨 outline 独立**：每个 outline 是独立引用作用域，**禁止跨 outline 去重**。同一标准出现在 3.x 章和 4.x 章 → 各写一条，不要因为"另一个章节写过了"就跳过
- **逐子节扫描**：read_section_context 返回的原文按 \`##\` 分界为独立子节，每个子节必须扫描
- OCR 可能导致章节边界不准（如 3.15.1 的正文出现在 3.16 的 chunk 中），读到正文后以正文为准，不要因为 outline 标题对不上就跳过内容
- **收尾门槛**：只有在你已经执行过 list_reference_gaps，并对剩余 gap 逐条尝试过定位后，才允许输出“阶段3完成”“清洗完成”“最终报告”等结束语；允许存在“已尝试但暂时无法回填”的 gap

请开始。`;
}

export default StandardMgrService;
