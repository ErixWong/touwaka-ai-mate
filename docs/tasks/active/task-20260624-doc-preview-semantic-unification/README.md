# 文档预览语义去兼容化重构

## 目标

- 消除文档预览链路中 `cleaned_markdown_attachment` / `main_markdown_attachment` 的历史兼容分叉
- 建立统一、稳定的领域语义：
  - `preview_markdown_attachment`
  - `raw_markdown_attachment`
- 降低 controller、service、frontend 三层对历史字段优先级的显式理解和分支判断

## 背景

来自 PR `#893` 的多轮审计结论表明，当前主链路虽然可运行，但仍保留以下兼容路径：

- `metadata.cleaned_markdown_attachment_id || main_markdown_attachment_id`
- `cleaned_markdown_attachment || main_markdown_attachment`
- 前后端均暴露"清洗稿/原始稿并列存在，再由消费方选择"的过渡模型

这不符合第一性原理下"当前唯一有效预览稿"的最简模型。

## 范围

- 后端 controller 响应建模
- OCR/清洗/章节提取/分块 service 预览稿消费方式
- 前端 API 类型与 `DocDetailView.vue` 预览/下载区消费方式
- 审计和验证脚本中的预览稿字段使用方式

## 非目标

- 本任务默认不直接改数据库字段
- 如需调整数据库正式字段，必须单独确认后再推进

## 建议里程碑

1. 统一响应语义：新增 `preview_markdown_attachment` / `raw_markdown_attachment`
2. 前端切换到仅消费新语义
3. service 层不再显式理解 `cleaned > main` 历史兼容分支
4. 删除旧兼容字段暴露或将其降级为内部迁移字段

## 当前状态

- 状态：执行中
- 来源：`docs/tasks/archived/task-893-pr-audit/audit-round05.md`

## Audit Round 23 当前边界说明

- **本轮已完成修复**：
  1. P0: 任务边界冻结 - 明确哪些改动属于本任务，哪些不属于
  2. P0: 禁止继续扩大任务范围（过度设计防控）
  3. P1: 新增执行边界说明，明确"可直接执行"vs"必须拍板"的分歧点
  4. P1: 统一超时模型收口 - 阶段字段优先 + 系统 fast_timeout/task_timeout 兜底
  5. P1: 统一语义层完工 - preview_markdown_attachment / raw_markdown_attachment 全面暴露
  6. P2: 排查无遗漏迁移点（搜索确认）
  7. P2: 更新 changelog_round23.md

- **本轮自审补充**：
  - 已排查遗留旧字段直接使用，确认零遗漏迁移点
  - 已补 round23 changelog 留痕

- **本轮修复的问题根因**：
  - 任务边界与工作树事实不完全一致（需明确哪些属于本任务）
  - timeout 模型需要统一收口（fast_timeout / task_timeout 两档）
  - 语义层需要全面暴露（前端/后端消费链路）

