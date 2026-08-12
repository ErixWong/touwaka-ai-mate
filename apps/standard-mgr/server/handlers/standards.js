/**
 * standards handler
 *
 * GET  /api/apps/standard-mgr/standards — 列表（R2-4：忽略客户端 enterprise_id）
 * GET  /api/apps/standard-mgr/standards/:standardId — 详情
 * POST /api/apps/standard-mgr/standards — 纳管新标准（P0-1：从文档平台纳管标准文档）
 *
 * 路由扁平化（R2-3）：合并原 list.js + get.js 为单文件，按 ctx.params.standardId 有无分流。
 */

import StandardMgrService from '../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

// R3-3：去掉 ? — 路由器 extractNamedParams 不支持 ? 语法，
// 用 ':' 即可；少一段时不提取参数，自然走列表分支
export const route = {
  path: '/standards/:standardId',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    // R2-4：在企业对象用户映射落地前，忽略客户端传入的 enterprise_id
    // 统一按"不过滤"处理，由 getStandard/listStandards 内部按实际需求处理

    if (ctx.params.standardId) {
      // 获取单个标准详情
      const standard = await service.getStandard(ctx.params.standardId);
      if (!standard) {
        ctx.throw(404, 'Standard not found');
      }
      ctx.success(standard);
      return;
    }

    // 列出标准
    const standard_type = ctx.query.standard_type || null;
    const is_active = ctx.query.is_active !== undefined ? parseInt(ctx.query.is_active, 10) : undefined;

    // R2-4 过渡策略：不过滤 enterprise_id，返回全部
    const standards = await service.listAllStandards({ standard_type, is_active });
    ctx.success(standards);
  } catch (err) {
    logger.error(`[standard-mgr] standards error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}

/**
 * POST /api/apps/standard-mgr/standards — 纳管新标准
 *
 * 入参：{ document_id, standard_type, standard_code, standard_name }
 * - document_id：文档平台 documents.id
 * - standard_type：national / industry / enterprise / international
 * - standard_code：标准编号，如 "GB/T 19001-2016"
 * - standard_name：标准名称
 *
 * 校验：文档存在、processing_status='ready'、document_id 不重复；
 * 文档类型不限（contract / knowledge / department_doc / standard 均可），
 * 纳管成功后 documents.doc_type 改写为 'standard'
 */
export async function post(ctx, deps) {
  try {
    // R2-4：纳管操作需要管理员权限
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);
    const body = ctx.request.body;

    const { document_id, standard_type, standard_code, standard_name, revision_id, enterprise_id } = body || {};

    // 参数校验
    if (!document_id) {
      ctx.error('document_id is required', 400);
      return;
    }
    if (!standard_type) {
      ctx.error('standard_type is required', 400);
      return;
    }
    if (!standard_code) {
      ctx.error('standard_code is required', 400);
      return;
    }
    if (!standard_name) {
      ctx.error('standard_name is required', 400);
      return;
    }

    const result = await service.createStandard({
      document_id,
      revision_id,
      standard_type,
      standard_code,
      standard_name,
      enterprise_id: enterprise_id || undefined,
      user_id: userId,
    });

    // P1-3 触发①：纳管完成后异步执行 gap 回填（不阻塞主请求）
    // R2-2: 传递 standard_id（而非仅 document_id），用标准编号做归一化比较
    service.runGapBackfill({
      trigger: 'onboard',
      standard_id: result.id,
    }).catch(err => {
      logger.error(`[standard-mgr] backfill-onboard failed: ${err.message}`);
    });

    // R13-3 + R17-1：纳管完成后异步触发锚点清洗（不阻塞主请求）
    // 编排全部在 service.runCleaningPipeline 内完成（原子锁、清 auto、驱动 agent、置 done、重建、回填）
    const chatService = deps.request?.chatService;
    if (chatService && result.document_id && result.current_revision_id) {
      service.runCleaningPipeline(result.id, {
        session: ctx.state.session,
        chatService,
      }).then(pipeResult => {
        if (!pipeResult.accepted) {
          logger.info(`[standard-mgr] R13-3: 清洗已被抢占，跳过自动清洗 standard=${result.id}`);
        }
      }).catch(err => {
        logger.error(`[standard-mgr] auto-clean-onboard failed for ${result.id}: ${err.message}`);
      });
    } else {
      logger.warn(`[standard-mgr] R13-3: chatService 不可用或缺少 document/revision，跳过自动清洗 standard=${result.id}`);
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] createStandard error: ${err.message}`);
    const status = err.status || (err.message?.includes('not found') ? 404 : null)
      || (err.message?.includes('already') ? 409 : null)
      || (err.message?.includes('must be') ? 400 : null)
      || 500;
    ctx.error(err.message, status);
  }
}

/**
 * PUT /api/apps/standard-mgr/standards/:standardId — 更新标准元数据
 *
 * 可更新字段：standard_name, standard_code, standard_type, is_active
 * 需要管理员权限（R2-4）。
 */
export async function put(ctx, deps) {
  try {
    // R2-4：管理员权限校验
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;
    const body = ctx.request.body;

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const result = await service.updateStandard(standardId, body);
    if (!result) {
      ctx.error('Standard not found', 404);
      return;
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] updateStandard error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

/**
 * DELETE /api/apps/standard-mgr/standards/:standardId — 删除标准
 *
 * R19: 删除标准及其全部引用锚点数据（app_standard_ref_anchor /
 * app_standard_anchored_section / app_standard），文档平台内容不受影响。
 * 清洗中（processing）禁止删除 → 409。
 */
async function del(ctx, deps) {
  try {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;
    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const result = await service.deleteStandard(standardId, { user_id: getUserId(ctx) });
    if (!result) {
      ctx.error('Standard not found', 404);
      return;
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] deleteStandard error: ${err.message}`);
    ctx.error(err.message, err.status || 400);
  }
}

export { del as delete };
