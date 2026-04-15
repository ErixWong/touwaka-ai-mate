# Task 001: App 平台基础架构 + 合同管理小程序

## 目标

实现 App 平台的核心基础设施，并交付第一个可用的小程序：**销售合同管理**。

## 设计文档

- [架构设计](../../design/parse3/app-platform-design.md)
- [数据库设计](../../design/parse3/database-schema.md)
- [页面设计](../../design/parse3/page-design.md)

---

## 实施步骤

### Step 1: 数据库迁移

> 产出：7 张新表 + 虚拟列索引

在 `scripts/upgrade-database.js` 的 `MIGRATIONS` 数组末尾添加：

| # | 表名 | 说明 |
|---|------|------|
| 1 | `mini_apps` | 小程序注册表（多维表格定义） |
| 2 | `mini_app_rows` | 数据记录表 + `_status` 虚拟列索引 |
| 3 | `mini_app_files` | 文件关联表（关联 attachments） |
| 4 | `app_row_handlers` | 处理脚本表 |
| 5 | `app_state` | 状态定义表（含脚本绑定） |
| 6 | `app_action_logs` | 脚本执行日志表 |
| 7 | `mini_app_role_access` | 角色访问控制表 |

执行：
```bash
node scripts/upgrade-database.js
node scripts/generate-models.js
```

**验收**：7 张表创建成功，`mini_app_rows` 有 `_status` 虚拟列和 `idx_app_status` 索引。

---

### Step 2: Sequelize Model

> 产出：7 个 model 文件

在 `models/` 目录新增：

| 文件 | 对应表 |
|------|--------|
| `mini_app.js` | `mini_apps` |
| `mini_app_row.js` | `mini_app_rows` |
| `mini_app_file.js` | `mini_app_files` |
| `app_row_handler.js` | `app_row_handlers` |
| `app_state.js` | `app_state` |
| `app_action_log.js` | `app_action_logs` |
| `mini_app_role_access.js` | `mini_app_role_access` |

同时更新 `models/init-models.js` 建立关联关系：
- `mini_apps` hasMany `mini_app_rows` (foreignKey: app_id)
- `mini_apps` hasMany `app_state` (foreignKey: app_id)
- `mini_apps` hasMany `mini_app_role_access` (foreignKey: app_id)
- `mini_app_rows` hasMany `mini_app_files` (foreignKey: record_id)
- `app_state` belongsTo `app_row_handlers` (foreignKey: handler_id)
- `app_row_handlers` hasMany `app_action_logs` (foreignKey: handler_id)

**验收**：`node scripts/generate-models.js` 无报错，model 关联正确。

---

### Step 3: 后端 API — 核心层

> 产出：1 个 controller + 1 个 routes + 1 个 service

#### 3.1 `server/services/mini-app.service.js`

核心 Service，包含：

```
MiniAppService
├── getAccessibleApps(userId)           # 获取用户可访问的 App 列表
├── getAppById(appId)                   # 获取 App 详情（含 fields, states）
├── createApp(data)                     # 创建 App（管理员）
├── updateApp(appId, data)              # 更新 App（管理员）
├── deleteApp(appId)                    # 删除 App（管理员）
│
├── getRecords(appId, userId, { page, size, filter, sort })  # 分页查询记录
├── getRecord(appId, recordId)          # 获取单条记录
├── createRecord(appId, userId, data, attachmentIds)         # 创建记录（含字段校验）
├── updateRecord(appId, recordId, data) # 更新记录（含字段校验）
├── deleteRecord(appId, recordId)       # 删除记录
│
├── confirmRecord(appId, recordId, data) # 用户确认（_status → confirmed）
├── batchUpload(appId, userId, files)   # 批量上传（创建多条记录）
├── getStatusSummary(appId, userId, createdAfter)  # 批量进度统计
│
├── validateData(fields, data)          # 字段校验（required, type）
├── castValue(value, type)              # 类型转换
└── computeTitle(fields, data)          # 自动生成 title
```

