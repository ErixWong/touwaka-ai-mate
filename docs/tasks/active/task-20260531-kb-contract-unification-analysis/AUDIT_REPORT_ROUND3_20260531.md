# 统一文档平台审计报告 Round 3

## 1. 报告信息

- 报告轮次：Round 3
- 报告时间：2026-05-31 12:48:39 +08:00
- 审计范围：Round 2 之后的修复有效性复检（Doc Controller、统一召回、迁移脚本、技能契约、路由收口）
- 审计目标：判断是否达到“统一路由 + 可删除旧实现”的上线门槛

---

## 2. 本轮复检结论（Executive Summary）

结论：**部分修复有效，但仍为 No-Go**。

- 核心链路质量持续提升（版本并发控制、内容归属校验、创建约束等已修复）
- 但仍存在 3 个阻断项未完成：
  1. 旧路由未下线（`/api/kb/*`、`/api/mini-apps/*` 仍注册）
  2. ACL 权限模型未贯通（`doc_permissions` 未进入主判定链）
  3. 技能文档契约仍残留旧参数语义（易导致调用误用）

因此，当前仍不满足“删除旧实现”的条件。

---

## 3. Round 2 关键问题复测状态

## 3.1 已确认修复有效

1. **`source_ref_id` 非空约束修复**
   - 状态：通过
   - 证据：`server/controllers/doc.controller.js`
   - 说明：`createDocument` 以新生成 `docId` 同时写入 `id` 与 `source_ref_id`，避免 null 冲突。

2. **`getContentTree` 归属校验补齐**
   - 状态：通过
   - 证据：`server/controllers/doc.controller.js`
   - 说明：新增 `versionId + documentId` 归属检查，不再只按 `versionId` 直接读内容。

3. **current 版本并发保护（FOR UPDATE）**
   - 状态：通过
   - 证据：`server/controllers/doc.controller.js`
   - 说明：`setCurrentVersion` 事务中保留行锁，符合并发一致性要求。

4. **召回模型过滤能力保留**
   - 状态：通过（能力存在）
   - 证据：`lib/doc-recall-service.js`
   - 说明：SQL 层支持 `embedding_model_id` 过滤条件。

5. **数据库 current 唯一性抽样检查**
   - 状态：通过
   - 执行结果：`doc_versions` 未检出“同一 document 多 current”异常（0 行）。

## 3.2 仍未修复（阻断）

1. **旧路由未收口（阻断）**
   - 状态：未通过
   - 证据：`server/index.js`
   - 表现：`kbRoutes` 仍注册；Mini-app 路由仍可用并打印相关日志。
   - 影响：无法实现“统一 API/路由”终态，系统仍双入口。

2. **ACL 未接入主判定链（阻断）**
   - 状态：未通过
   - 证据：`server/controllers/doc.controller.js`
   - 表现：`DocPermission` 模型加载但未参与读写鉴权；当前主要依赖 owner/public/org 过滤。
   - 影响：细粒度授权（user/role/org_unit）无法生效。

3. **技能契约文档仍不一致（阻断）**
   - 状态：未通过
   - 证据：`data/skills/kb-recall/SKILL.md`
   - 表现：文档声明已切 `/api/docs/recall`，但参数与示例仍残留 `kb_id/kb_ids/context_mode` 等旧语义。
   - 影响：工具调用方可能继续传废弃参数，造成行为偏差。

## 3.3 部分修复但仍需收尾

1. **迁移脚本 created_by 硬编码**
   - 状态：部分通过
   - 证据：`scripts/migrate-contract-to-doc-platform.js`
   - 说明：v1 版本创建者已改为 owner 映射；但 compare run 迁移仍有保底值写入（`'0'`）。

---

## 4. 数据面核查结果（本轮）

- `doc_documents` 来源分布：
  - `contract_mgr`: 8
  - `contract_mgr_v2`: 2
  - `kb`: 2
- `doc_versions` 多 current 检查：0 条异常

判定：数据已具备统一平台基础，但仍需权限与路由收口来完成架构闭环。

---

## 5. 第一性原理复核（Round 3）

1. **单一入口原则**：未满足（旧入口仍存在）。
2. **安全优先原则**：未满足（ACL 细粒度授权未落地）。
3. **一致性原则**：基本满足（current 切换并发保护有效）。
4. **能力闭环原则**：部分满足（Doc 核心可跑，但契约与治理未收口）。
5. **可运维退役原则**：未满足（仍无法安全删旧）。

