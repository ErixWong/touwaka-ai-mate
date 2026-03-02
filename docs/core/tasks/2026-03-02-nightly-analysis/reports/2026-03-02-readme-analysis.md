# README 文档更新分析报告

**分析时间**: 2026-03-02 02:40  
**分析文件**: 
- `/README.md` (根目录)
- `/docs/README.md` (文档目录)

---

## 🚨 需要立即更新的内容

### 1. 根 README.md - 初始化脚本错误

**当前内容**:
```bash
# 4. 初始化核心技能
node scripts/init-core-skills.js
```

**问题**: 
- 脚本名称错误，实际文件是 `init-database.js`
- 说明中提到的 `data/skills/` 目录结构需要验证

**建议更新**:
```bash
# 4. 初始化数据库
npm run init-db
# 或
node scripts/init-database.js
```

**优先级**: 🔴 **P0 - 立即修复**

---

### 2. 根 README.md - API 概览不完整

**当前**: 只列出了 9 个模块的基本端点

**缺失**:
- `/api/chat/*` - 聊天流式 API（SSE）
- `/api/stream/*` - 流式路由（预留）
- `/api/debug/*` - 调试工具
- `/api/health` - 健康检查

**建议**: 
参照 `reports/2026-03-02-api-endpoints.md` 更新完整的 73 个端点概览

**优先级**: 🟡 **P1 - 短期更新**

---

### 3. 根 README.md - V2 状态描述过时

**当前**:
```markdown
| **V2** | 🚧 开发中 | Task Orchestrator / 任务编排层 |
```

**实际情况**:
- 基于代码分析，V2 的 Task Layer 已经在 `docs/core/tasks/` 中有大量实现
- Skills Studio 功能已实现（从代码中可见）
- 右侧面板设计已采纳

**建议更新**:
```markdown
| **V2** | ✅ 部分实现 | Task Layer、Skills Studio、右侧面板 |
```

**优先级**: 🟡 **P1 - 更新状态**

---

### 4. 根 README.md - 项目结构缺失新文件

**缺失**:
- `frontend/src/composables/` - 新增 useNetworkStatus.ts, useSSE.ts
- `docs/core/tasks/` - 任务管理文档结构
- `docs/archive/` - 归档目录

**建议**: 
更新项目结构树，添加新目录

**优先级**: 🟢 **P2 - 补充完善**

---

### 5. 根 README.md - 缺少数据库表结构说明

**当前**: 没有数据库文档链接

**建议添加**:
```markdown
## 数据库结构

详见 [数据库结构文档](docs/core/tasks/2026-03-02-nightly-analysis/reports/2026-03-02-database-schema.md)

**核心表**: users, experts, skills, topics, messages, roles, permissions
```

**优先级**: 🟡 **P1 - 重要补充**

---

### 6. 根 README.md - 快速开始步骤可能过时

**需要验证**:
- `.env.example` 是否存在？
- `npm run init-db` 是否正常工作？
- `data/skills/` 目录结构是否与文档一致？

**优先级**: 🟡 **P1 - 验证更新**

---

## 📝 建议新增内容

### 7. 新增「已知问题」章节

**建议添加**:
```markdown
## 已知问题

### 架构不一致
- `server/controllers/index.js` 和 `routes/index.js` 未被使用（死代码）
- `RoleController` 实例化方式与其他 Controller 不同

### 安全提醒
- `/api/skills/*` 和 `/api/providers/*` 路由当前未添加认证中间件

详见 [分析报告](docs/core/tasks/2026-03-02-nightly-analysis/)
```

**优先级**: 🟡 **P1 - 透明公开**

---

### 8. 新增「API 文档」章节

**建议添加**:
```markdown
## API 文档

- [完整 API 端点列表](docs/core/tasks/2026-03-02-nightly-analysis/reports/2026-03-02-api-endpoints.md) - 73 个端点详细说明
- [数据库表结构](docs/core/tasks/2026-03-02-nightly-analysis/reports/2026-03-02-database-schema.md) - 15 个表完整字段
```

**优先级**: 🟡 **P1 - 方便查阅**

---

## 🔄 docs/README.md 更新建议

### 9. 更新「最后更新时间」

**当前**: `*最后更新: 2026-03-01*`

**建议**: 更新为当前日期，并添加更新说明

---

### 10. 补充「技术手册」链接

**建议添加**:
```markdown
### 🔍 代码分析

- [夜间分析报告](../core/tasks/2026-03-02-nightly-analysis/) - 代码质量、死代码、API 端点、数据库结构
```

**优先级**: 🟢 **P2 - 补充完善**

---

## ✅ 更新检查清单

### 根 README.md
- [ ] 修复初始化脚本名称 (`init-core-skills.js` → `init-database.js`)
- [ ] 补充完整 API 列表（73 个端点）
- [ ] 更新 V2 状态（🚧 开发中 → ✅ 部分实现）
- [ ] 更新项目结构树（添加 composables, tasks, archive）
- [ ] 添加数据库结构章节
- [ ] 添加已知问题章节
- [ ] 添加 API 文档链接
- [ ] 验证快速开始步骤

### docs/README.md
- [ ] 更新最后更新时间
- [ ] 添加代码分析文档链接
- [ ] 补充任务文档说明

---

## 🎯 优先级排序

| 优先级 | 项目 | 说明 |
|--------|------|------|
| 🔴 P0 | 修复初始化脚本名称 | 错误的命令会导致用户困惑 |
| 🟡 P1 | 补充完整 API 列表 | 73 个端点 vs 当前的 9 个 |
| 🟡 P1 | 更新 V2 状态 | 实际已实现，文档滞后 |
| 🟡 P1 | 添加数据库结构 | 151 个字段需要文档 |
| 🟡 P1 | 添加已知问题 | 透明公开架构问题 |
| 🟢 P2 | 更新项目结构 | 补充新目录 |
| 🟢 P2 | 添加分析文档链接 | 方便查阅 |

---

## 💡 额外建议

### 自动生成部分
以下部分可以考虑从代码自动生成：
- API 端点列表
- 数据库表结构
- 项目文件树

### 版本化文档
建议添加版本历史：
```markdown
## 更新日志

### 2026-03-02
- 更新 API 文档（新增 64 个端点）
- 添加数据库结构说明
- 补充已知问题
```

---

*分析报告生成时间: 2026-03-02 02:45*  
*建议执行人: Eric 或 Maria*  
*预计工作量: 30-60 分钟*