- **属于本任务的修改文件**（已验证）：
  | 文件 | 变更内容 |
  |------|----------|
  | `frontend/src/components/docs/DocPipelineConfigDialog.vue` | `loadConfig()` 失败回退默认表单、`resetStage()` 增加 `loadedFromBackend` 保护 |
  | `frontend/src/components/panel/SkillsDirectoryTab.vue` | 移除 preview fallback 文案兜底，统一改为依赖 i18n 正式键 |
  | `frontend/src/components/panel/TasksTab.vue` | 移除 CSV/下载/预览 fallback 文案兜底，统一改为依赖 i18n 正式键 |
  | `frontend/src/i18n/locales/en-US.ts` | 补齐 timeout 收口与任务预览相关翻译键 |
  | `frontend/src/i18n/locales/zh-CN.ts` | 补齐 timeout 收口与任务预览相关翻译键 |
  | `lib/doc-ocr-utils.js` | 新增 getRawAttachmentId、buildOcrSemanticObject、collectOcrAttachmentIds 统一语义层 |
  | `lib/doc-pipeline-defaults.js` | normalizeStageConfig 移除 timeout_ms 镜像，新增 cleanupStageConfigForWrite |
  | `lib/internal-llm-timeout.js` | 新增 getFastTimeoutMs / getTaskTimeoutMs，internal_llm 映射到 task_timeout |
  | `lib/document-clean-service.js` | 使用 getRawAttachmentId 替代直接 main_markdown_attachment_id，移除 timeout_ms 双读 |
  | `lib/document-outline-service.js` | 使用 getPreviewAttachmentId，移除 timeout_ms 双读 |
  | `lib/document-chunk-service.js` | 使用 getPreviewAttachmentId |
  | `lib/document-ocr-service.js` | 使用 getPreviewAttachmentId，fast_timeout 映射 |
  | `lib/document-embedding-service.js` | 移除 timeout_ms 双读，fast_timeout 映射 |
  | `server/controllers/doc.controller.js` | 使用 buildOcrSemanticObject 和 collectOcrAttachmentIds，暴露新语义字段 |
  | `server/controllers/system-setting.controller.js` | 使用 cleanupStageConfigForWrite，保存后从 DB 重新读取返回 |
  | `server/services/system-setting.service.js` | 新增 fast_timeout / task_timeout 默认值、验证规则和辅助方法 |
  | `apps/doc-ocr-pipeline/tick/index.js` | 使用 getPreviewAttachmentId |
  | `apps/ocr-tool/tick/index.js` | 使用 getPreviewAttachmentId |
  | `frontend/src/api/docs.ts` | 新增 preview_markdown_attachment / raw_markdown_attachment 类型 |
  | `frontend/src/views/DocDetailView.vue` | 使用新语义字段 |
  | `frontend/src/components/settings/SystemConfigTab.vue` | 简化为 fast_timeout / task_timeout 两档 |
  | `frontend/src/stores/systemSettings.ts` | 更新超时类型以匹配两档模型 |
  | `scripts/stop-stuck-ocr.js` | 使用 collectOcrAttachmentIds |
  | `scripts/verify-doc-platform-mineru.js` | 验证新语义字段 |
  | `scripts/verify-real-mineru-doc-ocr.js` | 验证新语义字段 |
  | `scripts/verify-document-ocr-service-offline.js` | 修复过时方法名，补充语义层文档 |

- **不属于本任务的修改**（需分流到其他任务或暂缓）：
  | 文件 | 说明 |
  |------|------|
  | 无 | 当前工作树未跟踪残留已清理完毕 |

- **本轮状态边界**：
  - **已完成**：
    1. 任务边界冻结：当前 `git status` 中 26 个已跟踪修改文件均已被解释归属；
    2. 执行边界固化：已写明“可直接执行 / 必须拍板 / 禁止扩大”；
    3. 最小留痕闭环：已补 `changelog_round23.md` 与 `VERIFICATION-round23.md`；
    4. 自审核对：已确认 `npm run lint`、`frontend npm run type-check` 通过，且旧字段消费迁移零遗漏；
    5. 工作树净化：`page-snapshot.yml`、`scripts/request-utils.js`、`scripts/verify-round10-fix.js`、`scripts/verify-round10-simple.mjs` 已从工作树清理，不再构成混改噪音。
  - **待继续**：
    1. 不再新增本任务范围内代码改动；
    2. 若需放行级证据，只补真实运行验证记录，不升级为验证框架。
  - **不纳入本任务**：
    1. 无当前未跟踪残留；
    2. 若未来再次出现 round10 历史验证文件，应单独分流处理，不默认并入本任务。

- **可直接执行项（本轮已覆盖）**：
  - 所有 round22 提出的核心代码问题已修复
  - 统一语义层已全面暴露到 API 响应
  - 超时模型已统一收口为两档（阶段字段优先 + 系统兜底）
  - 前端已切换到消费新语义字段
  - Service 层不再显式理解 cleaned > main 兼容分支

- **必须拍板的分歧点（本轮已明确）**：
  - **分歧点 1**：timeout 是否要升级为"系统两档唯一事实源"
    - 推荐选项 A：本任务不再改产品口径，只维护当前事实一致
    - 选项 B：另起新任务专门评估 timeout 重构
  - **分歧点 2**：验证是否要继续标准化/脚本化
    - 推荐选项 A：维持最小可复盘证据，不再扩展
    - 选项 B：若未来确有长期需求，再单独立项
  - **分歧点 3**：当前任务是否允许继续吸收其他未提交改动
    - 推荐选项 A：本任务只收 doc preview semantic unification 直接相关项
    - 选项 B：把当前任务升级为综合治理任务

