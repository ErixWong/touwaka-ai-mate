# 技能参数数据库迁移完善

## 任务目标

根据当前数据库中 skill 的配置，完善数据库初始化脚本和 upgrade 脚本，确保技能参数正确创建但参数值留空（部署时配置）。

## 完成内容

### 1. 修改 `scripts/upgrade-database.js`

添加了 3 个新迁移（#57、#58、#59）：

| 迁移号 | 技能 | 参数 | 说明 |
|--------|------|------|------|
| #57 | searxng | SEARXNG_URL | SearXNG 实例 URL |
| #58 | remote-llm | model_id, max_tokens, prompt | 远程 LLM 调用参数 |
| #59 | unifuncs | UNIFUNCS_API_KEY | Unifuncs API 密钥 |

### 2. 验证现有配置

- `scripts/skills-data.json`: 包含完整的参数配置，所有 `param_value` 为空字符串
- `scripts/init-skills-from-json.js`: 正确处理参数导入，包括 `description` 字段
- `scripts/init-database.js`: `skill_parameters` 表结构正确

## 技术说明

### 参数值安全处理

所有参数值均为空字符串，符合安全要求：
- 敏感信息（如 API Key）不在代码中硬编码
- 部署时通过环境变量或管理界面配置

### 工作流程

1. **全新安装**: 
   ```
   node scripts/init-database.js
   node scripts/init-skills-from-json.js
   ```

2. **增量升级**: 
   ```
   node scripts/upgrade-database.js
   ```

## 相关文件

- `scripts/upgrade-database.js` - 数据库升级脚本
- `scripts/init-database.js` - 数据库初始化脚本
- `scripts/init-skills-from-json.js` - 从 JSON 导入技能数据
- `scripts/export-skills-data.js` - 导出技能数据到 JSON
- `scripts/skills-data.json` - 技能数据 JSON 文件

## 状态

✅ 已完成

## 日期

2026-03-20