export function registerRouter(app, router) {
  if (!router || typeof router.routes !== 'function' || typeof router.allowedMethods !== 'function') {
    throw new TypeError('registerRouter expects a Koa router instance');
  }

  app.use(router.routes());
  app.use(router.allowedMethods());
  return router;
}
