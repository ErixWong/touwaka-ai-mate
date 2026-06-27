# Round 9 最终事实对账记录

> 目的：基于最终仓库事实完成一次性闭环对账，使审计人员可不运行页面仅靠文档和 grep 结果复核。

> **最终事实基准**：GenericMiniApp.vue 已在 Round 8 物理删除，Round 9 同步清理了 `components.d.ts` 中的残留类型声明。以下所有对账项均基于当前仓库最终事实。

---

## 1. invoice-mgr API 调用方对账

| 检查命令 | 当前仓库事实 | 期望结果 | 是否通过 |
|----------|-------------|----------|----------|
| `grep -rn "from '@/api/invoice'" frontend/src/components/invoice/` | InvoiceList.vue:3, InvoiceDetail.vue:4 | InvoiceList.vue 和 InvoiceDetail.vue 均通过 @/api/invoice 调用 | ✅ |
| `grep -rn "from '@/api/mini-apps'" frontend/src/components/invoice/` | InvoiceList.vue:4 (仅 newID) | 仅 InvoiceList.vue 保留 newID 工具函数导入，无 records API 调用 | ✅ |
| `grep "mini-apps" frontend/src/components/invoice/InvoiceDetail.vue` | 无匹配 | InvoiceDetail 完全不依赖 mini-apps.ts | ✅ |

---

## 2. GenericMiniApp 退役对账

| 检查命令 | 当前仓库事实 | 期望结果 | 是否通过 |
|----------|-------------|----------|----------|
| `Test-Path frontend/src/components/apps/GenericMiniApp.vue` | False | 源文件已物理删除 | ✅ |
| `grep -rn "GenericMiniApp" frontend/src/` | 无匹配 | 前端源码中无任何引用 | ✅ |
| `grep -rn "GenericMiniApp" frontend/components.d.ts` | 无匹配 | 自动生成类型声明已清理 | ✅ |
| `grep -rn "GenericMiniApp" frontend/src/views/AppDetailView.vue` | 无匹配 | AppDetailView 不再回退到 GenericMiniApp | ✅ |

**结论**：GenericMiniApp 在前端源码、生成产物、视图引用三个层面均已完全清除。

---

## 3. 旧兼容路由 mini-apps.ts 残留调用方对账

| 检查命令 | 当前仓库事实 | 期望结果 | 是否通过 |
|----------|-------------|----------|----------|
| `grep -rn "from '@/api/mini-apps'" frontend/src/components/apps/ReExtractDialog.vue` | 导入 reExtractRecord | 共享组件，需兼容多 app，此为设计选择 | ✅ |
| `grep -rn "from '@/api/mini-apps'" frontend/src/components/invoice/InvoiceList.vue` | 仅导入 newID | 工具函数导入，不构成 records API 依赖 | ✅ |
| `grep -rn "from '@/api/mini-apps'" frontend/src/components/invoice/InvoiceDetail.vue` | 无匹配 | 已完全迁至 @/api/invoice | ✅ |
| `grep -rn "GenericMiniApp" frontend/src/` | 无匹配 | 已删除，不再是调用方 | ✅ |

**结论**：旧兼容路由 records API 的实际调用方仅为 ReExtractDialog（re-extract，共享组件设计选择）。invoice-mgr 页面组件已完全脱离 mini-apps.ts records 依赖。GenericMiniApp 已从前端彻底删除，不再是任何调用方。

---

## 4. README / changelog / audit 轮次状态对账

