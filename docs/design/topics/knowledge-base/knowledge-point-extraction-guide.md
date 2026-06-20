# 知识点提取最佳实践

## 问题背景

当 AI 拿到一篇文章需要提取知识点时，需要明确：

1. **content 字段**：存放原文内容（完整保留，不提炼）
2. **context 字段**：存放背景总结（提炼的关键信息，用于增强检索）

## 三层定义的一致性

### 1. SKILL.md 文件（给人看的文档）

```markdown
### create_point

创建知识点。

**参数**：
- `content` (required): 知识点原文内容（完整保留原文，不要提炼或总结）
- `title` (optional): 知识点标题（用于概括这段内容）
- `context` (optional): 背景总结（提炼这段内容的背景、所属领域、关键概念，用于增强检索）

**重要**：AI 创建知识点时应该：
1. 将原文段落完整复制到 `content`
2. 用一两句话提炼背景/关键概念，存入 `context`
```

### 2. skills 表（技能元数据）

```sql
-- skill_md 字段存储完整的 SKILL.md 内容
-- 确保与文件系统中的 SKILL.md 保持同步
```

### 3. skill_tools 表（AI 调用时的参数定义）

```json
{
  "name": "create_point",
  "description": "创建知识点（原文存content，提炼总结存context）",
  "parameters": {
    "properties": {
      "content": {
        "description": "知识点原文内容（完整保留原文，不要提炼或总结）"
      },
      "context": {
        "description": "背景总结（可选，提炼这段内容的背景、所属领域、关键概念，用于增强检索）"
      }
    }
  }
}
```

## 工作流程示例

当 AI 拿到一篇文章时：

```
原文段落：
"技能是一个包含SKILL.md（必需）、scripts/（可选）、references/（可选）、assets/（可选）的文件夹。
核心设计原则包括渐进式披露（三级系统）、可组合性和可移植性。SKILL.md是技能的核心，
定义了技能的名称、描述、工具和实现方式..."
```

**正确的知识点创建**：

```json
{
  "title": "技能基础概念",
  "content": "技能是一个包含SKILL.md（必需）、scripts/（可选）、references/（可选）、assets/（可选）的文件夹。核心设计原则包括渐进式披露（三级系统）、可组合性和可移植性。SKILL.md是技能的核心，定义了技能的名称、描述、工具和实现方式...",
  "context": "关于技能开发的基础概念，涉及文件结构和设计原则"
}
```

**错误的创建方式**（之前的问题）：

```json
{
  "title": "技能基础概念",
  "content": "技能是一个包含SKILL.md的文件夹，核心设计原则包括渐进式披露。",  // ← 这是提炼后的摘要！
  "context": ""  // ← 空的！
}
```

## 为什么这样设计

1. **content 存原文**：
   - 保持信息完整性
   - 用户检索时能看到完整内容
   - 避免 AI "脑补"或遗漏关键信息

2. **context 存提炼总结**：
   - 增强向量检索精度
   - 提供领域背景信息
   - 帮助 AI 理解知识点关联

3. **分离存储的好处**：
   - 检索时：用 context + content 生成向量
   - 展示时：显示完整 content
   - 更新时：可以只更新 context 而不改 content

## 同步更新检查清单

当修改 SKILL.md 时，需要同步更新：

- [ ] 文件系统中的 `data/skills/*/SKILL.md`
- [ ] 数据库 `skills` 表的 `skill_md` 字段
- [ ] 数据库 `skill_tools` 表的 `parameters` 字段

可用脚本：
- `scripts/reload-skill.cjs` - 重新加载技能到数据库
- `scripts/update-tool-desc.cjs` - 更新工具参数描述