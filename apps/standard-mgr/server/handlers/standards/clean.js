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

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

const CLEAN_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟

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

    // 并发约束：已在 processing 中则拒绝
    if (standard.anchor_build_status === 'processing') {
      ctx.error('该标准正在清洗中，请勿重复触发', 409);
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

    // 设置状态为 processing（获取锁）
    await service.updateAnchorBuildStatus(standardId, 'processing');

    // 异步执行清洗，不阻塞响应
    runAnchorCleaning({
      chatService,
      db: deps.db,
      userId,
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
 * @param {string} params.standardId - 标准 ID
 * @param {string} params.documentId - 文档 ID
 * @param {string} params.revisionId - 版本 ID
 */
export async function runAnchorCleaning({
  chatService,
  db,
  userId,
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
  return `请对以下标准文档执行完整的引用清洗。

文档 ID: ${documentId}
版本 ID: ${revisionId}
标准 ID: ${standardId}

请按以下流程执行：
1. 调用 list_revision_sections 获取章节结构
2. 逐节通读内容，识别引用
3. 对每个引用定位目标文档/章节
4. 调用 write_anchor_result 写入结果

请开始。`;
}