| 检查命令 | 当前仓库事实 | 期望结果 | 是否通过 |
|----------|-------------|----------|----------|
| `grep "Round 9" docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/README.md` | 包含 Round 9 更新 | 任务状态同步到最新轮次 | ✅ |
| `grep "/api/apps/invoice-mgr" docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/asset-inventory.md` | 无匹配 | 已修正为 /api/invoice/* | ✅ |
| `grep "InvoiceList\|InvoiceDetail" docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/asset-inventory.md` | 不再作为 mini-apps.ts records 调用方出现 | 与代码事实一致 | ✅ |

---

## 5. 中文乱码修复验证

| 检查命令 | 当前仓库事实 | 期望结果 | 是否通过 |
|----------|-------------|----------|----------|
| `grep "重新提取" frontend/src/components/invoice/InvoiceDetail.vue` | 第 70 行包含完整中文"重新提取数据" | 中文文本完整无乱码 | ✅ |

---

## 6. 审计异议与补充界定

1. **关于 `ReExtractDialog` 使用 `mini-apps.ts` 的 `reExtractRecord`**：这不是遗留问题，而是设计选择——作为共享组件，ReExtractDialog 需要兼容所有 app（包括 legacy apps），因此必须通过统一入口调用。退役门槛不应设为"不再使用 mini-apps.ts"，而应是"假 prompt 能力已删除且 re-extract 封装正确"，当前已满足。

2. **关于 `scripts/upgrade-database.js:708` 和 `models/mini_app.js:36` 中的 GenericMiniApp 引用**：这两处是数据库 DDL/模型中的 COMMENT 字段，描述的是 `component` 列为 NULL 时的原始设计语义（"NULL=使用GenericMiniApp"）。由于（a）`models/` 为自动生成产物，禁止手改；（b）`upgrade-database.js` 是历史迁移脚本，修改其注释无实际收益且可能引入风险，因此这两处保持不变。这是历史文档性引用，不影响运行时逻辑。

---

## 7. 退役类变更收口标准（流程补充）

> 以下标准从本次 GenericMiniApp 清理中提炼，作为后续同类任务的统一模板。

删除/退役类变更必须同时完成以下四层收口，缺一不可：

1. **源文件删除**：移除被废弃的源码文件
2. **引用清理**：移除所有对该文件/组件的 import 引用和运行时依赖
3. **生成产物刷新**：清理类型声明（如 `components.d.ts`）、自动生成缓存等产物
4. **验证对账**：grep 验证 + 文档同步，确认源码、引用、产物、文档四类证据完全一致

---

## 8. 放行判断规则（Round 11 新增）

> 以下规则从本轮审计中提炼，用于明确"可放行"与"继续整改"的判断标准。

### 8.1 放行前提条件

任务可放行必须同时满足以下条件：

1. **阻断项清零**：所有审计报告 P1 级问题均已关闭
2. **任务状态单一**：README.md、changelog、审计结论三者的终态判断一致，不允许"进行中"和"已放行"并存
3. **证据链完整**：主文档无乱码、无缺字、可被审计人员直接复核
4. **工作树边界清晰**：本任务 changelog 只记录本任务范围内的改动，其他任务的改动已明确剥离

### 8.2 剩余项分类

放行后仍可保留"长期观察项"，但必须明确分类：

| 分类 | 定义 | 是否构成本任务阻断 |
|------|------|-------------------|
| **阻断项** | 必须在当前任务中解决，否则无法交付 | 是 |
| **长期观察项** | 当前无法完成，但不影响本任务交付（如需等其他任务完成） | 否 |

### 8.3 禁止并存的终态

以下状态禁止同时存在于任务文档中：
- ❌ "进行中" + "已放行"
- ❌ "约 99% 完成" + "任务已达到可放行条件"
- ❌ "继续整改" + "任务可放行"

### 8.4 文档模板建议

每个任务的 README.md 应包含以下放行判断字段：

```markdown
### 当前状态

**已完成**（或**进行中**）

> **放行判断**：[任务可放行 / 任务需继续整改]
>
> **阻断项清单**：[无 / 列出具体项]
>
> **长期观察项**：[无 / 列出具体项]
```

### 8.5 历史审计文档勘误规则（Round 12 新增）

1. 历史 `audit-round*.md` 原则上**不直接重写正文判断**，避免破坏审计时序证据。
2. 若出现编码损坏、缺字、不可读等问题，允许做**最小必要修复**，但必须在新一轮 changelog 或 audit 中明确记录：
   - 修复原因
   - 修复范围
   - 是否影响原审计结论
3. 优先使用“勘误说明 / 补充说明”方式追加解释，而不是把旧审计结论整体改写成新口径。
4. 后续验证“无乱码残留”时，需明确区分：
   - **允许保留的历史引用/检索示例**
   - **不允许存在的未解释正文乱码**
