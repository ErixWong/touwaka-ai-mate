## 变更概述

清理过时的 Skill API 路由，移除已被 `skill-manager` 技能替代的功能。

## 变更详情

### 后端变更

**删除的路由** ([`server/routes/skill.routes.js`](server/routes/skill.routes.js)):
- `POST /from-url` - 从 URL 安装技能
- `POST /from-zip` - 从 ZIP 文件安装技能
- `POST /from-path` - 从本地路径安装技能
- `POST /:id/reanalyze` - 重新分析技能

**删除的 Controller 方法** ([`server/controllers/skill.controller.js`](server/controllers/skill.controller.js)):
- `installFromUrl()`, `parseGitHubUrl()`, `findSubDir()`, `downloadFile()`
- `installFromZip()`, `installFromPath()`
- `reanalyze()`, `logDirectoryStructure()`, `findSkillMd()`, `copyDirectory()`, `analyzeSkill()`

**删除的文件**:
- [`lib/skill-analyzer.js`](lib/skill-analyzer.js) - AI 技能分析器（839 行）

### 前端变更

**删除的 Store 方法** ([`frontend/src/stores/skill.ts`](frontend/src/stores/skill.ts)):
- `installFromUrl()`, `installFromZip()`, `installFromPath()`, `reanalyzeSkill()`

**删除的 i18n 键**:
- `skills.reanalyze` (zh-CN.ts, en-US.ts)

## 技术说明

这些过时的路由已被 `skill-manager` 技能的 `register_skill` 功能替代：
- 技能注册现在通过 AI 专家调用 `skill-manager` 技能完成
- 技能分析由 AI 专家执行，不再需要独立的 `SkillAnalyzer` 类
- 前端删除功能通过 `deleteSkill()` 方法实现

## 影响范围

- 删除了 1878 行代码
- 无破坏性变更（所有删除的功能均未被使用）

Closes #260