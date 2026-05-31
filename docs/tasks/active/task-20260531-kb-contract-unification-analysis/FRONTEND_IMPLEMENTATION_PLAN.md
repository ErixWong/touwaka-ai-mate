# 前端改造实施路线 (2026-05-31)

> 基于后端 M1-M4 完成状态，规划前端改造任务。后端已提供 `/api/docs/*` 全套 API。

---

## 1. 现状分析

### 1.1 已透传（无需改动）

| 前端功能 | API | 后端状态 |
|----------|-----|----------|
| KB 全局搜索 | `POST /api/kb/search` | ✅ 底层已切 DocRecallService |
| KB 知识库内搜索 | `POST /api/kb/:id/search` | ✅ 同上 |

### 1.2 待新增/改造

| 范围 | 当前状态 | 目标 |
|------|----------|------|
| 文档平台页面 | 不存在 | 新增 `/docs` 路由 + 页面 |
| 统一搜索 UI | 仅 KB 搜索 | 新增 scope 筛选（知识库/合同/标准） |
| 版本管理 UI | KB 无版本概念 | 新增版本列表、切换、有效期展示 |
| 比对结果页面 | 合同页面内置 | 迁移到统一比对页面 |
| Pinia Store | 无 | 新增 useDocStore / useRecallStore |
| 合同页面 | 走 `/api/mini-apps/*` | 逐步切换 `/api/docs/*` |

---

## 2. 分阶段实施计划

### Phase 1: 最小可用（可测试）

**目标：启动服务器就能验证 API**

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P1.1 新建 `useDocStore` | `stores/doc.ts` | 2h |
| P1.2 新建文档列表页 | `views/DocsView.vue` | 3h |
| P1.3 添加路由 `/docs` | `router/index.ts` | 0.5h |
| P1.4 新建 API 层 | `api/docs.ts` | 1h |
| P1.5 导航栏加入口 | `components/AppHeader.vue` | 0.5h |
| P1.6 i18n 文案 | `locales/zh-CN.ts`, `en-US.ts` | 0.5h |

**Phase 1 验收**: 能访问 `/docs` 看到已回填的文档列表

---

### Phase 2: 文档详情与版本（可用）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P2.1 新建文档详情页 | `views/DocDetailView.vue` | 4h |
| P2.2 文档详情路由 `/docs/:id` | `router/index.ts` | 0.5h |
| P2.3 版本列表组件 | `components/docs/VersionList.vue` | 2h |
| P2.4 版本详情（内容树） | `components/docs/ContentTree.vue` | 2h |
| P2.5 版本状态切换交互 | `components/docs/VersionActions.vue` | 2h |
| P2.6 `useVersionStore` | `stores/version.ts` | 1h |

**Phase 2 验收**: 点击文档可查看版本、内容树、设当前版、状态流转

---

### Phase 3: 统一搜索（增强）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P3.1 新建 `useRecallStore` | `stores/recall.ts` | 1h |
| P3.2 统一搜索组件 | `components/docs/DocRecall.vue` | 3h |
| P3.3 KB 页面增加 scope 筛选 | `KnowledgeBaseView.vue` | 1h |
| P3.4 搜索入口集成到文档页 | `DocsView.vue` | 1h |

**Phase 3 验收**: 在文档页搜索，能看到跨类型结果（知识库+合同）

---

### Phase 4: 合同管理切换

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P4.1 合同数据走 docs API | `components/contract-v2/ContractList.vue` | 2h |
| P4.2 合同详情改用 docs API | `components/contract-v2/ContractDetail.vue` | 3h |
| P4.3 合同比对结果接入统一页面 | `components/docs/CompareResult.vue` | 3h |
| P4.4 `useCompareStore` | `stores/compare.ts` | 1h |
| P4.5 旧 contract-v2 store 标记废弃 | `stores/contract-v2.ts` | 0.5h |

**Phase 4 验收**: 合同列表/详情从 docs API 加载，比对结果统一查看

---