综合结论：**当前架构处于“可运行但未收口”的阶段，不能作为最终替换版本。**

---

## 6. Go / No-Go 判定

- 判定：**No-Go**
- 原因：以下 Gate 未通过
  1. Gate-A1：旧文档路由下线
  2. Gate-A2：`doc_permissions` 权限主链接入
  3. Gate-A3：技能参数契约与文档一致化

---

## 7. Round 4 前强制修复清单（最小集合）

## A. 路由收口（必须）

1. 在 `server/index.js` 移除文档相关旧路由注册（KB、Mini-app 文档能力）。
2. 启动日志与 API 文档同步更新，避免误导。

## B. ACL 主链接入（必须）

1. 封装统一 `DocAccessService`（读/写/审批/管理）。
2. `list/get/create/update/version/compare/recall` 全链路调用权限服务。
3. 增加越权回归测试（含 user/role/org_unit 三类主体）。

## C. 技能契约一致化（必须）

1. `kb-recall/SKILL.md` 移除旧字段语义，改为 `/api/docs/recall` 参数模型。
2. 标注兼容策略（若仍接受旧字段，需明确映射规则和废弃期限）。

## D. 迁移脚本收尾（建议）

1. compare run 的 `created_by` 改为来源映射策略，禁止固定占位值。
2. 回填报告新增“主体字段完整性”统计（owner/org/created_by）。

---

## 8. Round 4 验收标准

必须全部满足：

1. 文档域仅保留 `/api/docs/*` 主入口。
2. ACL 命中日志可审计，越权拦截率 100%。
3. 技能文档、参数、实现三者一致。
4. 对账通过：无关键主体字段异常。
5. 关键回归（文档、版本、召回、比对）通过率达标。

---

## 9. 本轮核查文件清单

- `server/index.js`
- `server/controllers/doc.controller.js`
- `lib/doc-recall-service.js`
- `scripts/migrate-contract-to-doc-platform.js`
- `data/skills/kb-recall/SKILL.md`

---

## 10. 最终建议

在不满足 Gate-A（路由收口 + ACL 接入 + 契约一致化）前，不执行“删除旧实现”。

---

## 11. 开发者回复：Gate A-1 路由收口分析

### 结论

Gate A-2（DocAccessService）和 Gate A-3（SKILL.md 契约清理）已于 2026-05-31 修复（commit d5acc03）。

Gate A-1（旧路由下线）不在本轮重构范围。

### 路由分工分析

| 能力 | 当前路由 | `/api/docs` 覆盖？ | 本轮需求？ |
|------|---------|-------------------|-----------|
| 搜索/召回 | `/api/kb/*search` `/api/kb/*recall` | ✅ 已切流到 `/api/docs/recall` | ✅ 核心目标 |
| KB CRUD | `GET/POST /api/kb` | ❌ | ❌ 内容编辑，非检索 |
| 文章编辑 | `/api/kb/:id/articles` | ❌ | ❌ 同上 |
| 章节管理 | `/api/kb/:id/sections` | ❌ | ❌ 同上 |
| 段落管理 | `/api/kb/:id/paragraphs` | ❌ | ❌ 同上 |
| 标签管理 | `/api/kb/:id/tags` | ❌ | ❌ 同上 |
| 向量化 | `/api/kb/:id/revectorize` | ❌ | ❌ 同上 |

### 本轮重构范围

本次需求为"统一文档平台的**检索与查询**能力"：

- 知识库搜索 → `/api/docs/recall` ✅
- 知识库语义召回 → `/api/docs/recall` ✅
- 合同搜索 → `/api/docs/recall` ✅

KB CRUD/文章编辑/章节段落管理/标签/向量化属于**内容编辑层**，不在本轮需求范围。

### 技术上完全可行

如果后续将 KB CRUD 也迁移过来：

```
POST /api/docs/articles       → 创建文章
POST /api/docs/sections       → 创建章节
POST /api/docs/paragraphs     → 创建段落
POST /api/docs/:id/revectorize → 向量化
```

但需要同步改造前端所有 KB 编辑页面的 API 调用，是一次独立的重构迭代。

### 当前状态

搜索/召回入口已统一（`/api/docs/recall`），编辑层保留在旧路由。`server/index.js` 已添加注释说明路由分工。

建议按“先收口、再删旧”原则推进 Round 4，避免在权限和调用契约未稳定时进入不可逆阶段。
