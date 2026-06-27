# App Legacy mini_app_rows 清理

## 目标

清理 App 平台中仍依赖 `mini_app_rows` 的遗留代码，完成从旧模型到新 Runtime 架构的彻底切换。

## 范围

### 1. doc-ocr-pipeline 运行时依赖

- `apps/doc-ocr-pipeline/tick/index.js` 原先直接读写 `mini_app_rows`（3处）
- **已完成**：已改为只写自治表（`app_contract_mgr_content`），不再回写 `mini_app_rows`

### 2. mini-app.service.js 兼容主路径

- `server/services/mini-app.service.js` 仍保留 `AppState`/`AppRowHandler`/`mini_app_rows` 兼容主路径
- 已标记 LEGACY，需评估是否可安全移除

### 3. extension-table.service.js 中心化查询

- `server/services/extension-table.service.js` 仍以 `mini_app_rows` 为中心查询主表（2处 LEGACY 标记）
- **本轮决策**：正式降级 - 这些方法为**未来能力预留**，当前自治 app 使用硬编码配置，不强制要求接线
- 相关自治查询方法 (`getRecordsWithExtensionAutonomous`, `getRecordWithExtensionAutonomous`) 已预埋但未被生产调用，属于设计选择

### 4. mini-app.routes.js 兼容路由

- `server/routes/mini-app.routes.js` 仍注册 7 条旧路由，标记 `X-Compatibility`
- 包括：record CRUD、batch upload、confirm、re-extract、status summary
- 需评估是否可下线或重定向到 `/api/apps/:appId/*`

### 5. GenericMiniApp 退役完成（Round 6 决定废弃，Round 8 物理删除）

- **GenericMiniApp** (`frontend/src/components/apps/GenericMiniApp.vue`) 是遗留组件，已决定废弃并已物理删除
- **已修复**：`AppDetailView.vue` 不再默认回退到 GenericMiniApp，改为显示明确空状态
- **退役完成**：源文件已删除（Round 8），生成产物已清理（Round 9），前端无任何残留引用
- **约束**：
  - 新 app 禁止接入 GenericMiniApp
  - `mini_app.component` 为空不再等价于 GenericMiniApp，而是"未配置前端组件"

### 6. 自治 app 旧调用方迁移（Round 6 完成）

- `invoice-mgr` 已在后端和前端完全移除对 `mini-apps.ts` records API 的依赖
- **新增 API**：`/api/invoice` (POST create), `/api/invoice/:rowId` (DELETE), `/api/invoice/:rowId/re-extract` (POST)
- 前端 InvoiceList.vue 和 InvoiceDetail.vue 已迁移到 `@/api/invoice` 专属 API

## 排除

- `mini_app_file` 作为 `source_tag` 用于附件上传标签（前端 FileUploader 等），属于功能需要，不在本任务范围
- **contract-mgr-v2 相关问题已拆分至独立任务**：
  - contract-mgr-v2 的主合同管理（使用专属路由 `/api/apps/contract-mgr-v2/*` 和 ContractV2Service）
  - contract-mgr-v2 版本建档链路（已完成独立化改造，使用 `createVersionFromAttachment`）
  - contract-mgr-v2 与 legacy 路由的一致性、权限语义统一等问题
  - 上述问题不再作为本任务阻塞项，后续在独立任务中处理

## 当前状态

**已完成（Round 12 文档收口，待复审归档）**

> **放行判断**：本任务所有阻断项已清零，可放行。剩余共享组件和旧兼容路由为长期退役观察项，不构成本任务阻断。
>
> **任务阶段**：功能与主文档整改已完成；目录暂保留在 `docs/tasks/active/` 仅用于多轮审计收口。当前文档问题清零后，下一步应转入 `review/archived` 流程，而不是继续作为开发中任务长期停留在 `active`。
>
> **阻断项清单**：无（全部已关闭）
>
> **长期观察项**：
> 1. 共享组件（ReExtractDialog）不再需要兼容旧路由（需等其他 app 迁移完成后才能清理）
> 2. 旧兼容路由退役（需等所有 legacy apps 迁移完成后才能清理）

### 工作树改动范围对账（Round 11 新增）

当前工作树（未提交改动）的文件归属如下：

**属于本任务的改动**：

| 文件 | 变更类型 | 对应轮次 |
|------|----------|----------|
| `apps/doc-ocr-pipeline/tick/index.js` | 移除 legacy 回写 | Round 1 |
| `server/services/mini-app.service.js` | isFullyAutonomousApp 修复 | Round 1 |
| `server/services/extension-table.service.js` | 自治查询路径 | Round 1 |
| `frontend/src/components/apps/GenericMiniApp.vue` | 物理删除 | Round 8 |
| `frontend/src/components/apps/ReExtractDialog.vue` | 假 prompt 修复 | Round 6 |
| `frontend/src/views/AppDetailView.vue` | 移除 GenericMiniApp 回退 | Round 6 |
| `frontend/src/api/invoice.ts` | invoice-mgr 专属 API | Round 6 |
| `frontend/src/components/invoice/InvoiceDetail.vue` | 迁移到 invoice API + 中文乱码修复 | Round 6, Round 9 |
| `frontend/src/components/invoice/InvoiceList.vue` | 迁移到 invoice API | Round 6 |
| `server/controllers/invoice.controller.js` | invoice 专属控制器 | Round 6 |
| `server/routes/invoice.routes.js` | invoice 专属路由 | Round 6 |

