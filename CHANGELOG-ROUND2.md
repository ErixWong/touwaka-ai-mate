# CHANGELOG-ROUND2 — AUDIT-ROUND2 整改报告

> 日期: 2026-08-03
> 审计报告: AUDIT-ROUND2.md
> 整改范围: N1(重建锚定副本) / N2(构建状态管理) / N3(幂等性) / N4(管理员权限) / N5(数据修复) / N6(e2e验证) / N7(工具名检测)

---

## 变更清单

| R2 编号 | 变更文件 | 类型 | 描述 | 验证结果 |
|---------|----------|------|------|----------|
| R2-1 | `apps/standard-mgr/server/service.js` | 新增 | `rebuildAnchoredSections()` 确定性服务器端锚点重建 | ✅ 4 sections / 10 anchors |
| R2-2 | `apps/standard-mgr/server/handlers/standards/build-status.js` (NEW) + `service.js` | 新增 | `POST /standards/:id/build-status` 端点，status=done 时自动触发 R2-1 | ✅ code=200, rebuild 成功 |
| R2-3 | `service.js` (R2-1 内部) | 修复 | 在 `rebuildAnchoredSections` 内先 DELETE 再 INSERT，天然幂等 | ✅ 二次调用结果一致 |
| R2-4 | `handlers/standards.js` + `build-status.js` | 新增 | POST/PUT /standards 添加 admin 权限检查；新增 `updateStandard()` | ✅ admin 可调用 |
| R2-5 | 环境数据 + `service.js` | 修复 | expert.max_tool_rounds→50; standard_name→汽车电动玻璃升降器; 添加 `updateStandard()` PUT 端点 | ✅ 已修复 |
| R2-6 | — | 阻塞 | `e2e-verify.mjs` 不存在于工作区（已随 task-20260731 归档） | ❌ 无法执行 |
| R2-7 | `scripts/run-anchor-cleaning.mjs` | 修复 | 扩展工具名检测：`toolId` / `toolCallData.tool_name` / `toolCallData.toolName` 等 | ⚠️ 静待实际运行验证 |

---

## 文件级变更详情

### 1. `apps/standard-mgr/server/service.js` (+287/-3)

**新增方法:**

- `_nthIndexOf(str, search, n)` — 查找第 n 次出现位置，用于在原文中定位 anchor 插入点
- `rebuildAnchoredSections(standardId)` — 确定性服务器端锚定副本生成：
  1. 查询该 standard 的所有 `ref_anchors`（含 `source_outline_id`）
  2. 按 `source_outline_id` 分组
  3. 从 `document_outlines` 读取对应章节的 `original_text`
  4. 在 `original_text` 中按 `source_text` 出现顺序依次插入 `<anchor+{ref_anchor_id}>` 标记
  5. 先 DELETE 该 standard 的所有旧 anchored_section，再 INSERT 新记录（保证幂等）
- `_rebuildAnchoredSectionsInTx(standardId, tx)` — 事务版本
- `updateAnchorBuildStatus()` — 修改：status='done' 时自动调用 `_rebuildAnchoredSectionsInTx()`（同一事务）
- `updateStandard(standardId, updates)` — 新增：支持更新 standard_name, standard_code, standard_type, is_active

### 2. `apps/standard-mgr/server/handlers/standards/build-status.js` (NEW)

`POST /api/apps/standard-mgr/standards/:standardId/build-status`
- 管理员权限（R2-4）
- 接收 `{ status, error_message? }`
- 调用 `service.updateAnchorBuildStatus()`

### 3. `apps/standard-mgr/server/handlers/standards.js` (+42)

- `post()`: 添加 `isAdmin` 检查（R2-4）
- `put()`: 新增 PUT /standards/:id handler，admin-only，调用 `updateStandard()`

### 4. `scripts/run-anchor-cleaning.mjs` (+17/-3)

- R2-5: STANDARD_NAME 未设置时输出警告，提示用户设置
- R2-7: 工具名检测逻辑从单字段扩展为多字段兼容：
  ```
  event.data?.toolId || event.data?.toolCallData?.tool_name
  || event.data?.toolCallData?.toolName || event.data?.tool_name
  || event.data?.toolName || event.data?.name || 'unknown'
  ```

---

## 运行验证结果

### R2-1: 锚定副本重建 ✅

```
POST /standards/mscvpwwvq5wyxs385v20/build-status {status:"done"}
→ sections: 4, anchors: 10, misses: 8
```

