# App 平台边界定义

> 本文档定义 Phase B 收口后的目标架构。当前仓库事实正在向此方向收敛。

---

## 1. 核心概念

| 概念 | 定义 |
|------|------|
| **App** | 在宿主平台上运行的业务扩展单元，含元数据、配置、运行时 handler、数据表 |
| **Registry** | App 的唯一管理面——负责 App CRUD、配置、runtime 检查、clock registry |
| **Market** | App 的分发与安装面——负责 index 拉取、安装、卸载、升级、依赖检查 |
| **Wildcard Runtime** | App 的运行时执行面——`/api/apps/:appId/*` 由 wildcard router 接管 |

---

## 2. Service 职责矩阵

### 2.1 AppRegistryService — 管理面（真相源）

**唯一负责**：App 元数据 + Config + Clock + Runtime 检查

| 能力 | 方法 |
|------|------|
| App 列表 | `getAccessibleApps(userId)` |
| App 详情 | `getAppById(appId)` |
| App 创建 | `createApp(data)` |
| App 更新 | `updateApp(appId, data)` |
| App 删除 | `deleteApp(appId)` |
| Config 读取 | `getAppConfig(appId)` |
| Config 更新 | `updateAppConfig(appId, configData)` |
| Manifest | `getAppManifest(appId)` |
| Runtime 检查 | `getAppWithRuntime(appId)`, `validateAppRuntime(appId)` |
| Clock | `getClockRegistry(appId)`, `updateClockRegistry(appId, data)` |
| 已安装列表 | `listInstalledApps()` |

### 2.2 AppMarketService — 市场面

**唯一负责**：Registry 索引 + 安装/卸载/升级 + 依赖检查

| 能力 | 方法 |
|------|------|
| Registry 配置 | `getRegistryConfig()`, `updateRegistryConfig(updates)` |
| 索引拉取 | `fetchIndex()` |
| App 安装 | `installApp(appId, options)` — 通过 `AppRegistryService.createApp()` 写 App 元数据 |
| App 卸载 | `uninstallApp(appId, options)` — 优先通过 `AppRegistryService.deleteApp()` 删除 App 元数据 |
| 更新检查 | `checkUpdate(appId)` — 优先通过 `AppRegistryService.getAppById()` 读取本地版本 |
| 依赖检查 | `checkDependencies(manifest)` |
| Manifest 拉取 | `fetchManifest(appId)` |

**注意**：Market 的 App 元数据写入、卸载与更新检查主路径已优先委托 `AppRegistryService`。直接访问 `mini_app` 的代码仅作为无 Registry 注入时的兼容 fallback 保留。

### 2.3 MiniAppService — 数据面

**唯一负责**：App 记录 CRUD + 状态汇总 + 对比 + Autonomous App 代理

| 能力 | 方法 |
|------|------|
| 记录 CRUD | `getRecords`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`, `confirmRecord` |
| 批量上传 | `batchUpload(appId, userId, attachmentIds)` |
| 状态汇总 | `getStatusSummary(appId, userId, createdAfter)` |
| 对比 | `getCompareResult`, `compareRecords` |
| 文档内容 | `getDocumentContent(appId, rowId)` |
| 资源 | `getAvailableResources(appId)` |
| Custom Handler | `getCustomHandler(appId, handlerKey)` |
| Extension | `getDistinctValues`, `getDistinctField` |
| Autonomous | `getAutonomousRecords` 等 8 个方法 |

**已移除**：State CRUD、Handler CRUD、State Module（归属旧 `app_state` / `app_row_handler` 机制，表已退役）

---

## 3. 路由拓扑

### 当前状态（Phase B 收口后）

| 路由前缀 | 用途 | 对应 Controller |
|----------|------|-----------------|
| `/api/app-registry/*` | App 管理面（CRUD + Config + Clock + Runtime） | `AppRegistryController` |
| `/api/app-market/*` | App 市场面（安装/卸载/升级） | `AppMarketController` |
| `/api/apps/:appId/*` | App 运行时 wildcard | Wildcard Router |
| `/api/mini-apps/*` | Legacy 记录/数据面 | `MiniAppController`（待后续迁移） |

### 已移除

| 路由 | 说明 |
|------|------|
| `/api/apps/*`（非 `:appId` 形式） | Phase B round01 移除，原为 `/api/app-registry/*` 的镜像 |

---

## 4. 前端 API 消费（目标态）

| 当前路径 | 目标路径 | 状态 |
|----------|----------|------|
| `mini-apps.ts` App CRUD / Config | Registry → `/api/app-registry` | 已迁移，文件名待 Phase C/D 清理 |
| `mini-apps.ts` Record / extension / content / compare | Legacy data → `/api/mini-apps` | 兼容保留，待后续迁移 |
| `mini-apps.ts` → states/handlers API | 已删除 | 已移除 |

---

## 5. 旧机制退役状态

| 机制 | 状态 |
|------|------|
| `app_state` 表 | Phase 6 migration #45 物理 drop |
| `app_row_handlers` 表 | Phase 6 migration #45 物理 drop |
| State CRUD (MiniAppService) | Phase B round01 删除 |
| Handler CRUD (MiniAppService) | Phase B round01 删除 |
| State Module (getAppStateModule 等) | Phase B round01 删除 |
| `installStates` / `installHandlers` (AppMarketService) | 已标 retired，无害死代码，待后续清扫 |

---

✌Bazinga！