关键实现：
- `createRecord`：根据 `app_state` 表的 `is_initial=1` 记录设置初始 `_status`
- `validateData`：支持基础类型 + group + repeating 嵌套校验
- `batchUpload`：每个文件创建一条 `mini_app_rows` + 关联 `mini_app_files`

#### 3.2 `server/controllers/mini-app.controller.js`

RESTful controller，调用 MiniAppService。

#### 3.3 `server/routes/mini-app.routes.js`

```
GET    /api/mini-apps                                    # App 列表
GET    /api/mini-apps/:appId                             # App 详情
POST   /api/mini-apps                                    # 创建 App（admin）
PUT    /api/mini-apps/:appId                             # 更新 App（admin）
DELETE /api/mini-apps/:appId                             # 删除 App（admin）

GET    /api/mini-apps/:appId/data                        # 记录列表（分页）
GET    /api/mini-apps/:appId/data/:recordId              # 记录详情
POST   /api/mini-apps/:appId/data                        # 创建记录
PUT    /api/mini-apps/:appId/data/:recordId              # 更新记录
DELETE /api/mini-apps/:appId/data/:recordId              # 删除记录
POST   /api/mini-apps/:appId/data/batch                  # 批量上传
PUT    /api/mini-apps/:appId/data/:recordId/confirm      # 确认记录
GET    /api/mini-apps/:appId/status-summary              # 批量进度

GET    /api/mini-apps/:appId/states                      # 状态列表
POST   /api/mini-apps/:appId/states                      # 创建状态（admin）
PUT    /api/mini-apps/:appId/states/:stateId             # 更新状态（admin）
DELETE /api/mini-apps/:appId/states/:stateId             # 删除状态（admin）

GET    /api/handlers                                     # 脚本列表
POST   /api/handlers                                     # 创建脚本（admin）
PUT    /api/handlers/:handlerId                          # 更新脚本（admin）
DELETE /api/handlers/:handlerId                          # 删除脚本（admin）
GET    /api/handlers/:handlerId/logs                     # 执行日志
POST   /api/handlers/:handlerId/test                     # 测试脚本
```

#### 3.4 注册路由

在 `server/index.js` 中引入 mini-app routes。

**验收**：用 Postman/curl 测试基本 CRUD 接口可正常返回。

---

### Step 4: 时钟调度器 + 处理脚本

> 产出：1 个调度器 + 2 个处理脚本

#### 4.1 `lib/app-clock.js`

```
AppClock
├── start()                             # 启动定时扫描
├── stop()                              # 停止
├── tick()                              # 执行一次扫描
├── processState(state, records)        # 处理特定状态的记录
├── executeHandler(handler, context)    # 执行脚本
├── triggerImmediate()                  # 立即触发一次（上传后调用）
└── loadScript(handlerPath)             # 动态加载脚本模块
```

核心逻辑：
1. 查询所有 `app_state` 中 `handler_id IS NOT NULL` 的状态
2. 对每个状态，查询 `mini_app_rows WHERE app_id=? AND _status=? LIMIT batch_size`
3. 加载脚本，执行 `process(context)`
4. 根据结果更新 `_status` 和 `data`
5. 写入 `app_action_logs`

#### 4.2 `scripts/app-handlers/ocr-service/index.js`

OCR 处理脚本：
- 读取关联文件 → 调用 markitdown MCP → 失败回退 mineru MCP
- 返回 `{ _ocr_text, _ocr_service, _ocr_status }`

#### 4.3 `scripts/app-handlers/llm-extract/index.js`

LLM 提取脚本：
- 读取 `record.data._ocr_text`
- 根据 App 的 `fields`（`ai_extractable: true`）构建 Prompt
- 调用 LLM → 解析 JSON → 返回提取的字段

#### 4.4 集成到 `server/index.js`

在 ApiServer.start() 中启动 AppClock，在 shutdown 中停止。

