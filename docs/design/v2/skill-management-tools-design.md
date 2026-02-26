# 技能管理工具设计方案

## 背景与思考

### 问题重新定义

之前的方案（LLM 分析导入）存在根本性的思维局限：
- 把 LLM 当作"解析器"而非"创造者"
- 过度关注文件扫描细节，忽略了 AI 的代码生成能力
- 前端界面导入流程复杂，用户体验不佳

### 核心洞察

1. **AI 代码能力极强**：只要有一个 SKILL.md 文档把业务逻辑和接口描述清楚，AI 就可以自己写出完整的技能代码

2. **上下限思维**：
   - **下限**：阅读理解现有技能 → 融合到数据库 → 简洁明确的调用定义
   - **上限**：通过对话凭空创造技能 → 自动注册到数据库

3. **关键问题**：如何把技能注册到数据库中？

## 解决方案：最小化工具设计

### 设计理念

1. **Upsert 模式**：`register_skill` 同时支持创建和更新，AI 不需要判断
2. **简洁描述**：description 保持一句话，不包含实现细节
3. **最小化工具数量**：只添加必要的工具，减少 token 占用

### 工具清单

只需要 **1 个新工具**：

| 工具名 | 功能 | 行为 |
|--------|------|------|
| `register_skill` | 注册/更新技能 | **Upsert**：同名技能存在则更新，不存在则创建 |

现有的 `list_skills` 已经足够用于查询技能信息。

### register_skill 工具设计

#### 工具定义（简洁版）

```javascript
{
  name: 'register_skill',
  description: '注册或更新技能（同名则覆盖）',
  parameters: {
    type: 'object',
    properties: {
      name: { 
        type: 'string', 
        description: '技能名称（唯一标识）' 
      },
      description: { 
        type: 'string', 
        description: '技能描述' 
      },
      tools: {
        type: 'array',
        description: '工具列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工具名' },
            description: { type: 'string', description: '工具描述' },
            parameters: { type: 'object', description: 'JSON Schema 参数定义' }
          },
          required: ['name']
        }
      },
      source_path: { 
        type: 'string', 
        description: '源码路径（相对于 data/skills/）' 
      },
      skill_md: { 
        type: 'string', 
        description: 'SKILL.md 内容（可选，用于创建文件）' 
      },
      assign_to_current_expert: {
        type: 'boolean',
        description: '是否分配给当前专家',
        default: true
      }
    },
    required: ['name']
  }
}
```

#### Upsert 逻辑

```javascript
async registerSkill(params, context) {
  const { name, description, tools = [], source_path, skill_md, assign_to_current_expert = true } = params;
  
  // 1. 查找现有技能（按 name）
  const existingSkill = await context.db.Skill.findOne({ where: { name } });
  
  const transaction = await context.db.sequelize.transaction();
  
  try {
    let skill;
    
    if (existingSkill) {
      // === 更新模式 ===
      skill = await existingSkill.update({
        description: description || existingSkill.description,
        source_path: source_path || existingSkill.source_path,
        skill_md: skill_md || existingSkill.skill_md,
        updated_at: new Date(),
      }, { transaction });
      
      // 删除旧工具，插入新工具
      await context.db.SkillTool.destroy({ 
        where: { skill_id: skill.id }, 
        transaction 
      });
      
    } else {
      // === 创建模式 ===
      const skillId = generateId(); // 生成 32 位 ID
      skill = await context.db.Skill.create({
        id: skillId,
        name,
        description: description || '',
        source_path: source_path || name,
        source_type: 'filesystem',
        skill_md: skill_md || null,
        is_active: true,
      }, { transaction });
    }
    
    // 2. 插入工具定义
    for (const tool of tools) {
      await context.db.SkillTool.create({
        id: generateId(),
        skill_id: skill.id,
        name: tool.name,
        description: tool.description || '',
        parameters: JSON.stringify(tool.parameters || { type: 'object', properties: {} }),
      }, { transaction });
    }
    
    // 3. 可选：创建 SKILL.md 文件
    if (skill_md && source_path) {
      const skillDir = path.join(DATA_ROOT, 'skills', source_path);
      await fs.ensureDir(skillDir);
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skill_md);
    }
    
    // 4. 可选：分配给当前专家
    if (assign_to_current_expert && context.expert_id) {
      await context.db.ExpertSkill.upsert({
        expert_id: context.expert_id,
        skill_id: skill.id,
        is_enabled: true,
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

#### 关键设计点

1. **按 name 查找**：技能名称是唯一键，用作 Upsert 判断条件
2. **工具全量替换**：更新时先删除旧工具，再插入新工具（简化逻辑）
3. **自动分配**：默认分配给当前专家，AI 不需要额外调用 assign
4. **可选文件创建**：如果提供了 `skill_md` 和 `source_path`，会创建文件

## 使用场景

### 场景1：从现有 SKILL.md 导入

```
用户：把 data/skills/my-search/SKILL.md 导入到系统

