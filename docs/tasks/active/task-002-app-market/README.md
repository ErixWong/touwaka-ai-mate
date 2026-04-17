# Task 002: App Market 小程序市场

## 目标

设计并实现 App 的打包格式、GitHub Registry、管理界面浏览安装机制。

## 设计文档

- [App Market 设计](../../design/parse3/app-market-design.md)

---

## 实施步骤

### Step 1: 创建 Registry 目录结构

在项目根目录创建 `apps/` 目录作为 Registry：

```
apps/
├── README.md
├── index.json              # App 索引
├── contract-manager/       # 合同管理 App
│   ├── manifest.json
│   ├── handlers/
│   └── screenshots/
├── invoice-manager/        # 发票管理 App
│   └── ...
└── _templates/             # App 模板
```

**验收**: 目录结构完整，index.json 包含至少 1 个 App 元数据。

---

### Step 2: 迁移 contract-manager

将现有的 `scripts/init-contract-app.js` 中的种子数据转化为标准 App 目录：

1. 创建 `apps/contract-manager/manifest.json`
2. 复制 `scripts/app-handlers/*` 到 `apps/contract-manager/handlers/`
3. 添加截图（从实际界面截取）
4. 更新 index.json

**验收**: `apps/contract-manager` 目录符合规范，可通过 API 拉取。

---

### Step 3: 后端 AppMarketService

新建 `server/services/app-market.service.js`：

```
AppMarketService
├── fetchIndex()                    # 拉取 Registry 索引
├── fetchManifest(appId)            # 拉取 App manifest
├── fetchHandler(appId, name)       # 拉取处理脚本
├── checkDependencies(manifest)     # 检查 MCP/Skills 依赖
├── installApp(appId, options)      # 安装 App
├── uninstallApp(appId)             # 卸载 App
└── updateApp(appId)                # 更新 App
```

**验收**: 服务可通过 GitHub raw URL 拉取数据。

---

### Step 4: 后端 API 路由

新建 `server/routes/app-market.routes.js`：

```
GET    /api/app-market/index                  # Registry 索引
GET    /api/app-market/apps/:appId            # App 详情
POST   /api/app-market/install                # 安装 App
DELETE /api/app-market/apps/:appId            # 卸载 App
POST   /api/app-market/check-dependencies     # 依赖检查
PUT    /api/app-market/apps/:appId/update     # 更新 App
```

**验收**: 所有路由已注册，仅管理员可访问。

---

### Step 5: 前端 API 模块

新建 `frontend/src/api/app-market.ts`：

```typescript
getAppMarketIndex()
getAppManifest(appId)
installAppFromMarket(appId)
checkDependencies(appId)
uninstallApp(appId)
```

**验收**: API 模块可正常调用后端。

---

### Step 6: 前端 AppMarketTab 组件

新建 `frontend/src/components/settings/AppMarketTab.vue`：

功能：
- 展示 Registry 中的 App 卡片网格
- 分类筛选、搜索
- 点击查看详情弹窗
- "安装"按钮一键部署
- 显示已安装状态

**验收**: 界面可正常渲染，安装流程完整。

---

### Step 7: SettingsView 集成

修改 `frontend/src/views/SettingsView.vue`：

- 在"系统管理"区域添加"App 市场" Tab
- 配置路由：`/system` → activeTab = 'app-market'

**验收**: 管理员可在系统设置中访问 App 市场。

---

### Step 8: 集成测试

完整流程测试：

1. 管理员访问 `/system` → 点击"App 市场"
2. 看到可用 App 列表
3. 点击 App 卡片 → 查看详情 → 确认依赖
4. 点击"安装" → 等待安装完成
5. 访问 `/apps` → 看到新安装的 App
6. 进入 App → 测试上传/处理流程

**验收**: 以上 6 步全部通过。

---

## 文件变更清单

### 新增文件

| 目录 | 文件 | 说明 |
|------|------|------|
| `apps/` | `index.json` | Registry 索引 |
| `apps/contract-manager/` | `manifest.json` | App 元数据 |
| `apps/contract-manager/handlers/` | `ocr-service/index.js` 等 | 处理脚本 |
| `server/services/` | `app-market.service.js` | 服务层 |
| `server/routes/` | `app-market.routes.js` | API 路由 |
| `server/controllers/` | `app-market.controller.js` | 控制器 |
| `frontend/src/components/settings/` | `AppMarketTab.vue` | 市场界面 |
| `frontend/src/api/` | `app-market.ts` | API 模块 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/index.js` | 注册 app-market 路由 |
| `frontend/src/views/SettingsView.vue` | 添加"App 市场" Tab |
| `frontend/src/i18n/*.ts` | 添加 appMarket i18n key |

---

## 工作量估算

| Step | 内容 | 预估 |
|------|------|------|
| 1 | Registry 目录结构 | 1h |
| 2 | 迁移 contract-manager | 1h |
| 3 | AppMarketService | 3h |
| 4 | API 路由 | 2h |
| 5 | 前端 API 模块 | 1h |
| 6 | AppMarketTab.vue | 4h |
| 7 | SettingsView 集成 | 0.5h |
| 8 | 集成测试 | 2h |
| **合计** | | **~13.5h** |

---

## 分支策略

```
master
  └── feature/app-market     ← 主开发分支
```