**验收**：创建一条 `pending_ocr` 记录，时钟自动处理到 `pending_review`。

---

### Step 5: 前端 — 基础设施

> 产出：路由、导航、API 模块

#### 5.1 路由

`frontend/src/router/index.ts` 新增：

```typescript
{ path: 'apps', name: 'apps', component: () => import('@/views/AppsView.vue') },
{ path: 'apps/:appId', name: 'app-detail', component: () => import('@/views/AppDetailView.vue') },
```

#### 5.2 导航

`frontend/src/components/AppHeader.vue` 新增 App 导航项（位于"解决方案"之后）。

#### 5.3 API 模块

`frontend/src/api/mini-apps.ts`：

```typescript
getApps()                                    # 获取 App 列表
getApp(appId)                                # 获取 App 详情
createApp(data)                              # 创建 App
updateApp(appId, data)                       # 更新 App
deleteApp(appId)                             # 删除 App
getRecords(appId, params)                    # 获取记录列表
getRecord(appId, recordId)                   # 获取记录详情
createRecord(appId, data)                    # 创建记录
updateRecord(appId, recordId, data)          # 更新记录
deleteRecord(appId, recordId)                # 删除记录
batchUpload(appId, files)                    # 批量上传
confirmRecord(appId, recordId, data)         # 确认记录
getStatusSummary(appId, createdAfter)        # 批量进度
```

#### 5.4 i18n

在 `frontend/src/i18n/` 中添加 App 相关的多语言键值。

**验收**：访问 `/apps` 路由可正常渲染，导航栏可见 App 入口。

---

### Step 6: 前端 — 核心组件

> 产出：App 列表页 + 详情页 + GenericMiniApp + 字段组件

#### 6.1 `frontend/src/views/AppsView.vue`

App 列表页（小程序商店）：卡片网格展示。

#### 6.2 `frontend/src/views/AppDetailView.vue`

App 详情页：动态加载 GenericMiniApp 或自定义组件。

#### 6.3 `frontend/src/components/apps/`

```
components/apps/
├── AppCard.vue                # App 卡片（列表页用）
├── AppContainer.vue           # 容器（共享能力注入）
├── GenericMiniApp.vue         # 通用小程序组件（核心！）
├── RecordList.vue             # 记录列表（表格 + 分页 + 筛选）
├── RecordForm.vue             # 记录表单（新增/编辑，根据 fields 自动生成）
├── RecordDetail.vue           # 记录详情（浏览模式）
├── BatchUpload.vue            # 批量上传 + 进度追踪
├── StateBadge.vue             # 状态标签（根据 _status 显示不同颜色）
└── fields/                    # 字段渲染组件
    ├── TextField.vue
    ├── TextAreaField.vue
    ├── NumberField.vue
    ├── DateField.vue
    ├── SelectField.vue
    ├── FileField.vue
    └── BooleanField.vue
```

#### 6.4 GenericMiniApp 核心逻辑

- Tab 切换：列表 / 上传 / 详情
- 列表：根据 `views.list.columns` 渲染表格列，支持分页和排序
- 表单：根据 `fields` 自动渲染输入控件，`ai_extracted` 的字段带 🤖 标记
- 上传：文件上传 → 轮询 `_status` → AI 提取完成 → 预填表单 → 用户确认
- 状态追踪：每 3 秒轮询记录状态，实时更新进度

**验收**：通过 GenericMiniApp 可以完成合同管理的完整 CRUD 操作。

---

### Step 7: 合同管理小程序数据初始化

> 产出：种子数据 SQL

创建 `scripts/init-contract-app.js`，插入：

1. **2 个处理脚本**（`app_row_handlers`）：
   - `handler-ocr`：OCR 识别脚本
   - `handler-extract`：LLM 提取脚本

2. **1 个 App**（`mini_apps`）：
   - 销售合同管理（`contract-mgr`），含完整字段定义和视图配置

