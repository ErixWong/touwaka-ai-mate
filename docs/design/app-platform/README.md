# App Platform 设计入口

本目录保留与 App 平台相关的设计文档、评估材料和历史方案说明，但阅读时必须以当前代码实现为准。

## 先看什么

如果目标是理解当前代码怎么工作，优先看这些实现文档：

1. [../apps/README.md](../apps/README.md)
2. [../apps/current-architecture.md](../apps/current-architecture.md)
3. [../apps/app-generation-guide.md](../apps/app-generation-guide.md)

这些文档比本目录中的设计稿更接近当前实现。

## 当前实现要点

按代码现状，App 平台当前已落地的主链路包括：

- `apps/{appId}/manifest.json` 作为 runtime 描述入口
- `lib/app-runtime-loader.js` 负责加载 manifest、tick、routes、backup
- `lib/app-router-loader.js` 把 app 自定义 routes 挂到 `/api/apps/{appId}/*`
- `server/routes/app-registry.routes.js` 提供 `/api/apps/*` 的注册表接口
- `server/services/app-registry.service.js` 负责已安装 app、runtime 校验、config、clock-registry 查询
- `server/services/app-market.service.js` 负责从 Registry 拉取并安装 app
- `frontend/src/views/AppsView.vue` 提供“我的应用 / 应用市场”双 Tab 页面
- `frontend/src/components/AppMarketPanel.vue` 是当前应用市场面板组件
- `frontend/src/views/AppDetailView.vue` 是 app 详情页装配入口

## 本目录文档怎么理解

| 文档 | 当前建议 |
|------|----------|
| [app-market-design.md](./app-market-design.md) | 作为市场设计参考，组件命名和入口位置以现代码为准 |
| [database-schema.md](./database-schema.md) | 作为数据库设计参考，事件驱动章节当前未实现 |
| [app-custom-api-design.md](./app-custom-api-design.md) | 作为目标架构参考；`contract-v2` 迁移尚未完成 |
| [page-design.md](./page-design.md) | 作为页面设计参考，组件命名与 UI 落点以现代码为准 |
| [development-plan.md](./development-plan.md) | 历史开发计划，不能直接当成当前状态 |
| [dev-readiness.md](./dev-readiness.md) | 历史就绪评估快照 |
| [review.md](./review.md) | 旧整合设计稿的审查记录 |
| [ADR-mini-app-retirement.md](./ADR-mini-app-retirement.md) | 架构决策背景材料 |

## 结论

- 本目录不是“当前实现说明书”。
- 本目录主要用于保留 App 平台的设计背景、规划目标和历史评审材料。
- 凡是涉及“当前代码到底怎么写”的问题，一律以 `docs/apps/` 和实际代码为准。

---

*最后更新: 2026-06-21*
