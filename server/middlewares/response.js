/**
 * Response Middleware - 统一响应格式
 */

const responseMiddleware = () => {
  return async (ctx, next) => {
    // 添加统一响应方法到 ctx
    ctx.success = (data, message = 'success') => {
      ctx.body = {
        code: 200,
        message,
        data,
        timestamp: Date.now(),
      };
    };

    ctx.error = (message, code = 400, error = null) => {
      ctx.status = code >= 500 ? 500 : (code >= 400 ? code : 400);
      ctx.body = {
        code,
        message,
        data: null,
        timestamp: Date.now(),
      };
      if (error && process.env.NODE_ENV !== 'production') {
        ctx.body.error = error;
      }
    };

    await next();
  };
};

export default responseMiddleware;
