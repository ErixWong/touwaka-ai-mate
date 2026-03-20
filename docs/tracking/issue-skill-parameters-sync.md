# Issue: 技能参数数据库同步

## 状态
**已完成** - 2026-03-20

## 概述
根据 `data/skills` 目录下的技能配置，完善数据库初始化脚本和升级脚本，为需要配置参数的技能创建对应的 `skill_parameters` 记录。

## 变更内容

### 1. 数据库表结构
- `skill_parameters` 表已存在于 `init-database.js` 的 TABLES 定义中
- 表结构包含：`id`, `skill_id`, `param_name`, `param_value`, `is_secret`, `description`, `created_at`, `updated_at`
- 外键约束：`skill_id` 关联 `skills.id`，级联删除
- 唯一约束：`(skill_id, param_name)` 防止重复参数

### 2. 脚本修改

#### `scripts/init-database.js`
- [x] 移除原有的 `skills` 数组（包含不存在的"搜索"和"天气"技能）
- [x] 移除 `builtInSkillParameters` 数据定义
- [x] 移除相关的插入代码
- [x] 保留 `skill_parameters` 表结构定义
- [x] 添加 `description` 字段到表结构

#### `scripts/upgrade-database.js`
- [x] 添加 migration #34 用于创建 `skill_parameters` 表
- [x] 添加 migration #35 用于为旧表添加 `description` 字段
- [x] 修复后续迁移编号（#36-#38）

#### `scripts/init-core-skills.js`
- [x] 添加 `SKILL_PARAMETERS` 常量
- [x] 添加参数同步逻辑
- [x] 更新 dry-run 模式显示参数信息
- [x] 插入参数时包含 `description` 字段

### 3. 技能参数定义

| 技能 ID | 参数名 | 是否敏感 | 说明 |
|---------|--------|----------|------|
| remote-llm | model_id | 否 | 目标模型 ID（ai_models 表） |
| remote-llm | prompt | 否 | 默认 prompt |
| remote-llm | system_prompt | 否 | 系统提示（可选） |
| remote-llm | max_tokens | 否 | 最大输出 token |
| remote-llm | temperature | 否 | 温度参数 |
| searxng | searxng_url | 否 | SearXNG 实例 URL |
| wikijs | wikijs_url | 否 | Wiki.js 实例 URL |
| wikijs | wikijs_token | 是 | Wiki.js API Token |
| kb-search | api_base | 否 | API 基础地址 |
| kb-editor | api_base | 否 | API 基础地址 |

## 代码审计结果

### 发现的问题

1. **Migration 编号重复（已修复）**
   - 问题：`upgrade-database.js` 中有两个迁移使用了编号 #34
   - 修复：重新编号，添加 migration #35 用于 `skill_parameters.description` 字段

2. **缺少 `description` 字段（已修复）**
   - 问题：`skill_parameters` 表缺少 `description` 字段，但 `SKILL_PARAMETERS` 常量中定义了该属性
   - 修复：在三个脚本中均添加了 `description` 字段支持

3. **参数定义验证**
   - 对比 SKILL.md 文件，确认参数定义完整且正确
   - `USER_ACCESS_TOKEN` 由系统自动注入，无需在参数表中定义

### 验证结果
- [x] 所有脚本语法检查通过
- [x] Migration 编号连续且唯一
- [x] 表结构与代码逻辑一致

## 使用方式

### 初始化新数据库
```bash
node scripts/init-database.js
```

### 升级现有数据库
```bash
node scripts/upgrade-database.js
```

### 同步核心技能和参数
```bash
node scripts/init-core-skills.js
```

## 注意事项
- 所有参数值默认为空，需要用户在系统中配置
- 敏感参数（`is_secret: true`）在前端显示时会被隐藏
- 删除技能时会级联删除其关联的参数记录
- `description` 字段用于前端显示参数用途说明

## 相关文件
- `scripts/init-database.js`
- `scripts/upgrade-database.js`
- `scripts/init-core-skills.js`
- `data/skills/*/SKILL.md`

## 变更历史
- 2026-03-20: 初始创建，完成技能参数同步功能
- 2026-03-20: 代码审计，修复 migration 编号和 description 字段问题