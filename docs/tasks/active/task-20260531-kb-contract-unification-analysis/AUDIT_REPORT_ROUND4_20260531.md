# 统一文档平台审计报告 Round 4

## 1. 报告信息

- 报告轮次：Round 4
- 报告时间：2026-05-31 13:18:50 +08:00
- 审计范围：Round 3 后新增修复与澄清（KB API 迁移、DocAccessService 接入、技能契约清理）
- 审计目标：复核当前分支是否满足既定门槛，并明确下一步收口任务

---

## 2. 本轮结论（Executive Summary）

结论：**修复有效但未完全收口，当前仍为条件式 No-Go（针对“删旧实现”目标）。**

- 正向进展：
  1. 新增 `/api/docs/kb/*` 路由，KB API 已完成路径层迁移映射。
  2. `DocAccessService` 已接入 DocController 的部分读路径。
  3. `kb-recall` 技能调用已统一到 `/api/docs/recall`。
- 仍存阻断：
  1. 旧路由 `/api/kb/*` 仍注册（并行状态）。
  2. ACL 未形成“全链路强制校验”，且访问过滤实现存在潜在运行时问题。
  3. 技能文档与参数契约仍有旧语义残留与示例不一致。

---

## 3. Gate 复核结果

## 3.1 Gate A-1（路由收口）

**状态：部分通过（并行迁移，不是收口）**

### 已完成

- 新路由已增加：`/api/docs/kb/*`
  - 证据：`server/routes/kb-v2.routes.js`
  - 说明：KB CRUD/文章/章节/段落/标签/向量化路径都可在新前缀访问。

### 未完成

- 旧路由仍注册：`/api/kb/*`
  - 证据：`server/index.js` 中 `kbRoutes` 仍 `app.use(...)`
- 启动日志仍输出旧 KB 端点
  - 证据：`server/index.js` 启动日志段落仍有 `/api/kb/articles` 等。

### 评估

- 若本阶段目标为“检索统一 + 路由迁移准备”，可接受。
- 若目标为“单入口 + 删除旧实现”，当前不满足。

---

## 3.2 Gate A-2（ACL 主链接入）

**状态：部分通过（能力雏形已接入，未全链路）**

### 已完成

- 新增权限服务：`lib/doc-access-service.js`
- `listDocuments/getDocument` 已调用访问服务
  - 证据：`server/controllers/doc.controller.js`

### 未完成/风险点

1. **全链路缺失**：`update/createVersion/setCurrent/compare/recall` 等写与敏感操作未统一调用 `canWrite/canApprove`。
2. **ACL 语义未落地**：当前主要是 owner/public/org，可见性规则；`doc_permissions` 细粒度授权未真正接入判定。
3. **实现风险**：`buildAccessFilter` 使用 `this.db.Sequelize.Op`，而 DB 层暴露的是 `this.Op`（`lib/db.js`）。存在运行时兼容风险。

### 评估

- 安全目标尚未达成，不能作为删旧前置通过项。

---

## 3.3 Gate A-3（技能契约一致化）

**状态：部分通过**

### 已完成

- 技能执行代码统一调用 `/api/docs/recall`
  - 证据：`data/skills/kb-recall/index.js`

### 未完成

1. 参数语义仍保留旧模型残影（如 `kb_id` 必填约束保留）。
2. `SKILL.md` 仍混有旧字段叙述与旧返回结构元素。
3. 文档示例存在格式问题（JSON 示例不完整/不一致），易误导调用方。

### 评估

- 契约层尚未达到“文档-实现-调用三一致”。

---

## 4. 关键实现复核（本轮新增）

1. **KB API 全量迁移路线可行**
   - 新增 `kb-v2.routes.js` 将旧 KB 控制器能力映射到 `/api/docs/kb/*`，技术路径正确。
2. **DocController 的一致性修复保持有效**
   - `source_ref_id` 非空写入、`FOR UPDATE` 并发保护、`content-tree` 归属校验仍在。
