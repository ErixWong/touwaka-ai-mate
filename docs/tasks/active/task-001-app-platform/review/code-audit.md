# 代码审计报告

> **日期**: 2026-04-15
> **审计范围**: App 平台基础架构 + 合同管理小程序

## 审计结果

### 已修复 (Critical + Important)

| ID | 问题 | 文件 | 修复方式 |
|----|------|------|---------|
| C1 | updateRecord/deleteRecord/confirmRecord/getRecord 缺少 user_id 归属校验 | mini-app.service.js | 添加 userId 参数 + isAdmin/owner 校验 |
| C3 | AppClock tick() 竞态 — 多实例可能重复处理同一记录 | app-clock.js | 添加 claimRecord() 原子认领机制 |
| C4 | loadScript() 路径未校验 — 可能加载任意文件 | app-clock.js | 限制路径必须在 scripts/ 或 data/skills/ 下 |
| C5 | department visibility 无条件放行 | mini-app.service.js | 校验用户与 App owner 的 department_id |
| I1 | 分页格式不合规 — 未使用 buildPaginatedResponse | mini-app.service.js | 改用 buildPaginatedResponse() |
| I4 | AppClock processRecord N+1 查询文件附件 | app-clock.js | 改用 Sequelize include 一次查询 |
| I6 | batchUpload 未校验 App 是否激活 | mini-app.service.js | 添加 is_active 检查 |
| I9 | batchUpload 未校验附件归属 | mini-app.service.js | 检查 created_by === userId |
| M9 | GenericMiniApp 未使用的 watch import | GenericMiniApp.vue | 移除 |

### 待后续修复 (Minor / Architecture)

| ID | 问题 | 优先级 | 说明 |
|----|------|--------|------|
| M1-M5 | 前端大量硬编码中文文本 | Low | 下一批 PR 统一添加 i18n key |
| A1 | MiniAppService 职责过多 (500+ lines) | Medium | Phase 2 拆分为独立 Service |
| A3 | callMcp/callLlm/callSkill 为 stub | Medium | 需集成 ResidentSkillManager 和 MCP 服务 |
| A4 | Models 手写 vs 自动生成 | Low | 当前可用，后续如需重新生成需注意覆盖 |
| I2 | getAccessibleApps N+1 (role 查询) | Low | 数据量小时影响不大，Phase 2 优化 |
| M8 | GenericMiniApp 使用 alert() | Low | 应改用 Toast 组件 |

### 审计清单确认

- [x] 编译与构建通过
- [x] ES 模块导入验证通过
- [x] API 响应格式使用 ctx.success()
- [x] 分页使用 buildPaginatedResponse
- [x] 权限校验覆盖所有写操作
- [x] SQL 注入防护（使用参数化查询）
- [x] 路由顺序合理
- [ ] i18n 硬编码中文（待修复）
- [x] 使用 apiClient 而非 fetch
- [x] 数据库迁移幂等
