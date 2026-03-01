# 测试和调试工具

本目录包含开发和调试过程中使用的工具脚本。

## 文件说明

### db-check.mjs

数据库检查脚本，用于验证数据库连接和查询专家/技能数据。

**用法：**
```bash
node test/db-check.mjs
```

**功能：**
- 测试数据库连接
- 查询所有专家列表
- 查询专家关联的技能
- 检查 `expert_skills` 关联表

**输出示例：**
```
=== 专家列表 ===
- mlxwd8ka35mx71yr1uw1: Maria
- exp_002: Assistant

=== 专家技能关联 ===
- Maria -> SearXNG Search (mm0o9un9nbdcy31jfsxr)
```

---

### query-db.js

通用数据库查询工具，用于快速执行 SQL 查询。

**用法：**
```bash
node test/query-db.js
```

**功能：**
- 执行自定义 SQL 查询
- 测试 Sequelize 模型
- 验证数据库结构

---

### tool-test.mjs

工具加载和注册测试脚本，用于验证 ToolManager 和 SkillLoader 的功能。

**用法：**
```bash
node test/tool-test.mjs
```

**功能：**
- 测试 SkillLoader 加载技能
- 测试 ToolManager 注册工具
- 验证 toolRegistry 映射表
- 显示工具定义格式

**输出示例：**
```
=== 测试 SkillLoader ===
加载的技能数量: 1
技能: mm0o9un9nbdcy31jfsxr SearXNG Search
  - toolId: mm0o9uo5pownffxfjv0allhmhmrorooo

=== 测试 ToolManager ===
注册的工具数量: 22
工具注册表:
  get_env_info -> 内置工具集/get_env_info (builtin: true)
  mm0o9uo5pownffxfjv0allhmhmrorooo -> SearXNG Search/web_search (builtin: false)
```

---

## 环境要求

运行这些脚本需要：

1. **Node.js** >= 18.0.0
2. **数据库连接** - 确保 `.env` 文件中配置了正确的数据库连接信息
3. **依赖安装** - 运行 `npm install` 安装项目依赖

## 注意事项

- 这些脚本是开发调试工具，不应在生产环境中使用
- 脚本会直接连接数据库，请确保数据库配置正确
- 修改脚本时注意不要对生产数据造成影响