3. **迁移脚本问题仍需收尾**
   - 合同比对迁移 `created_by` 仍存在保底占位值策略，审计可追溯性不足。

---

## 5. 第一性原理复核（Round 4）

1. **单一入口原则**：未满足（新旧并行）。
2. **最小权限原则**：未满足（细粒度 ACL 未全链路强制）。
3. **一致性原则**：部分满足（版本并发与归属校验已有改善）。
4. **可替换原则**：未满足（旧路由与旧契约仍可走通）。
5. **可审计原则**：部分满足（主体字段追溯仍有残项）。

综合结论：**平台已进入收口后期，但尚未达到“可安全删旧”终态。**

---

## 6. Go / No-Go 判定

### 针对目标 A：检索统一里程碑

- 判定：**Conditional Go**
- 条件：明确声明“本阶段不删除旧路由，仅验证新路径可用”。

### 针对目标 B：统一路由并删除旧实现

- 判定：**No-Go**
- 阻断原因：Gate A-1/A-2/A-3 未完全通过。

---

## 7. Round 5 前必须完成的最小收口项

## P0（阻断）

1. 下线旧 KB 路由注册（`/api/kb/*`），并清理启动日志旧端点输出。
2. 修复 `DocAccessService` 的 `Op` 引用方式，避免运行时风险。
3. 将权限校验扩展到写路径与敏感路径：
   - `updateDocument`
   - `createVersion`
   - `setCurrentVersion`
   - `createCompareRun`
   - `recall`（至少 read 权限边界）

## P1（高优先）

4. 接入 `doc_permissions` 细粒度授权判定（user/role/org_unit）。
5. 统一 `kb-recall` 文档与实现参数契约，移除旧字段残影。

## P2（收尾）

6. 迁移脚本 `created_by` 保底值策略改为可追溯映射（或显式 system actor）。
7. 增加回归测试：
   - 路由收口后 E2E
   - ACL 越权用例
   - 技能参数契约一致性测试

---

## 8. 建议验收标准（Round 5）

必须全部满足：

1. 文档域只保留 `/api/docs/*` 与 `/api/docs/kb/*`（旧 `/api/kb/*` 不可达）。
2. ACL 覆盖读写审批关键路径，越权拦截率 100%。
3. 技能文档/实现/参数校验一致，无废弃字段混用。
4. 关键回归通过：文档 CRUD、版本流转、召回、比对。
5. 审计字段可追溯（owner/org/created_by 无异常占位值）。

---

## 9. 本轮核查文件

- `server/index.js`
- `server/routes/kb-v2.routes.js`
- `server/routes/kb.routes.js`
- `server/controllers/doc.controller.js`
- `lib/doc-access-service.js`
- `lib/db.js`
- `data/skills/kb-recall/index.js`
- `data/skills/kb-recall/SKILL.md`
- `scripts/migrate-contract-to-doc-platform.js`

---

## 10. 结语

本轮修复方向正确，且已进入“收口可见”阶段。建议下一轮以“安全收口优先”推进：先统一入口与权限闭环，再执行删旧，实现可逆风险最小化。

## 11. �����߻ظ���P0 �޸� (commit 0551153)

### P0-1 ��·��������
server/index.js ���Ƴ� kbRoutes �����ע�ᡣ/api/kb/* ���ٿɴ������־�Ѹ���Ϊ /api/docs/kb/*��

### P0-2 Op �������޸�
this.db.Sequelize.Op -> this.db.Op

### P0-3 ACL ȫ��·
| ·�� | У�� |
|------|------|
| listDocuments | buildAccessFilter |
| getDocument | canRead |
| updateDocument | canWrite |
| createVersion | canWrite |
| setCurrentVersion | canWrite |
| createCompareRun | canWrite |
| recall | buildAccessFilter (scope Ĭ��) |
