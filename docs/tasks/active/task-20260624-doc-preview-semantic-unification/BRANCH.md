# BRANCH

- 来源 PR：`#893`
- 来源分支：`feature/20260618-doc-pipeline-embedding-preview-fixes`
- 建议后续分支：`refactor/20260624-doc-preview-semantic-unification`
- 基线分支：`master`
- 工作性质：跨模块语义收敛 / 去兼容化重构
- 任务来源：`docs/tasks/archived/task-893-pr-audit/audit-round05.md`

## 当前实际状态（Audit Round 23 修复后）

- **当前工作树实际分支**：`fix/20260628-audit-round22-followup`
- **本轮修复提交**：当前会话仅完成代码与任务留痕，未执行 `git commit`
- **修复内容**：
  - A: 统一语义层完工 - lib/doc-ocr-utils.js 新增 getRawAttachmentId / buildOcrSemanticObject / collectOcrAttachmentIds
  - B: 统一超时模型收口 - fast_timeout / task_timeout 两档 + 阶段字段优先
  - C: 前端/后端全面暴露新语义字段
  - D: Service 层不再显式理解 cleaned > main 兼容分支
  - E: 任务边界冻结 - 明确本任务相关/无关改动
  - F: 执行边界固化 - 明确可直接执行 vs 必须拍板的分歧点
- **后续要求**：后续修复应在规范分支上进行，不再继续在 master 上叠加

## 执行边界说明（Round 23 新增）

### 可直接执行项（本轮已覆盖）

1. 所有 round22 提出的核心代码问题已修复
2. 统一语义层已全面暴露到 API 响应
3. 超时模型已统一收口为两档
4. 前端已切换到消费新语义字段
5. 当前工作树 26 个已跟踪修改文件已完成归属说明
6. 当前工作树未跟踪残留已清理完毕

### 必须拍板的分歧点

1. **timeout 是否要升级为"系统两档唯一事实源"** - 推荐维持现状
2. **验证是否要继续标准化/脚本化** - 推荐维持最小证据
3. **当前任务是否允许继续吸收其他改动** - 推荐只收本任务直接相关项

### 禁止继续扩大的点

1. 不要把 timeout 扩展成产品级重构
2. 不要把验证扩展成框架
3. 不要把所有改动默认并入本任务
4. 不要补写大而空的设计文档