- **禁止继续扩大的点**：
  1. 不要把 timeout 继续扩展成新的产品级配置系统重构
  2. 不要把验证继续扩展成脚本标准化、环境变量抽象、设计模式整理
  3. 不要因为当前工作树里还有别的改动，就默认全部并入本任务
  4. 不要为了"留痕完整"补写大而空的设计文档
  5. 不要把已经能直接解决的小问题，再拆成多轮抽象治理

---

## Audit Round 22 当前边界说明

- **本轮已完成修复**：
  1. P0: 禁止在配置未成功加载时保存占位结构（loadedFromBackend 保护）
  2. P0: 补齐阶段 timeout 的管理员可编辑入口（pending_clean/pending_outline/pending_embedding）
  3. P0: 修复 doc-pipeline.ts timeout 错误口径注释
  4. P1: 按真实阶段结构重建 OCR 配置前端类型（新增 DocPipelineOcrProcessingStage）
  5. P1: 修正 OCR 阶段误导性注释
  6. P1: 为章节提取高门槛参数增加解释说明 panel
  7. P1: 补充 loadMcpServers/loadModels 失败提示
  8. P2: 创建规范任务分支（fix/20260628-audit-round22-followup）

- **本轮提交**：
  - 2bf84ec1 - fix: audit round22 followup - timeout config protection and UI fixes

- **本轮自审补充**：
  - 已补独立验证载体：`docs/tasks/active/task-20260624-doc-preview-semantic-unification/VERIFICATION-round22.md`
  - 已补 `resetStage()` 防护，避免“配置未成功加载”时执行写操作
  - 已补加载失败时表单回退与 `initialForm` 同步，避免误报“未保存配置已丢弃”

- **本轮修复的问题根因**：
  - 配置加载失败时仍可保存默认占位结构，存在误覆盖真实配置风险
  - 阶段 timeout 字段未暴露到配置界面，管理员无法修改关键参数
  - doc-pipeline.ts 注释与运行时事实不一致

## Audit Round 20 当前边界说明

- **本轮已完成修复**：
  1. P0: 确认并统一超时口径（采纳方案 A2：阶段级超时仍为主字段，系统设置为兜底）
  2. P1: 清理 system-setting.controller.js 未使用导入和变量
  3. P1: clean 实跑闭环（真实运行验证通过） ✅
  4. P1: 文档与 changelog 只记录已被仓库事实支撑的结论
  5. P2: 任务流程纠偏（记录现状）

- **本轮真实运行验证**（2026-06-27）：
  - 文档 "Intake mqwg3zehqbktl3kpyf0m" 成功从"待文本清洗"推进到"待章节提取"
  - 处理状态：pending_clean → pending_outline ✅
  - 阶段耗时：约 10 分钟

- **待下轮验证**：
  - 无（clean 实跑验证已完成）

- **本轮修复的问题根因**：
  - 超时口径不一致：文案声称"已统一收口"，但运行时代码仍优先使用阶段级 timeout
  - 代码整洁性回归：控制器中存在未使用的导入和变量

## Audit Round 19 当前边界说明

- **本轮已完成修复**：
  1. P0: 修复 `poll_interval_ms` 写入误删（`lib/doc-pipeline-defaults.js`）
  2. P0: 保存接口返回真实持久化结果（`server/controllers/system-setting.controller.js`）
  3. P1: 统一 embedding 超时口径说明（`DocPipelineConfigDialog.vue`）
  4. P1: 补 clean 真实复测证据（代码层面已验证，需实际运行验证）
  5. P1: 修正分支与任务留痕流程文档

- **待下轮验证**：
  - clean 服务在真实环境中的处理结果

- **本轮修复的问题根因**：
  - `poll_interval_ms` 被写入清理误删：清理函数没有区分"用户可配置字段"和"内部旧字段"
  - 保存接口返回不一致：返回了清理前的对象，而不是数据库实际存储的结果
  - embedding 超时说明不一致：前端注释仍写 `task_timeout`，但代码已改为 `fast_timeout`
