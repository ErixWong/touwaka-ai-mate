# TODO 归档 - 2026年3月

---

## 移除 tools/builtin 目录 ✅

**完成日期：** 2026-03-01

**成果：**
- 移除 `tools/builtin` 目录
- 所有工具迁移为普通技能

---

## register_skill 工具参数修复 ✅

**完成日期：** 2026-03-01

**成果：**
- 增加 `tools` 参数，由 LLM 传入工具定义

---

## skill-loader.js 字段名修复 ✅

**完成日期：** 2026-03-01

**成果：**
- 字段名从 `usage` 改为 `parameters`

---

## migrate-skills.js 废弃 ✅

**完成日期：** 2026-03-01

**成果：**
- 废弃 `scripts/migrate-skills.js`
- 改用 LLM 解析 SKILL.md

---

## 空字段提示注入修复 ✅

**完成日期：** 2026-03-01

**问题描述：**
专家系统提示词中的空字段（如 `core_values`、`behavioral_guidelines` 等）会被错误地注入到最终提示词中，导致 LLM 收到包含空内容的章节标题。

**解决方案：**
将字段从 JSON 数组格式改为纯字符串存储，并在构建提示词时动态跳过空字段。

**修改内容：**

### 提交 1: 33b404b - fix: 专家系统提示词空字段处理优化
- 新增 `formatListField()` 工具函数
- 重构 `enhanceWithSoul()` 方法
- 重构 `buildReflectionSystemPrompt()` 方法

### 提交 2: a0a2148 - refactor: 移除专家字段的 JSON 解析逻辑
- 删除 `lib/utils/prompt-utils.js`（不再需要）
- 移除 4 个 `parseJson` 相关方法
- 减少约 60 行代码

**技术要点：**
- 字段从 JSON 数组改为纯字符串存储
- 使用 `?.trim()` 模式统一处理空值
- 动态构建 sections，空字段自动跳过

**相关文档：**
- [任务目录](./tasks/2026-03/2026-03-01-empty-field-prompt-injection/)

---

## 技能工具入口脚本字段 ✅

**完成日期：** 2026-03-02

**问题描述：**
`skill_tools` 表没有入口脚本字段，导致 skill-runner 只能执行技能目录下的 `index.js` 文件。但实际场景中，一个技能可能包含多个工具，每个工具有独立的脚本文件。

**解决方案：**
在 `skill_tools` 表添加 `script_path` 字段（VARCHAR(255), 默认 'index.js'），用于指定每个工具的入口脚本路径。

**修改内容：**

### 提交 1: 4302596 - feat: add script_path field to skill_tools table
- 数据库表添加 `script_path` 字段
- 更新 skill-loader.js 读取并传递 script_path
- 更新 skill-runner.js 从 SCRIPT_PATH 环境变量加载脚本
- 更新 tool-manager.js 传递 scriptPath
- 更新 skill-manager 技能支持 script_path 参数

### 提交 2: 145b111 - fix: add script_path security validation
- 添加 `validateScriptPath()` 防止路径遍历攻击
- 添加 `ALLOWED_SCRIPT_EXTENSIONS` 白名单（目前仅 .js）
- 禁止绝对路径和路径遍历序列

**技术要点：**
- 向后兼容：所有地方都使用 `'index.js'` 作为默认值
- 安全设计：`SCRIPT_PATH` 加入 `RESERVED_ENV_VARS`，防止被用户参数覆盖
- 路径安全：禁止 `..`、绝对路径、非白名单扩展名

**相关文档：**
- [任务目录](./tasks/2026-03/2026-03-02-skill-tool-entry-file/)
- [迁移脚本](../../scripts/migrations/20260302-add-script-path.sql)

---

*最后更新: 2026-03-02*
