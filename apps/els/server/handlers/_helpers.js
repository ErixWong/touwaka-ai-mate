/**
 * ELS 公共 helpers — 供 wildcard handlers 复用
 * 
 * 注意：本文件不会被路由匹配（请求段不会以 _ 开头），仅作为内部工具模块。
 */

import logger from '../../../../lib/logger.js';

export const ERROR_HTTP_STATUS = {
  ELS_NOT_FOUND: 404,
  ELS_FORBIDDEN: 403,
  ELS_INVALID_STATUS: 409,
  ELS_MATERIAL_BLOCKED: 422,
  ELS_UPLOAD_REJECTED: 422,
  ELS_NOTEBOOK_EMPTY: 400,
};

export function getUserId(ctx) {
  return ctx.state?.session?.id;
}

/**
 * 统一错误包装：捕获业务异常并映射 HTTP 状态码
 */
export async function safeCall(ctx, fn) {
  try {
    await fn();
  } catch (error) {
    logger.error(`[ELS] ${ctx.method} ${ctx.path} — ${error.message}`);

    const code = error.code || 'ELS_INTERNAL_ERROR';
    const status = ERROR_HTTP_STATUS[code] || error.status || 500;

    ctx.error(code, status, error.message);
  }
}
