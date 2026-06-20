# 技能管理工具设计方案

## 概述

本方案为内置工具集添加两个技能管理工具，让 AI 专家可以通过对话管理技能。

## 工具清单

| 工具名 | 功能 | 说明 |
|--------|------|------|
| `list_skills` | 列出技能 | ✅ 已实现 |
| `save_skill` | 保存技能 | Upsert 模式：同名存在则更新，不存在则创建 |
| `delete_skill` | 删除技能 | 从数据库删除技能及其工具 |

## save_skill 工具设计

### 核心理念

**Upsert 模式**：简化 AI 的决策，不需要判断是"创建"还是"更新"，统一使用 `save_skill`。

### 参数定义

```javascript
{
  name: 'save_skill',
  description: '保存技能到数据库（Upsert 模式）。如果同名技能已存在则更新，不存在则创建。用于导入或更新技能。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '技能名称（唯一标识，建议使用英文小写+连字符）'
      },
      description: {
        type: 'string',
        description: '技能描述（简短说明技能功能）'
      },
      source_path: {
        type: 'string',
        description: '技能源码路径（相对于 data/skills/）'
      },
      tools: {
        type: 'array',
        description: '工具列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工具名称' },
            description: { type: 'string', description: '工具描述' },
            parameters: { type: 'object', description: 'JSON Schema 格式的参数定义' }
          },
          required: ['name']
        }
      }
    },
    required: ['name']
  }
}
```

### Upsert 逻辑

```javascript
async saveSkill(params, context) {
  const { name, description, source_path, tools = [] } = params;
  
  // 1. 按 name 查找现有技能
  const existingSkill = await db.Skill.findOne({ where: { name } });
  
  const transaction = await db.sequelize.transaction();
  
  try {
    let skill;
    
    if (existingSkill) {
      // === 更新模式 ===
      await db.Skill.update({
        description: description || existingSkill.description,
        source_path: source_path || existingSkill.source_path,
        updated_at: new Date(),
      }, { where: { id: existingSkill.id }, transaction });
      
      skill = existingSkill;
      
      // 删除旧工具，稍后重建
      await db.SkillTool.destroy({ 
        where: { skill_id: skill.id }, 
        transaction 
      });
      
    } else {
      // === 创建模式 ===
      const skillId = generateId();
      skill = await db.Skill.create({
        id: skillId,
        name,
        description: description || '',
        source_path: source_path || name,
        source_type: 'local',
        is_active: true,
      }, { transaction });
    }
    
    // 2. 重建工具清单（tools 删了重建）
    for (const tool of tools) {
      await db.SkillTool.create({
        id: generateId(),
        skill_id: skill.id,
        name: tool.name,
        description: tool.description || '',
        parameters: JSON.stringify(tool.parameters || { type: 'object', properties: {} }),
      }, { transaction });
    }
    
    await transaction.commit();
    
    return {
      success: true,
      skill_id: skill.id,
      action: existingSkill ? 'updated' : 'created',
    };
    
  } catch (error) {
    await transaction.rollback();
    return { success: false, error: error.message };
  }
}
```

### 关键设计点

1. **按 name 查找**：技能名称是唯一键，用于 Upsert 判断
2. **工具全量替换**：更新时先删除旧工具，再插入新工具（简化逻辑，避免 diff）
3. **事务保护**：确保 skills 和 skill_tools 表的数据一致性
4. **AI 友好**：参数简洁，不需要 AI 关心 ID 生成等技术细节

## delete_skill 工具设计

### 参数定义

```javascript
{
  name: 'delete_skill',
  description: '从数据库删除技能及其工具定义。注意：这不会删除源码文件。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '要删除的技能名称'
      }
    },
    required: ['name']
  }
}
```

### 删除逻辑

```javascript
async deleteSkill(params, context) {
  const { name } = params;
  
  const skill = await db.Skill.findOne({ where: { name } });
  
  if (!skill) {
    return { success: false, error: `Skill not found: ${name}` };
  }
  
  const transaction = await db.sequelize.transaction();
  
  try {
    // 1. 删除工具
    await db.SkillTool.destroy({ 
      where: { skill_id: skill.id }, 
      transaction 
    });
    
    // 2. 删除专家关联
    await db.ExpertSkill.destroy({ 
      where: { skill_id: skill.id }, 
      transaction 
    });
    
    // 3. 删除参数
    await db.SkillParameter.destroy({ 
      where: { skill_id: skill.id }, 
      transaction 
    });
    
    // 4. 删除技能
    await db.Skill.destroy({ 
      where: { id: skill.id }, 
      transaction 
    });
    
    await transaction.commit();
    
    return { success: true, deleted_skill: name };
    
  } catch (error) {
    await transaction.rollback();
    return { success: false, error: error.message };
  }
}
```

## 使用场景

### 场景1：导入现有技能

```
用户：帮我导入 data/skills/searxng

AI 执行：
1. read_lines("data/skills/searxng/SKILL.md") - 读取 SKILL.md
2. 理解内容，提取工具定义
3. save_skill(
     name: "searxng",
     description: "使用 SearXNG 搜索网络",
     source_path: "searxng",
     tools: [{ name: "web_search", description: "搜索网络", ... }]
   )
```

### 场景2：更新技能

```
用户：更新 searxng 技能，添加高级搜索功能

AI 执行：
1. read_lines("data/skills/searxng/SKILL.md") - 读取最新内容
2. 理解变化
3. save_skill(
     name: "searxng",  // 同名则更新
     description: "使用 SearXNG 搜索网络（支持高级搜索）",
     source_path: "searxng",
     tools: [
       { name: "web_search", ... },
       { name: "advanced_search", ... }  // 新增工具
     ]
   )
```

### 场景3：删除技能

```
用户：删除 weather 技能

AI 执行：
1. delete_skill(name: "weather")
```

## 数据库表结构参考

### skills 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(64) | 主键 |
| name | VARCHAR(128) | 技能名称（唯一标识） |
| description | TEXT | 描述 |
| source_path | VARCHAR(512) | 源码路径 |
| source_type | ENUM | 来源类型 |
| is_active | BIT | 是否启用 |

### skill_tools 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) | 主键 |
| skill_id | VARCHAR(64) | 外键 |
| name | VARCHAR(64) | 工具名称 |
| description | TEXT | 工具描述 |
| parameters | TEXT | JSON Schema |

## 实施计划

### Phase 1：实现工具 (1天)

1. 在 `tools/builtin/index.js` 添加 `save_skill` 和 `delete_skill`
2. 添加事务支持和错误处理
3. 编写单元测试

### Phase 2：创建 skill-studio 专家 (0.5天)

1. 在 `scripts/init-database.js` 添加 skill-studio 专家
2. 分配内置工具权限

### Phase 3：前端界面 (1天)

1. 创建 SkillsStudioView.vue
2. 复用 ChatView 框架
3. 添加右侧技能列表面板

---

*创建日期：2026-02-27*
*基于之前的设计文档简化而来*