### Phase 5: 清理与收尾

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P5.1 KB 页面标记旧搜索为兼容 | `KnowledgeBaseView.vue` | 0.5h |
| P5.2 API 字段对齐矩阵 | 测试文档 | 1h |
| P5.3 联动调试 | 端到端 | 2h |

---

## 3. 文件创建清单

### 新建文件

```
frontend/src/
├── api/docs.ts                     # 文档平台 API 封装
├── stores/doc.ts                   # 文档主数据 Store
├── stores/recall.ts                # 召回 Store
├── stores/version.ts               # 版本 Store（可选合并到 doc.ts）
├── views/DocsView.vue              # 文档列表页
├── views/DocDetailView.vue         # 文档详情页
└── components/docs/
    ├── VersionList.vue             # 版本列表
    ├── VersionActions.vue          # 版本操作（设当前/状态流转）
    ├── ContentTree.vue             # 内容树
    ├── DocRecall.vue               # 统一搜索组件
    └── CompareResult.vue           # 比对结果展示
```

### 修改文件

```
frontend/src/
├── router/index.ts                 # + /docs, /docs/:id 路由
├── components/AppHeader.vue        # + 文档平台导航入口
├── i18n/locales/zh-CN.ts           # + docs 命名空间
├── i18n/locales/en-US.ts           # + docs 命名空间
├── views/KnowledgeBaseView.vue     # 搜索增加 scope 参数
├── components/contract-v2/
│   ├── ContractList.vue            # API 切换到 docs
│   └── ContractDetail.vue          # API 切换到 docs
└── stores/contract-v2.ts           # 标记废弃
```

---

## 4. API ↔ Store ↔ 组件 映射

| API 端点 | Store 方法 | 组件 |
|----------|-----------|------|
| `GET /api/docs` | `docStore.fetchList()` | `DocsView.vue` |
| `GET /api/docs/:id` | `docStore.fetchDetail()` | `DocDetailView.vue` |
| `GET /api/docs/:id/versions` | `docStore.fetchVersions()` | `VersionList.vue` |
| `POST /api/docs/:id/versions/:vid/set-current` | `docStore.setCurrentVersion()` | `VersionActions.vue` |
| `POST /api/docs/:id/versions/:vid/transition` | `docStore.transitionVersion()` | `VersionActions.vue` |
| `GET /api/docs/:id/versions/:vid/content-tree` | `docStore.fetchContentTree()` | `ContentTree.vue` |
| `POST /api/docs/recall` | `recallStore.search()` | `DocRecall.vue` |
| `POST /api/docs/compare-runs` | `compareStore.create()` | `CompareResult.vue` |
| `GET /api/docs/compare-runs/:id` | `compareStore.fetch()` | `CompareResult.vue` |

---

## 5. 路由设计

```
# 新增路由
/docs                       → DocsView.vue         (文档列表)
/docs/:documentId           → DocDetailView.vue    (文档详情 + 版本)

# 已有路由（改造）
/knowledge                  → KnowledgeBaseView.vue (搜索增加 scope)
/apps/contract-mgr-v2       → AppDetailView.vue     (API 切换到 docs)
```

---

## 6. 验收标准

- [ ] `/docs` 页面加载，显示 2 篇知识库 + 6 篇合同文档
- [ ] 点击文档进入详情，显示版本列表
- [ ] 版本可切换、可设当前版（页面刷新不丢失）
- [ ] 文档页搜索按钮，输入 query 返回跨类型结果
- [ ] 合同列表/详情从 docs API 加载
- [ ] 比对结果可在统一页面查看

---

## 7. 工时估算

| Phase | 工作量 | 依赖 |
|-------|--------|------|
| P1 最小可用 | **7.5h** | 无 |
| P2 详情与版本 | **11.5h** | P1 |
| P3 统一搜索 | **6h** | P2 |
| P4 合同切换 | **9.5h** | P2 |
| P5 清理 | **3.5h** | P4 |
| **合计** | **38h** | |

---

*本路线基于后端 API 已就绪的状态编写，Phase 1 完成后即可开始联调。*