8 个 miss 全部是 OCR 误差（如 "4.3.1 的规定"、"按GB/T 2828 中一般检查水平"），原文 OCR 文本与 source_text 不完全匹配，属于已知限制。

### R2-3: 幂等性 ✅

第二次调用相同端点 → sections: 4, anchors: 10, misses: 8（完全一致，无重复记录）

### R2-5: 数据修复 ✅

- `standard_name`: "QC T 636-2000" → "汽车电动玻璃升降器"
- `expert.max_tool_rounds`: NULL → 50

---

## 架构反思

### 根因分析：为何这些问题会发生？

| 问题 | 根因 | 教训 |
|------|------|------|
| **N1: anchored_sections 从未生成** | 链条断裂：agent 负责 cleaning → cleaning 产出 ref_anchors → 但没有代码实际生成 anchored_text。agent 调用 `create_standard` 时从来没传过 `anchored_text` 参数。设计上由 agent 掌管 "原文改写" 是不现实的（LLM 会改写原文）。 | **不要将确定性数据转换任务委托给 LLM**。锚点插入是字符串操作，应在服务器端用代码完成。 |
| **N2: anchor_build_status 永远 pending** | 缺少状态机终态处理。只有 `processing` → `pending` 的状态变更（cleaning 脚本），但没有 `done` / `failed` 的设置入口。 | **状态机设计必须封闭**：每个状态都需要对应的 API/入口。如果只定义了状态枚举但无法到达，那状态就是死状态。 |
| **N4: 无管理员权限检查** | 模板/默认缺失。handlers/standards.js 是新文件，没有 admin 防护。build-status 也是新端点。 | **安全防护应入门即配**：每个新 handler 默认需要认证+授权，用默认安全（secure-by-default）模式。 |
| **N5: 数据字段混乱** | standard_code 存了完整名称 "QC T 636-2000 汽车电动玻璃升降器"，standard_name 只有编号 "QC T 636-2000"。cleaning 脚本没有区分这两个字段。 | **数据契约先行**：纳管接口的参数语义应在调用方明确，不能依赖"agent 自己理解"。 |
| **N7: 工具名检测不兼容** | SSE 事件格式在不同 LLM provider 间不统一。stream-*.mjs 只检测了 `tool_name`，但某些 provider 用 `toolId`。 | **Event Schema 需要 normalize 层**：不同 source 的 SSE 事件应在采集层统一格式，不要在每个 consumer 中做兼容判断。 |

### 改进建议（非本轮范围）

1. **默认安全中间件**：App Wildcard Router 应能注入全局 auth middleware，所有 handler 默认要求认证。
2. **状态机 DSL**：为 app 状态设计声明式状态机（XState 或自定义），自动验证状态转移合法性。
3. **数据契约**：在 `apps/{appId}/server/service.js` 中定义输入 schema（Zod/Joi），统一参数语义。
4. **SSE Normalizer**：在 SSE 事件采集层做格式统一，避免 consumer 端做多格式兼容。

---

## 未完成项

### R2-6: e2e-verify.mjs 收敛

**状态**: 阻塞（文件不存在）

`e2e-verify.mjs` 属于已归档 task-20260731，不在当前工作区。该文件可能需要以下修改：
- 将 `content_units` 遍历改为以 `anchored_sections` + anchor 数量为验证标准
- 移除 "跳过 P0" 逻辑，因为 R2-1 已将锚点生成纳入 `build-status=done` 流程

**建议**: 由 PM Kilo 从归档恢复该文件，或在下一次 task 中处理。

### R2-7: 工具名检测

代码已修改但未在真实 SSE 事件上验证。需要运行一次完整 cleaning 并检查 trajectory 中 tool_name 是否正确解析。

---

## 提交计划

```bash
git add apps/standard-mgr/server/service.js
git add apps/standard-mgr/server/handlers/standards.js
git add apps/standard-mgr/server/handlers/standards/build-status.js
git add scripts/run-anchor-cleaning.mjs
git add CHANGELOG-ROUND2.md
git commit -m "fix(standard-mgr): AUDIT-ROUND2 整改

R2-1: 实现服务器端确定性锚点重建 rebuildAnchoredSections()
R2-2: 新增 POST /standards/:id/build-status 端点
R2-3: 先 DELETE 再 INSERT 确保幂等
R2-4: 添加管理员权限检查 & updateStandard() PUT 端点
R2-5: 修复标准名称/专家参数 + STANDARD_NAME 警告
R2-7: 扩展工具名检测兼容多种 SSE 格式

R2-6 阻塞：e2e-verify.mjs 不在工作区"
```
