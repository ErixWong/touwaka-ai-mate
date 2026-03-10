# kb_paragraphs 表 Context 字段设计方案

> 状态：**草案**
> 创建时间：2026-03-09

## 问题背景

### 当前痛点

在当前的 `kb_paragraphs` 表设计中，`content` 字段被用于存储「总结后的知识点内容」，导致原文信息丢失。

**问题场景**：
1. 使用 `kb-editor` 技能导入文档时，LLM 会对知识点段落进行总结
2. 总结后的内容写入 `content` 字段，原文无法保留
3. 用户无法追溯知识点的原始表述，影响知识溯源

### 需求目标

1. **保留原文**：`content` 字段存储原始段落内容，不做提炼或总结
2. **新增上下文**：新增 `context` 字段，用于存储知识点的上下文摘要
3. **辅助检索**：`context` 字段便于 skill 理解知识点定位，提高检索准确性

---

## 设计方案

### 字段定义

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `content` | TEXT | 段落原文内容（不做总结） |
| `context` | TEXT | 知识点上下文摘要（用于检索辅助） |

### context 字段规范

**生成原则**：
- 用一两句话总结知识点和知识点所处的文章
- 使用中文
- 长度建议：50-150 字符

**生成公式**：
```
{知识点核心概念} - 出自《{文章标题}》{章节路径}
```

**示例**：

| 场景 | context 示例 |
|------|-------------|
| 技术文档 | Python 的列表推导式是一种简洁的创建列表的方式 - 出自《Python 入门教程》第3章 基础语法 |
| 产品说明 | 用户可以通过右上角的设置按钮修改主题颜色 - 出自《产品使用手册》第2章 界面介绍 |
| API 文档 | 该接口用于获取用户列表，支持分页查询 - 出自《API 参考手册》用户管理模块 |

---

## 数据库变更

### 迁移脚本

```sql
-- 添加 context 字段到 kb_paragraphs 表
ALTER TABLE kb_paragraphs 
ADD COLUMN context TEXT COMMENT '知识点上下文摘要（用于检索辅助）' 
AFTER content;
```

### 迁移脚本文件

创建 `scripts/migrate-add-context-field.js`：

```javascript
/**
 * Database Migration: Add context field to kb_paragraphs
 * 
 * 变更内容：
 * - 添加 context 字段（TEXT 类型）
 * 
 * 运行方式：node scripts/migrate-add-context-field.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ADD_CONTEXT_FIELD = `
ALTER TABLE kb_paragraphs 
ADD COLUMN IF NOT EXISTS context TEXT COMMENT '知识点上下文摘要（用于检索辅助）' 
AFTER content;
`;

async function migrate() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected successfully.');

    console.log('Adding context field to kb_paragraphs table...');
    await connection.query(ADD_CONTEXT_FIELD);
    console.log('✓ context field added.');

    console.log('\n========================================');
    console.log('Migration completed successfully!');
    console.log('========================================');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

migrate().catch(console.error);
```

---

## kb-editor 技能修改

### create_paragraph 工具更新

**新增参数**：
- `context` (string, optional): 知识点上下文摘要

**更新后的参数定义**：

```markdown
#### create_paragraph

创建段落。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, required): 所属节 ID
- `title` (string, optional): 段落标题
- `content` (string, required): 段落原文内容（完整的原文，不要提炼或总结）
- `context` (string, optional): 知识点上下文摘要（一两句话总结知识点和出处，中文）
- `is_knowledge_point` (boolean, optional): 是否为知识点，默认 false
- `token_count` (integer, optional): Token 数量，默认 0

**重要说明**：
- `content` 必须保留原文，不做任何修改或总结
- `context` 仅在 `is_knowledge_point=true` 时需要填写
- `context` 格式：「{核心概念} - 出自《{文章标题}》{章节路径}」
```

### update_paragraph 工具更新

**新增参数**：
- `context` (string, optional): 知识点上下文摘要

---

## kb-search 技能利用

### 检索增强

`kb-search` 技能可以在检索时利用 `context` 字段：

1. **语义搜索增强**：将 `context` 纳入向量检索的参考内容
2. **结果展示**：返回知识点时附带 `context`，帮助用户快速理解知识点定位
3. **精确过滤**：基于 `context` 中的文章标题或章节信息进行过滤

### 检索结果示例

```json
{
  "id": "para_001",
  "content": "Python 的列表推导式提供了一种简洁的方式来创建列表。基本语法为 [expression for item in iterable if condition]。",
  "context": "列表推导式的语法和使用方法 - 出自《Python 入门教程》第3章 基础语法",
  "article_title": "Python 入门教程",
  "section_path": "第3章 基础语法 > 3.4 列表推导式",
  "score": 0.89
}
```

---

## 影响范围

### 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `models/kb_paragraph.js` | 添加 `context` 字段定义 |
| `data/skills/kb-editor/SKILL.md` | 更新工具参数文档 |
| `data/skills/kb-editor/index.js` | 支持 `context` 参数 |
| `scripts/migrate-add-context-field.js` | 新建迁移脚本 |
| `lib/rag-service.js` | 检索时利用 `context`（可选） |

### 兼容性说明

- `context` 字段为可选字段，不影响现有数据
- 旧数据的 `context` 为 NULL，可在后续使用中逐步补充
- API 向后兼容，不传 `context` 参数不影响现有功能

---

## 实施步骤

1. **数据库迁移**：执行迁移脚本添加字段
2. **模型更新**：重新生成 Sequelize 模型
3. **技能更新**：修改 `kb-editor` 技能支持新字段
4. **文档更新**：更新 SKILL.md 文档
5. **测试验证**：创建带 `context` 的知识点，验证功能

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 历史数据无 context | 检索效果降低 | 可通过后台任务批量生成 |
| context 生成质量不稳定 | 影响检索体验 | 提供明确的生成规范和示例 |
| 迁移失败 | 数据库结构不一致 | 使用 `IF NOT EXISTS` 确保幂等性 |

---

## 附录：context 生成 Prompt 建议

```markdown
你是一个知识库管理助手。请为以下知识点生成一个简短的上下文摘要。

要求：
1. 用一两句话总结知识点的核心概念
2. 说明知识点出自哪篇文章和章节
3. 使用中文
4. 格式：「{核心概念} - 出自《{文章标题}》{章节路径}」
5. 长度控制在 50-150 字符

文章标题：{article_title}
章节路径：{section_path}
知识点内容：{content}

请生成 context：
```

---

*让我们一起愉快地写代码吧！ 💪✨*