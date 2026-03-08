# Issue: 添加调试脚本用于 Skill 测试和数据库查询

## 需求背景

在开发和调试过程中，经常需要：
1. 测试技能模块的执行效果
2. 查询数据库中的数据进行比对验证
3. 通过命令行快速调用各种功能

每次都要手动编写测试代码或使用数据库客户端比较繁琐，需要一套便捷的命令行调试工具。

## 解决方案

在 `tests/` 目录下创建两个调试脚本：

### 1. Skill 测试脚本 - `tests/test-skill.js`

直接调用技能模块进行测试，无需启动服务器：

```bash
# 列出知识库
node tests/test-skill.js kb-search list_my_kbs

# 搜索知识点
node tests/test-skill.js kb-search search --kb_id=xxx --query="测试"

# 列出技能
node tests/test-skill.js skill-manager list_skills

# 获取技能详情
node tests/test-skill.js skill-manager list_skill_details --skill_id=kb-search
```

**技术实现**：
- 使用与 `lib/skill-runner.js` 相同的 vm 沙箱执行技能代码
- 自动生成管理员 JWT Token（无需手动登录）
- 显示技能可用工具列表和参数定义
- 支持命令行参数传递

### 2. API 调试脚本 - `tests/call-skill.js`

通过 HTTP API 调用后台服务：

```bash
# 知识库操作
node tests/call-skill.js kb list
node tests/call-skill.js kb search --kb_id=xxx --query="测试"
node tests/call-skill.js kb articles --kb_id=xxx

# 技能操作
node tests/call-skill.js skill list
node tests/call-skill.js skill get --id=kb-search
node tests/call-skill.js skill register --path=data/skills/kb-search

# 专家操作
node tests/call-skill.js expert list
```

**技术实现**：
- 自动生成 JWT Token 进行认证
- 支持 JSON 输出格式（`--json`）
- 复用服务器的 HTTP 请求逻辑

### 3. 数据库查询脚本 - `tests/db-query.js`

便捷的数据库查询工具：

```bash
# 查看所有表
node tests/db-query.js --tables

# 查询表数据
node tests/db-query.js kb_articles --limit=10
node tests/db-query.js kb_sections --where="article_id=xxx"

# 查看表结构
node tests/db-query.js kb_articles --schema

# 执行原始 SQL
node tests/db-query.js --sql="SELECT * FROM skills LIMIT 5"

# 统计记录数
node tests/db-query.js kb_articles --count
```

**技术实现**：
- 自动从 `.env` 文件加载数据库连接信息
- 支持表格和 JSON 输出格式
- 显示表结构、记录数、大小等信息

## 文件清单

| 文件 | 用途 |
|------|------|
| `tests/test-skill.js` | 直接执行技能模块测试 |
| `tests/call-skill.js` | 通过 HTTP API 调用服务 |
| `tests/db-query.js` | 数据库查询工具 |

## 使用场景

### 场景1: 测试新开发的技能

```bash
# 查看技能支持的工具
node tests/test-skill.js my-skill

# 测试特定工具
node tests/test-skill.js my-skill my_tool --param=value
```

### 场景2: 调试技能执行问题

```bash
# 直接执行技能，观察输出
node tests/test-skill.js kb-search search --kb_id=xxx --query="test"

# 查看数据库中的实际数据
node tests/db-query.js kb_paragraphs --where="section_id=yyy"
```

### 场景3: 验证 API 功能

```bash
# 通过 API 调用
node tests/call-skill.js kb list

# 直接查询数据库比对
node tests/db-query.js kb_articles --limit=5
```

## 状态

✅ **已完成** - 脚本已创建并测试通过

---

*创建时间: 2026-03-08*
*状态: 已完成*