**属于其他任务（contract-mgr-v2 独立任务）的改动**：

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/contract-mgr-v2/manifest.json` | 新增 | contract-mgr-v2 独立任务 |
| `apps/contract-mgr-v2/server/routes.js` | 新增路由 | contract-mgr-v2 独立任务 |
| `apps/contract-mgr-v2/server/controllers/version-from-attachment.js` | 新增文件 | contract-mgr-v2 版本建档 |
| `frontend/src/api/contract-v2.ts` | 新增 API | contract-mgr-v2 独立任务 |
| `frontend/src/components/contract-v2/ContractDetail.vue` | 修改 | contract-mgr-v2 独立任务 |
| `frontend/src/components/contract-v2/ContractList.vue` | 修改 | contract-mgr-v2 独立任务 |
| `frontend/src/stores/contract-v2.ts` | 新增 store | contract-mgr-v2 独立任务 |
| `server/controllers/contract-v2.controller.js` | 新增控制器 | contract-mgr-v2 独立任务 |
| `server/services/contract-v2.service.js` | 新增服务 | contract-mgr-v2 独立任务 |

> **对账结论**：本任务 changelog 仅记录本任务范围内的改动。contract-mgr-v2 相关 9 个文件的改动属于独立任务，不在本任务 changelog 中记录。

> **数量对账**：当前工作树改动总数 = 本任务 11 个 + 其他任务 9 个 = 20 个文件，与当前 `git status --short` 一致。

- ✅ P0-1: 补齐迁移资产盘点表 (`asset-inventory.md`)
- ✅ P0-2: `extension-table.service.js` 新增自治查询路径 (`getRecordsWithExtensionAutonomous`, `getRecordWithExtensionAutonomous`) - **已预埋，为设计选择**
- ✅ P1-4: 移除 `doc-ocr-pipeline` 中 `contract-mgr` 对 `mini_app_rows` 的直接回写
- ✅ P1-5: 旧兼容路由调用方盘点与退役策略（经盘点决定保留旧路由，架构已正确分流）
- ✅ P1-6: 补齐验证矩阵（lint、自测）
- ✅ P0-1 (Round 5): 修复 `ReExtractDialog.vue` 路由路径错误（/rows/ → /data/）
- ✅ P1-3 (Round 5): 修正资产盘点文档，使旧路由描述与仓库事实一致
- ✅ P1-1 (Round 6): 补齐 `invoice-mgr` 专属 records API (create/delete/re-extract)
- ✅ P1-2 (Round 6): 拆掉 `AppDetailView` 对 `GenericMiniApp` 的默认回退
- ✅ P2-3 (Round 6): 将 `GenericMiniApp` 废弃状态落文档与规则
- ✅ P2-4 (Round 6): `ReExtractDialog` 假 prompt 能力 - **已完成**：已删除假输入能力（修改提示词输入框），只保留历史 prompt/result 展示与重新分析动作

### 范围调整说明（Round 4）

**contract-mgr-v2 相关问题已拆分至独立任务，不再作为本任务范围**：

- contract-mgr-v2 的主合同管理专属架构
- contract-mgr-v2 版本建档链路独立化（已完成，但转入独立任务）
- contract-mgr-v2 与 legacy 路由的一致性、权限语义统一等问题

### 本任务剩余整改目标（Round 6 补充）

1. ~~extension-table.service.js 整改决策~~：已明确为"设计选择"并正式降级
2. ~~legacy 路由退役门槛量化~~：已量化（需自治 app 前端完成迁移）
3. ~~验证文档证据增强~~：已补充
4. ~~自治 app 旧调用方迁移~~：invoice-mgr 已完成迁移
5. ~~文档口径修正~~：资产盘点文档已修正，反映仓库事实
6. ~~GenericMiniApp 退役~~：已落文档和规则，源文件已物理删除（Round 8），生成产物已清理（Round 9）
7. ~~P2-4 ReExtractDialog 假 prompt~~：已完成，已删除假 prompt 输入能力，不再扩展 prompt 修改链路
8. ~~生成产物同步刷新收口标准~~：已补充（Round 9 完善至 SELF-TEST.md）

### 退役类变更收口标准（Round 9 新增）

删除/退役类变更必须同时完成以下四层收口，缺一不可：

1. **源文件删除**：移除被废弃的源码文件
2. **引用清理**：移除所有对该文件/组件的 import 引用和运行时依赖
3. **生成产物刷新**：清理类型声明（如 `components.d.ts`）、自动生成缓存等产物
4. **验证对账**：grep 验证 + 文档同步，确认源码、引用、产物、文档四类证据完全一致

详见 `SELF-TEST.md` 第 7 节。

## 来源

从 `task-20260619-app-generation-guide` 归档时拆出。
