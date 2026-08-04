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
import DocAccessService from '../../../lib/doc-access-service.js';
import { Op } from 'sequelize';

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

class StandardMgrService {
  constructor(db) {
    this.db = db;
    this.docAccessService = new DocAccessService(db);
  }

  // ============================================================
  // 模型引用
  // ============================================================

  _appStandard() { return this.db.getModel('app_standard'); }
  _refAnchor() { return this.db.getModel('app_standard_ref_anchor'); }
  _anchoredSection() { return this.db.getModel('app_standard_anchored_section'); }

  // ============================================================
  // P1-2: writeAnchorResult — 唯一写入口
  // ============================================================

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

    // ---- 事务写入 ----
    const tx = await this.db.sequelize.transaction();
    try {
      const RefAnchor = this._refAnchor();
      const AnchoredSection = this._anchoredSection();

      // 1. 查找现有记录（幂等键）
      const existing = await RefAnchor.findOne({
        where: { source_revision_id, source_outline_id, occurrence_index },
        transaction: tx,
      });

      let refAnchor;
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
          occurrence_index,
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
    const where = {};

    if (options.is_active !== undefined) {
      where.is_active = options.is_active;
    } else {
      where.is_active = 1;
    }

    if (options.standard_type) {
      where.standard_type = options.standard_type;
    }

    return await AppStandard.findAll({
      where,
      order: [['created_at', 'DESC']],
      raw: true,
    });
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
    return await AppStandard.findOne({
      where: { id: standardId },
      raw: true,
    });
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

    return await RefAnchor.findAll({
      where,
      order: [['source_revision_id', 'ASC'], ['source_outline_id', 'ASC'], ['occurrence_index', 'ASC']],
      limit,
      offset,
      raw: true,
    });
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

    const isCJK = (cp) =>
      (cp >= 0x4E00 && cp <= 0x9FFF)
      || (cp >= 0x3400 && cp <= 0x4DBF)
      || (cp >= 0xF900 && cp <= 0xFAFF);

    // ── 阶段 1：逐字符映射 + 空白折叠 ──
    const raw = [];       // 映射后字符
    const rawPos = [];    // 对应原文位置
    let prevSpace = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const m = FW_MAP[ch] !== undefined ? FW_MAP[ch] : ch;
      if (m === ' ' || m === '\t' || m === '\n' || m === '\r') {
        if (!prevSpace) { raw.push(' '); rawPos.push(i); prevSpace = true; }
      } else {
        raw.push(m); rawPos.push(i); prevSpace = false;
      }
    }

    // ── 阶段 2：移除 CJK 间的 OCR artifact 空格 ──
    // 例："试 验" (OCR 误加空格) → "试验"
    const chars = [];
    const origPos = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === ' '
        && i > 0 && i < raw.length - 1
        && isCJK(raw[i - 1].codePointAt(0))
        && isCJK(raw[i + 1].codePointAt(0))) {
        // CJK 间空格：跳过（不加入 chars/origPos）
        continue;
      }
      chars.push(raw[i]);
      origPos.push(rawPos[i]);
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
    const endN = nPos + searchN.length - 1;
    const endOrig = endN < tMap.length
      ? tMap[endN] + (text[tMap[endN]] !== undefined && /[\u4e00-\u9fff]/.test(text[tMap[endN]]) ? 1 : 1)
      : startOrig + search.length;

    return { pos: startOrig, end: endOrig };
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
          if (!fuzzy) {
            const fuzzy0 = this._findFuzzy(anchoredText, anchor.source_text, 0);
            if (fuzzy0) { pos = fuzzy0.pos; method = 'fuzzy_fallback'; }
          } else {
            pos = fuzzy.pos; method = 'fuzzy';
          }
        }

        if (pos >= 0) {
          const marker = `<anchor+${anchor.id}>`;
          const end = pos + anchor.source_text.length;
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
   * - 文档存在且 doc_type='standard'
   * - 文档 processing_status='ready'（已完成 OCR → Clean → Outline → Chunk → Embedding 全链路）
   * - document_id 唯一：同一文档只能纳管一次
   *
   * @param {object} params
   * @param {string} params.document_id - 文档平台 documents.id
   * @param {string} params.standard_type - national / industry / enterprise / international
   * @param {string} params.standard_code - 标准编号
   * @param {string} params.standard_name - 标准名称
   * @param {string} [params.user_id] - 操作人 ID
   * @returns {Promise<object>} 创建的 app_standard 记录
   */
  async createStandard({ document_id, standard_type, standard_code, standard_name, user_id }) {
    // ---- 1. 校验文档存在与类型 ----
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

    if (doc.doc_type !== 'standard') {
      const err = new Error(`Document must be doc_type=standard (current: ${doc.doc_type})`);
      err.status = 400;
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

    // ---- 3. 纳管 ----
    const id = Utils.newID();
    const standard = await AppStandard.create({
      id,
      document_id,
      standard_type,
      standard_code,
      standard_name,
      current_revision_id: doc.current_revision_id,
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

    return standard.toJSON ? standard.toJSON() : standard;
  }

  /**
   * R2-5: updateStandard — 更新标准元数据
   *
   * 可更新字段：standard_name, standard_code, standard_type, is_active
   * 用于修正纳管时填写不准确的元数据（如名称错填为编号）。
   *
   * @param {string} standardId
   * @param {object} updates
   * @returns {Promise<object|null>}
   */
  async updateStandard(standardId, updates = {}) {
    const AppStandard = this._appStandard();
    const standard = await AppStandard.findByPk(standardId, { raw: true });
    if (!standard) return null;

    const allowed = ['standard_name', 'standard_code', 'standard_type', 'is_active'];
    const data = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        data[key] = updates[key];
      }
    }

    if (Object.keys(data).length === 0) {
      return standard;
    }

    data.updated_at = new Date();
    await AppStandard.update(data, { where: { id: standardId } });
    return await AppStandard.findByPk(standardId, { raw: true });
  }
}

export default StandardMgrService;
