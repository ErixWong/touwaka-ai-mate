# 已归档的 Skill 设计文档

> 归档日期：2026-02-26

## 归档原因

这些文档基于旧的"LLM 分析导入"设计方案，现已被新的"对话式导入"设计取代。

新设计核心思想：**AI First**
- 让 AI 成为技能管理的主角
- 通过自然语言对话完成技能导入
- 简化前端界面，专注于展示和配置

参见新设计文档：
- [`docs/design/v2/skill-management-tools-design.md`](../v2/skill-management-tools-design.md) - 技能管理工具设计
- [`docs/design/v2/skill-import-dialog-design.md`](../v2/skill-import-dialog-design.md) - 对话式导入界面设计

## 归档文件列表

### 1. skill-market-design.md

**原设计**：复杂的技能市场界面
- URL/ZIP/本地路径导入
- 文件扫描进度显示
- LLM 分析配置界面
- 前端复杂的导入流程

**新方案**：
- 对话式导入："帮我导入 data/skills/xxx"
- AI 读取文件、理解内容、调用 register_skill
- 界面简化为：左边对话 + 右边技能列表

### 2. skill-parameters-code-review.md

**原设计**：参数配置相关代码审查记录
- 关于 skill_parameters 表的技术细节
- 已经合并到 `skill-configuration-design.md`

### 3. skill-fields-analysis.md

**原设计**：skills 表字段分析
- 讨论哪些字段保留、哪些删除
- 与 Claude Code Skills 标准对比

**现状**：字段设计已稳定，此文档不再需要

### 4. skill-llm-analysis.md (从 tasks 移入)

**原设计**：LLM 异步分析 SKILL.md
- 阶段1：读取 SKILL.md 存储
- 阶段2：LLM 分析提取元数据

**新方案**：
- AI 对话时直接理解 SKILL.md
- 调用 register_skill 时传入元数据
- 无需单独的分析阶段

## 新设计对比

| 旧设计 | 新设计 |
|--------|--------|
| 前端复杂的导入表单 | 对话式导入，AI 理解意图 |
| LLM 分析配置界面 | AI 自己决定如何处理 |
| 文件扫描进度显示 | AI 调用工具直接读取 |
| 多步骤导入流程 | 一句话完成导入 |
| skill-importer 技能 | 内置 skill-importer Expert |

## 技术影响

### 保留的功能

- [`skill-configuration-design.md`](../v2/skill-configuration-design.md) - 技能参数配置（仍在使用）
- [`skill-management-tools-design.md`](../v2/skill-management-tools-design.md) - register_skill 工具设计
- [`skill-import-dialog-design.md`](../v2/skill-import-dialog-design.md) - 新的对话式界面设计

### 不再需要的功能

- LLM 分析服务（`skill-analyzer.js` 的"导入分析"功能）
- 前端 SkillsView 的复杂导入界面
- skill-importer 技能（data/skills/skill-importer/）

### 仍需要的功能

- `skill-analyzer.js` 转为"安全检查"和"格式验证"
- `register_skill` 内置工具实现
- skill-importer Expert（数据库中的内置专家）

---

*此归档仅供参考，如需恢复某些功能，请查阅对应文件。*