AI 执行流程：
1. read_lines("data/skills/my-search/SKILL.md") - 读取文件
2. 理解 SKILL.md 内容，提取技能信息
3. register_skill(
     name: "my-search",
     description: "搜索技能",
     source_path: "my-search",
     tools: [{ name: "search", description: "执行搜索", ... }],
     assign_to_current_expert: true
   )
```

### 场景2：对话创建新技能

```
用户：帮我创建一个天气查询技能

AI 对话收集需求后执行：
1. write_file("data/skills/weather/SKILL.md", content)
2. register_skill(
     name: "weather",
     description: "天气查询",
     source_path: "weather",
     skill_md: content,
     tools: [{ name: "get_weather", ... }],
     assign_to_current_expert: true
   )
```

### 场景3：更新现有技能

```
用户：给搜索技能添加高级搜索功能

AI 执行流程：
1. list_skills() - 查看现有技能
2. register_skill(
     name: "my-search",  // 同名则覆盖
     description: "搜索技能（含高级搜索）",
     tools: [
       { name: "search", ... },
       { name: "advanced_search", ... }  // 新增工具
     ],
     assign_to_current_expert: true
   )
```

## 前端界面简化

### SkillsView 改造

**移除：**
- 复杂的导入表单
- LLM 分析配置界面
- 文件扫描进度显示

**保留/简化：**
- 技能列表展示
- 技能详情查看
- 启用/禁用开关
- 参数配置（API Key 等）

**新增：**
- "与 AI 开发技能" 按钮 → 跳转到对话界面
- 技能市场入口（未来）

### 导入流程改造

**旧流程：**
```
选择目录 → 扫描文件 → LLM 分析 → 确认导入 → 数据库写入
```

**新流程：**
```
"帮我导入 data/skills/xxx" → AI 对话理解 → register_skill
```

## 技术实现要点

### 1. ID 生成

```javascript
function generateId() {
  return require('crypto').randomBytes(16).toString('hex').slice(0, 32);
}
```

### 2. 事务处理

register_skill 和 update_skill 需要事务保证数据一致性：

```javascript
async registerSkill(params, context) {
  const transaction = await context.db.sequelize.transaction();
  try {
    // 1. 创建 skill 记录
    const skill = await context.db.Skill.create({...}, { transaction });
    
    // 2. 创建 skill_tools 记录
    if (params.tools) {
      await context.db.SkillTool.bulkCreate(..., { transaction });
    }
    
    // 3. 创建 skill_parameters 记录
    if (params.parameters) {
      await context.db.SkillParameter.bulkCreate(..., { transaction });
    }
    
    // 4. 可选：创建文件
    if (params.create_files && params.skill_md) {
      // 写入 SKILL.md
    }
    
    await transaction.commit();
    return { success: true, skill };
  } catch (error) {
    await transaction.rollback();
    return { success: false, error: error.message };
  }
}
```

### 3. 权限检查

- 只有管理员可以 delete_skill（硬删除）
- 普通用户可以创建和修改自己创建的技能
- assign_skill 需要检查专家权限

### 4. 文件同步

当 `sync_files: true` 时：
- 更新 skill_md → 同步写入 SKILL.md
- 删除技能 → 可选删除整个目录

## 与现有系统的集成

### skill-loader.js

保持不变，仍然从数据库加载技能定义。

### skill-runner.js

保持不变，根据 skill_tools 中的定义执行工具。

### skill-analyzer.js

**角色转变：**
- 不再用于"导入分析"
- 改为"安全检查"和"格式验证"
- 在 register_skill 时可选调用

## 实施计划

### Phase 1：核心工具实现（1-2天）

1. 在 `tools/builtin/index.js` 中实现：
   - `get_skill`
   - `register_skill`
   - `update_skill`
   - `delete_skill`
   - `assign_skill`
   - `unassign_skill`

2. 添加事务支持和错误处理

### Phase 2：前端简化（1天）

1. 简化 SkillsView，移除复杂导入逻辑
2. 添加"与 AI 开发技能"入口
3. 保留参数配置功能

### Phase 3：测试和文档（1天）

1. 测试各种场景
2. 更新用户文档
3. 添加技能开发指南

## 总结

这个方案的核心思想是：

1. **AI First**：让 AI 成为技能管理的主角
2. **对话式交互**：通过自然语言完成复杂的技能开发
3. **工具化**：把数据库操作封装为内置工具，AI 可直接调用
4. **简化前端**：移除复杂的导入流程，专注于展示和配置

这样，之前讨论的文件扫描、LLM 分析等功能就不再需要了——AI 自己会读取文件、理解内容、生成代码，我们只需要提供数据库操作的工具即可。
