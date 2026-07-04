# App Runtime 检查表

> 用于验证 app 是否符合平台运行时要求。

## 检查项总览

| # | 检查类别 | 说明 |
|---|---------|------|
| 1 | 目录结构 | manifest、tick、migrations 等必要文件 |
| 2 | manifest.json | 必填字段、runtime 配置 |
| 3 | 运行时入口 | tick、server handlers、routes |
| 4 | 数据落地方式 | app 内 migrations 或仓库统一升级脚本 |
| 5 | 状态管理 | states.js（推荐） |
| 6 | LLM 调用规范 | 使用 modelRegistry / callWithRetry |
| 7 | 导入路径规范 | 相对路径正确，不直连 provider |
| 8 | 前端组件 | API、组件、stores |
| 9 | 平台集成 | wildcard / 前端装配 / 路由注册 |
| 10 | 接口契约 | handler 与 service 方法匹配 |
| 11 | 错误处理 | 统一响应格式 |

---

## 1. 目录结构检查

### 必须存在

- [ ] `apps/{appId}/manifest.json` - 应用声明
- [ ] `apps/{appId}/tick/index.js` - 后台任务入口（即使无后台任务也需空实现）
- [ ] `apps/{appId}/server/handlers/` - 业务处理器
- [ ] `apps/{appId}/server/services/` - 业务服务

### 推荐存在

- [ ] `apps/{appId}/states.js` - 状态常量集中定义
- [ ] `apps/{appId}/migrations/install.js` - 安装迁移（若该 app 走 app 内安装链路）
- [ ] `apps/{appId}/migrations/uninstall.js` - 卸载迁移（若该 app 走 app 内安装链路）
- [ ] `apps/{appId}/frontend/` - 前端代码

### 当前检查：`current-feature-analyzer`

```
apps/current-feature-analyzer/
├── manifest.json          ✓ 存在
├── tick/index.js          ✓ 存在
├── states.js              ✓ 存在
├── server/
│   ├── handlers/          ✓ 存在
│   │   ├── uploads.js
│   │   ├── batches.js
│   │   ├── config.js
│   │   ├── rule-sets.js
│   │   └── reports/
│   └── services/          ✓ 存在
│       ├── index.js
│       ├── config.service.js
│       ├── csv-parse.service.js
│       ├── llm-stage-recognition.service.js
│       ├── report-export.service.js
│       ├── rule-set.service.js
│       ├── stage-metrics.service.js
│       ├── upload-session.service.js
│       └── vector-compression.service.js
├── frontend/
│   ├── api/
│   ├── components/
│   ├── composables/
│   ��── stores/
│   └── views/
└── migrations/            ✗ 缺失（但当前表结构由全局升级脚本维护）
```

---

## 2. manifest.json 检查

### 必填字段

- [ ] `id` - 应用唯一标识
- [ ] `name` - 应用显示名称
- [ ] `type` - 应用类型
- [ ] `component` - 前端组件名

### 推荐字段

- [ ] `version` - 版本号
- [ ] `description` - 描述
- [ ] `runtime.tick` - tick 入口路径
- [ ] `config` - 运行配置
- [ ] `fields` - 数据字段定义

### 当前检查：`manifest.json`

| 字段 | 状态 |
|------|------|
| id: "current-feature-analyzer" | ✓ |
| name: "电流采样特征分析" | ✓ |
| version: "0.1.0" | ✓ |
| runtime.tick: "tick/index.js" | ✓ |
| component: "CurrentFeatureAnalyzerView" | ✓ |
| config | ✓ 完整配置 |

---

## 3. 运行时入口检查

### tick 入口

- [ ] `tick/index.js` 存在
- [ ] 导出 `tick` 函数或默认导出包含 tick
- [ ] 函数签名符合 `async function tick(context)`

### 当前检查：tick

```javascript
// apps/current-feature-analyzer/tick/index.js
export async function tick() {
  return { ok: true, skipped: true, reason: 'no_background_work' }
}

export default { tick }
```

✓ 存在，但无实际后台任务（符合"无后台任务"场景）

### server handlers

- [ ] handlers 正确导出 route 元数据
- [ ] 处理函数接收 `(ctx, deps)` 参数

---

## 4. 数据落地方式检查

### 必须确认

