# Changelog Round 29 - 文档预览语义去兼容化重构

## 审计报告

- 输入：`audit-round29.md`
- 结论：**非阻塞优化项已继续收口**
- 审计轮次：round29

---

## 变更内容

### 1. 变更项 A：将剩余 3 个 legacy ID 字段从前端状态正式类型中移除（P2）

**问题**：`frontend/src/api/docs.ts:124` 对应的 `DocProcessingStatus.ocr_result` 虽已移除 `main_markdown_attachment_id`，但仍保留 `raw_result_attachment_id`、`deliverables_manifest_attachment_id`、`image_manifest_attachment_id` 三个 legacy 技术字段。经核实，这三个字段在前端业务代码中零引用，继续停留在正式类型中只会延续“技术字段仍是前端业务契约”的错误信号。

**修复**：

- `frontend/src/api/docs.ts`：
  - 从 `DocProcessingStatus.ocr_result` 中移除：
    - `raw_result_attachment_id: string | null`
    - `deliverables_manifest_attachment_id: string | null`
    - `image_manifest_attachment_id: string | null`
  - 保留 `preview_markdown_attachment` / `raw_markdown_attachment` 作为状态接口前端唯一 attachment 语义
  - 不修改后端 `getProcessingStatus` 原始响应，保持“后端可宽、前端收口”的兼容策略

**验证**：

1. grep `raw_result_attachment_id|deliverables_manifest_attachment_id|image_manifest_attachment_id` 前端全目录：零结果，确认类型声明与业务消费均已收口
2. 移除后前端类型层不再暴露这 3 个字段，调用方无法再把它们视为正式业务模型组成部分
3. 后端 `server/controllers/doc.controller.js` 未修改，运行时兼容面不受影响

---

### 2. 变更项 B：同步更新任务留痕口径（P2）

**问题**：`audit-round29.md` 将这 3 个字段列为“放行后的后续优化计划”，但用户已明确要求“一并优化掉”，因此需要把该计划转为已执行事实，并补充可验证留痕。

**修复**：

- 新增本文件 `changelog_round29.md`，明确记录：
  - 本轮已完成对剩余 3 个 legacy ID 字段的前端类型收口
  - 继续遵守“不改数据库 / 不改后端响应 / 不扩大为外部系统迁移工程”的边界
  - 本轮性质仍是**收口型小修**，不是新一轮架构治理

---

## 对审计报告的回复

### 认同项

1. **审计报告对剩余 3 个字段的分类正确**：它们属于与 `main_markdown_attachment_id` 同类的契约一致性尾项
2. **审计报告对执行边界的约束正确**：优先改前端类型，不先动后端响应与数据库字段
3. **审计报告对“不要扩大为新工程”的提醒正确**：本轮继续采用同样的最小修补策略

### 本轮执行决策

1. **用户已明确拍板继续优化非阻塞项**，因此本轮把 audit-round29 中的“后续优化计划”转为直接执行项
2. **仍不扩大结论**：只处理前端正式类型尾项，不讨论后端是否彻底下线这些字段，不讨论数据库字段层统一

---

## 新发现的风险点或建议

1. **`DocProcessingStatus.ocr_result` 已完全收口为新语义 attachment 字段**，这意味着后续如果还有人希望在前端继续访问 legacy ID 字段，必须显式修改后端原始响应消费方式或重新把字段引回类型，不能再“顺手用一下”
2. **当前工作树仍混有非本任务改动**，这仍是后续提交边界的主要风险来源，但不属于本轮代码收口动作本身

---

## 提交信息建议

```
fix: 收口 doc processing status 剩余 legacy attachment 类型字段
```

---

## 验证结论

- **前端 grep**：`raw_result_attachment_id|deliverables_manifest_attachment_id|image_manifest_attachment_id` 在 `frontend/src` 中零结果
- **前端正式类型**：`DocProcessingStatus.ocr_result` 现已只暴露 `preview_markdown_attachment` / `raw_markdown_attachment`
- **后端响应**：未修改，兼容面保持稳定
- **任务边界**：未扩大到数据库、后端响应或外部系统迁移

---

✌Bazinga！
