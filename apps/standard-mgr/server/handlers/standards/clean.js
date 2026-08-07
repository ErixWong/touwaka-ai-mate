/**
 * clean handler — 服务端锚点清洗触发器
 *
 * POST /api/apps/standard-mgr/standards/:standardId/clean
 *
 * R13-1: 进程内驱动清洗专家跑一次 AgentLoop，无对话 UI。
 * 完成后自动触发副本重建（R2-2）与 gap 回填（P1-3 触发②）。
 *
 * 并发约束：同一标准已有 processing 运行时拒绝重复触发（409）。
 * 超时上限：15 分钟，超时置 error 并写明原因。
 * 鉴权：以触发操作的管理员身份运行。
 */

import jwt from 'jsonwebtoken';
import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

const CLEAN_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟
const TASK_TOKEN_EXPIRY = '4h'; // 后台任务 token 有效期（需长于清洗超时）

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/clean',
};

export async function post(ctx, deps) {
  try {
    // 管理员权限校验
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('未登录', 401);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    // 获取标准信息
    const standard = await service.getStandard(standardId);
    if (!standard) {
      ctx.error('Standard not found', 404);
      return;
    }

    // 校验文档状态
    const documentId = standard.document_id;
    const revisionId = standard.current_revision_id;
    if (!documentId || !revisionId) {
      ctx.error('标准缺少关联的文档或版本信息', 400);
      return;
    }

    // 获取 chatService（由 server/index.js 注入到 ctx）
    const chatService = deps.request?.chatService;
    if (!chatService) {
      ctx.error('ChatService 不可用', 500);
      return;
    }

    // R14-2：原子锁 — 条件 UPDATE，只有 pending/error/done 才置 processing
    const locked = await service.tryLockForCleaning(standardId);
    if (!locked) {
      ctx.error('该标准正在清洗中，请勿重复触发', 409);
      return;
    }

    // 异步执行清洗，不阻塞响应
    // 生成长期 token 替代用户短期 JWT，防止工具回调 401
    const session = ctx.state.session;
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const taskToken = jwt.sign(
      { userId: userId, role: session.roles?.[0] || 'user' },
      jwtSecret,
      { expiresIn: TASK_TOKEN_EXPIRY },
    );
    const taskSession = { ...session, accessToken: taskToken };

    runAnchorCleaning({
      chatService,
      db: deps.db,
      userId,
      session: taskSession,
      standardId,
      documentId,
      revisionId,
    }).catch(err => {
      logger.error(`[standard-mgr] clean async error for ${standardId}: ${err.message}`);
    });

    ctx.success({ accepted: true, standard_id: standardId });
  } catch (err) {
    logger.error(`[standard-mgr] clean error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}

/**
 * 在服务端进程内执行一次锚点清洗（AgentLoop）。
 *
 * 流程：
 * 1. 查找绑定 skill-standard-anchor 的专家
 * 2. 创建会话 Topic
 * 3. 发送开工消息 → chatService.streamChat()
 * 4. 成功 → updateAnchorBuildStatus(id, 'done')（自动触发副本重建 + gap 回填）
 * 5. 失败/超时 → updateAnchorBuildStatus(id, 'error', msg)
 *
 * @param {Object} params
 * @param {Object} params.chatService - ChatService 实例
 * @param {Object} params.db - 数据库实例
 * @param {string} params.userId - 触发用户 ID
 * @param {Object} params.session - 用户会话对象（含 accessToken，透传给 streamChat 供工具鉴权）
 * @param {string} params.standardId - 标准 ID
 * @param {string} params.documentId - 文档 ID
 * @param {string} params.revisionId - 版本 ID
 */
export async function runAnchorCleaning({
  chatService,
  db,
  userId,
  session,
  standardId,
  documentId,
  revisionId,
}) {
  const service = new StandardMgrService(db);
  let expertId = null;

  try {
    // ── 1. 查找锚点清洗专家 ──
    expertId = await findAnchorExpert(db);
    if (!expertId) {
      throw Object.assign(new Error('未找到标准引用清洗专家，请先运行 scripts/setup-anchor-expert.mjs'), { status: 404 });
    }

    logger.info(`[standard-mgr] 开始清洗: standard=${standardId} doc=${documentId} revision=${revisionId} expert=${expertId}`);

    // R15-6：清空 auto/auto_backfill 记录，从头再生（manual/user_confirmed 永久保留）
    const deletedCount = await service.deleteAutoRefAnchors(standardId, revisionId);
    logger.info(`[standard-mgr] 清洗前置清理: 删除 ${deletedCount} 条 auto 记录`);

    // ── 2. 创建会话 ──
    const topicId = await chatService.createNewTopic(userId, expertId, `标准清洗 — ${standardId}`, null);

    // ── 3. 构造开工消息 ──
    const content = buildCleanMessage(documentId, revisionId, standardId);

    // ── 4. 驱动 AgentLoop ──
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
        // onDelta — 可以留空，清洗不需要实时推送
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

    // ── 5. 根据结果更新状态 ──
    if (result.ok) {
      await service.updateAnchorBuildStatus(standardId, 'done');
      logger.info(`[standard-mgr] 清洗完成: standard=${standardId}`);
    } else {
      await service.updateAnchorBuildStatus(standardId, 'error', result.error);
      logger.warn(`[standard-mgr] 清洗失败: standard=${standardId} error=${result.error}`);
    }
  } catch (err) {
    logger.error(`[standard-mgr] 清洗异常: standard=${standardId} ${err.message}`);
    try {
      await service.updateAnchorBuildStatus(standardId, 'error', err.message);
    } catch (statusErr) {
      logger.error(`[standard-mgr] 更新错误状态失败: ${statusErr.message}`);
    }
  }
}

/**
 * 查找绑定 skill-standard-anchor 的专家 ID
 */
async function findAnchorExpert(db) {
  const ExpertSkill = db.getModel('expert_skill');
  const Expert = db.getModel('expert');
  const Skill = db.getModel('skill');

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
 * 构造清洗开工消息
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

### 阶段 3：补定位
6. 对已写入的外部 gap 引用，逐条定位目标文档/章节并回写

⚠️ 关键约束：
- source_outline_id 必须是 list_revision_sections 返回的 outline_id 的**逐字复制**
- **跨 outline 独立**：每个 outline 是独立引用作用域，**禁止跨 outline 去重**。同一标准出现在 3.x 章和 4.x 章 → 各写一条，不要因为"另一个章节写过了"就跳过
- **逐子节扫描**：read_section_context 返回的原文按 \`##\` 分界为独立子节，每个子节必须扫描
- OCR 可能导致章节边界不准（如 3.15.1 的正文出现在 3.16 的 chunk 中），读到正文后以正文为准，不要因为 outline 标题对不上就跳过内容

请开始。`;
}