- [ ] 若 app 依赖数据库表，必须明确这些表由谁创建
- [ ] 二选一成立即可：
- [ ] `apps/{appId}/migrations/*.js` 提供安装/卸载迁移
- [ ] 或仓库统一升级脚本已显式维护该 app 所需表结构

### 当前检查

| 项 | 状态 |
|----|------|
| app 内 `migrations/install.js` | ✗ 缺失 |
| app 内 `migrations/uninstall.js` | ✗ 缺失 |
| 仓库统一升级脚本 | ✓ `scripts/upgrade-database.js` 已创建 `app_current_feature_rule_sets` 与 `app_current_feature_rule_stages` |

> 注意：当前仓库里“没有 app 内 migrations”不自动等于 runtime 不合规，需以实际数据落地机制为准。

---

## 5. 状态管理检查

### 推荐实现 states.js

- [ ] 导出 `BATCH_STATUS` 批次状态常量
- [ ] 导出 `FILE_ANALYSIS_STATUS` 文件分析状态常量
- [ ] 导出辅助判断函数（`isBatchTerminal`, `isFileAnalysisDone` 等）

### 当前检查：states.js

```javascript
// apps/current-feature-analyzer/states.js
export const BATCH_STATUS = Object.freeze({
  IDLE: 'idle',
  UPLOADING: 'uploading',
  READY: 'ready',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
});

export const FILE_ANALYSIS_STATUS = Object.freeze({ ... });

export function isBatchTerminal(status) { ... }
export function isBatchActive(status) { ... }
export function isFileAnalysisDone(status) { ... }
export function isFileAnalysisActive(status) { ... }
```

✓ 状态常量完整，辅助函数齐全

---

## 6. LLM 调用规范检查

### 必须遵守

- [ ] 使用 `modelRegistry.getDefaultTextModelConfig()` 获取默认模型
- [ ] 使用 `db.getModelConfig(modelId)` 获取指定模型配置
- [ ] 使用 `callWithRetry()` 进行 LLM 调用
- [ ] 禁止直接构造 provider URL
- [ ] 禁止直接读取 `ai_model` 裸数据

### 当前检查：llm-stage-recognition.service.js

```javascript
// ✓ 正确使用 modelRegistry
modelRegistry.init(db);
modelConfig = await this.db.getModelConfig(appConfig.llm_model_id);
if (!modelConfig) {
  modelConfig = await modelRegistry.getDefaultTextModelConfig();
}

// ✓ 正确使用 callWithRetry
const response = await callWithRetry(modelConfig, messages, {
  temperature: appConfig.temperature ?? 0.2,
  max_tokens: appConfig.max_tokens ?? 2000,
  timeout,
  response_format: { type: 'json_object' },
  ...
});
```

✓ LLM 调用完全符合规范

---

## 7. 导入路径规范检查

### 必须遵守

- [ ] 从 `lib/` 导入使用相对路径 `../../../../lib/`
- [ ] 从 `server/services/` 导入使用 `../services/`
- [ ] 禁止使用绝对路径或 project root 别名

### 当前检查

```
apps/current-feature-analyzer/server/services/config.service.js
  → import logger from '../../../../lib/logger.js';        ✓

apps/current-feature-analyzer/server/services/llm-stage-recognition.service.js
  → import logger from '../../../../lib/logger.js';        ✓
  → import { callWithRetry } from '../../../../lib/chat/base-llm.js';  ✓
  → import modelRegistry from '../../../../lib/model-registry.js';   ✓
```

✓ 导入路径规范正确

---

## 8. 前端组件检查

### 必须存在

- [ ] `frontend/api/` - API 调用封装
- [ ] TypeScript 类型定义

### 推荐存在

- [ ] `frontend/components/` - 业务组件
- [ ] `frontend/stores/` - Pinia 状态管理
- [ ] `frontend/views/` - 页面视图

### 当前检查

| 目录 | 状态 |
|------|------|
| frontend/api/current-feature-analyzer.ts | ✓ 249 行，完整 API |
| frontend/components/ | ✓ 存在 |
| frontend/composables/ | ✓ 存在 |
| frontend/stores/ | ✓ 存在 |
| frontend/views/ | ✓ 存在 |

补充：`frontend/src/views/AppDetailView.vue` 已将 `CurrentFeatureAnalyzerView` 注册进 `AppComponentMap`。