3. **6 个状态**（`app_state`）：
   - `pending_ocr` → `pending_extract` → `pending_review` → `confirmed`
   - `ocr_failed`、`extract_failed`（错误状态）

**验收**：执行脚本后，`GET /api/mini-apps` 返回合同管理 App，状态流转链完整。

---

### Step 8: 集成测试 + 联调

> 产出：端到端可运行

测试完整流程：

1. 打开 `/apps` → 看到合同管理卡片
2. 点击进入 → GenericMiniApp 加载 → 显示空列表
3. 点击"上传" → 拖拽合同 PDF → 上传成功
4. 等待 10~30 秒 → 状态从"待OCR"变为"待确认"
5. 点击记录 → 表单预填 AI 提取结果（带 🤖 标记）
6. 用户修正 → 点击"确认保存" → 状态变为"已确认"
7. 回到列表 → 看到已确认的合同记录

**验收**：以上 7 步全部通过，无报错。

---

## 文件变更清单

### 新增文件

| 目录 | 文件 | 说明 |
|------|------|------|
| `models/` | `mini_app.js` 等 7 个 | Sequelize models |
| `server/controllers/` | `mini-app.controller.js` | API controller |
| `server/routes/` | `mini-app.routes.js` | API 路由 |
| `server/services/` | `mini-app.service.js` | 业务逻辑 |
| `lib/` | `app-clock.js` | 时钟调度器 |
| `scripts/app-handlers/ocr-service/` | `index.js` | OCR 脚本 |
| `scripts/app-handlers/llm-extract/` | `index.js` | LLM 提取脚本 |
| `scripts/` | `init-contract-app.js` | 种子数据 |
| `frontend/src/views/` | `AppsView.vue` | App 列表页 |
| `frontend/src/views/` | `AppDetailView.vue` | App 详情页 |
| `frontend/src/components/apps/` | 8+ 个组件 | App 核心组件 |
| `frontend/src/api/` | `mini-apps.ts` | API 模块 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `scripts/upgrade-database.js` | 添加 7 个迁移项 |
| `server/index.js` | 注册 mini-app 路由 + 启动 AppClock |
| `server/routes/index.js` | 如需要，导出新路由 |
| `frontend/src/router/index.ts` | 添加 `/apps` 路由 |
| `frontend/src/components/AppHeader.vue` | 添加 App 导航项 |
| `frontend/src/i18n/*.ts` | 添加 App 相关翻译 |

---

## 工作量估算

| Step | 内容 | 预估 |
|------|------|------|
| 1 | 数据库迁移 | 1h |
| 2 | Sequelize Model | 0.5h |
| 3 | 后端 API | 4h |
| 4 | 时钟调度器 + 脚本 | 3h |
| 5 | 前端基础设施 | 1.5h |
| 6 | 前端核心组件 | 5h |
| 7 | 种子数据 | 0.5h |
| 8 | 集成测试 | 2h |
| **合计** | | **~17.5h** |

---

## 依赖与风险

| 依赖 | 说明 |
|------|------|
| markitdown MCP | OCR 服务需正常运行 |
| LLM 服务 | 提取脚本需调用 LLM |
| attachment 服务 | 文件上传复用现有服务 |

| 风险 | 缓解 |
|------|------|
| OCR/LLM 调用不稳定 | 时钟自动重试 + 错误状态可手动重置 |
| 前端状态轮询性能 | 轮询间隔可配置，仅对未完成记录轮询 |
| 嵌套字段（group/repeating）复杂 | Phase 1 先只支持基础类型，嵌套类型 Phase 2 补充 |

---

## 分支策略

```
master
  └── feature/app-platform     ← 主开发分支
        ├── step-1-db-migration
        ├── step-2-models
        ├── step-3-backend-api
        ├── step-4-clock-scripts
        ├── step-5-frontend-infra
        ├── step-6-frontend-components
        └── step-7-seed-data
```

或直接在 `feature/app-platform` 分支上按 Step 顺序提交。