---

## 9. 平台集成检查

### wildcard / 前端装配验证

- [ ] legacy 路径 `/api/apps/{appId}/*` 可由 wildcard handler 装配
- [ ] 前端 `component` 已接入 `AppComponentMap` 或当前主装配路径
- [ ] 若存在新前缀 API，已确认对应注册链路可用

### 当前检查

| 项 | 状态 | 说明 |
|----|------|------|
| wildcard handler | ✓ | `server/middlewares/app-wildcard-router.js` 可装配 `apps/current-feature-analyzer/server/handlers/*` |
| 前端组件装配 | ✓ | `frontend/src/views/AppDetailView.vue` 已注册 `CurrentFeatureAnalyzerView` |
| 新前缀链路 | ✓ | 存在 `scripts/test-current-feature-analyzer-prefix.js` 验证 `/api/current-feature-analyzer/*` 与 legacy 前缀 |

说明：`server/controllers/current-feature-analyzer.controller.js` 指向的 `apps/current-feature-analyzer/server/controller.js` 缺失，但这不是当前 app 主运行路径的核心阻塞项。

### services 桥接

```javascript
// server/services/current-feature-analyzer/index.js
export { default as ConfigService } from '../../../apps/current-feature-analyzer/server/services/config.service.js';
export { default as RuleSetService } from '../../../apps/current-feature-analyzer/server/services/rule-set.service.js';
// ...
```

✓ services 桥接正确

---

## 10. 接口契约检查

### 必须遵守

- [ ] handler 调用的 service 方法在真实 service 中存在
- [ ] handler 与 service 的入参语义一致
- [ ] 若 service 已重命名，handler 已同步更新或提供兼容包装

### 当前检查

| handler | 调用 | 真实 service 方法 | 结论 |
|--------|------|-------------------|------|
| `apps/current-feature-analyzer/server/handlers/rule-sets.js` | `listRuleSets/getRuleSet/createRuleSet/updateRuleSet/deleteRuleSet` | `list/getById/create/update/remove` | ❌ 不匹配 |
| `apps/current-feature-analyzer/server/handlers/analysis/run.js` | `analyzeBatch` | 仅发现 `recognize` | ❌ 不匹配 |
| `apps/current-feature-analyzer/server/handlers/reports/index.js` / `reports/export.js` | `generateReport/exportReport` | 仅发现 `buildExcelData` | ❌ 不匹配 |

这是当前 app 是否“真正可运行”的关键检查项。

---

## 11. 错误处理检查

### 必须遵守

- [ ] 使用 `ctx.success()` 返回成功
- [ ] 使用 `ctx.error()` 返回错误
- [ ] 禁止直接返回裸 `ctx.body`

### 当前检查

```javascript
// server/handlers/uploads.js
ctx.success(uploadSessionService.getBatch(batch.batch_id));
// ...
ctx.error('请至少上传一个 CSV 文件', 400);
// ...
ctx.error(err.message, 500);
```

✓ 统一响应格式正确

---

## 检查结论

### current-feature-analyzer 符合度

| 检查项 | 状态 |
|--------|------|
| 1. 目录结构 | ✓ 核心结构完整 |
| 2. manifest.json | ✓ 完整 |
| 3. 运行时入口 | ✓ tick 存在 |
| 4. 数据落地方式 | ✓ 已明确由全局升级脚本维护 |
| 5. 状态管理 | ✓ states.js 完整 |
| 6. LLM 调用规范 | ✓ 完全符合 |
| 7. 导入路径规范 | ✓ 正确 |
| 8. 前端组件 | ✓ 完整 |
| 9. 平台集成 | ✓ 主链路可达 |
| 10. 接口契约 | ❌ 存在多处方法不匹配 |
| 11. 错误处理 | ✓ 统一响应格式 |

### 需要修复的问题

1. **`rule-sets` handler/service 方法不匹配**
2. **`analysis/run` handler/service 方法不匹配**
3. **`reports/*` handler/service 方法不匹配**

### 总体评价

- 宿主接入层面基本符合当前 runtime 要求
- 真正阻塞可运行性的不是 manifest / tick / 前端装配，而是 handler 与 service 之间的接口漂移

---

*文档创建：2026-07-03*
