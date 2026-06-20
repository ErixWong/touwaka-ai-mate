# Skills Studio 专家设计

## 核心理念：万物皆专家

系统中的所有功能都通过"与专家对话"实现：

| 专家 | 职责 | 技能 |
|------|------|------|
| **skill-studio** | 技能管理 | register_skill, list_skills, assign_skill |
| **system-admin** | 系统配置 | config_get, config_set, model_manage |
| **用户创建的专家** | 各种专业任务 | 用户分配的技能 |

## 设计方案

**Skills Studio 本质上就是一个特殊的 Expert**

- 复用现有的 ChatView 框架
- 固定的 `skill-studio` Expert，专门处理技能管理
- 右侧面板显示技能列表 Tab
- 用户可以选择模型进行对话

## 界面布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Skills Studio (skill-studio 专家)               [模型选择器]    │
├─────────────────────────────────────────────────────────────────┤
│                                                    │             │
│   对话区域（与 skill-studio 专家对话）             │  右侧面板   │
│                                                    │             │
│   ┌────────────────────────────────────────────┐   │  ┌────────┐ │
│   │ 用户: 帮我导入 data/skills/searxng         │   │  │ Skills │ │
│   └────────────────────────────────────────────┘   │  ├────────┤ │
│                                                    │  │searxng │ │
│   ┌────────────────────────────────────────────┐   │  │weather │ │
│   │ AI: ✅ 已成功注册技能 searxng             │   │  │pdf     │ │
│   │ 分配给了当前专家                          │   │  └────────┘ │
│   └────────────────────────────────────────────┘   │             │
│                                                    │  ┌────────┐ │
│                                                    │  │ 详情   │ │
│                                                    │  └────────┘ │
├────────────────────────────────────────────────────┴─────────────┤
│  [输入框: 告诉 AI 你想导入什么技能...]              [发送]        │
└─────────────────────────────────────────────────────────────────┘
```

## 技术实现

### 1. 路由配置

```typescript
// router/index.ts
{
  path: '/skills-studio',
  name: 'SkillsStudio',
  component: () => import('@/views/ExpertChatView.vue'), // 复用专家对话视图
  meta: { 
    requiresAuth: true,
    expertId: 'skill-studio' // 固定专家ID
  }
}
```

### 2. skill-studio Expert 配置

在数据库初始化时创建：

```javascript
// scripts/init-database.js
const SYSTEM_EXPERTS = [
  {
    id: 'skill-studio',
    name: 'Skills Studio',
    introduction: '技能管理助手，帮助你导入、创建和管理技能',
    speaking_style: '专业、简洁、友好',
    system_prompt: `你是一个技能管理助手。

用户可以通过对话让你：
1. 导入本地技能目录（提供路径）
2. 创建新技能（对话描述需求）
3. 修改现有技能
4. 分配技能给专家

你可以使用以下工具：
- read_file: 读取 SKILL.md 文件
- write_file: 创建或修改文件
- register_skill: 注册/更新技能
- list_skills: 列出已注册技能
- assign_skill: 分配技能给专家
- unassign_skill: 取消分配

在导入技能时，先读取 SKILL.md，理解技能结构，
然后使用 register_skill 工具注册到数据库。`,
    
    // 不绑定特定模型，用户自己选择
    expressive_model_id: null,
    
    // 标记为系统专家
    is_system: true,
    is_active: true,
    
    // 允许的工具
    skills: ['skill-manager'] // 内置技能管理技能
  }
];
```

### 3. 内置技能：skill-manager

```javascript
// tools/builtin/skill-manager.js
module.exports = {
  name: 'skill-manager',
  tools: {
    register_skill: {
      description: '注册或更新技能（同名则覆盖）',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名称（唯一标识）' },
          description: { type: 'string', description: '技能描述' },
          tools: { type: 'array', description: '工具列表' },
          source_path: { type: 'string', description: '源码路径' },
          skill_md: { type: 'string', description: 'SKILL.md 内容' }
        },
        required: ['name']
      }
    },
    
    list_skills: {
      description: '列出已注册的技能',
      parameters: { type: 'object', properties: {} }
    },
    
    assign_skill: {
      description: '分配技能给专家',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string' },
          expert_id: { type: 'string' }
        },
        required: ['skill_id', 'expert_id']
      }
    },
    
    unassign_skill: {
      description: '取消分配技能',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string' },
          expert_id: { type: 'string' }
        },
        required: ['skill_id', 'expert_id']
      }
    }
  }
};
```

### 4. 右侧面板：SkillsTabPanel

复用 RightPanel 的 tab 结构，固定显示技能相关内容：

```vue
<!-- components/panel/SkillsTabPanel.vue -->
<template>
  <div class="skills-tab-panel">
    <!-- 技能列表 -->
    <div class="skills-list">
      <div class="panel-header">
        <h3>技能列表</h3>
        <span class="count">{{ skills.length }}</span>
      </div>
      
      <div v-for="skill in skills" :key="skill.id" 
           class="skill-item"
           :class="{ selected: selectedSkill?.id === skill.id }"
           @click="selectSkill(skill)">
        <span class="skill-name">{{ skill.name }}</span>
        <span class="skill-status" :class="{ active: skill.is_active }">
          {{ skill.is_active ? '启用' : '禁用' }}
        </span>
      </div>
    </div>
    
    <!-- 技能详情 -->
    <div v-if="selectedSkill" class="skill-detail">
      <h4>{{ selectedSkill.name }}</h4>
      <p>{{ selectedSkill.description }}</p>
      
      <div class="tool-list">
        <h5>工具</h5>
        <div v-for="tool in selectedSkill.tools" :key="tool.id" class="tool-item">
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-desc">{{ tool.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
```

### 5. 导航入口

在主导航中添加 Skills Studio 入口：

```vue
<!-- AppHeader.vue -->
<template>
  <nav>
    <router-link to="/chat/:expertId">对话</router-link>
    <router-link to="/skills-studio">Skills Studio</router-link>
    <router-link to="/settings">设置</router-link>
  </nav>
</template>
```

## 使用场景

### 场景1: 导入本地技能

```
用户: 帮我导入 data/skills/searxng

AI: 好的，让我读取这个技能...
[调用 read_file("data/skills/searxng/SKILL.md")]

AI: 我找到了这个技能：
- 名称: searxng
- 描述: 使用本地 SearXNG 实例搜索网络
- 工具: web_search

要注册到系统吗？

用户: 是的

AI: [调用 register_skill]
✅ 已成功注册技能 searxng
```

### 场景2: 创建新技能

```
用户: 帮我创建一个天气查询技能

AI: 好的，请告诉我：
1. 你想使用哪个天气 API？
2. 需要哪些功能？

用户: 使用 OpenWeatherMap，只需要当前天气

AI: [调用 write_file 创建 SKILL.md]
[调用 register_skill]

✅ 已创建技能 weather
```

### 场景3: 分配技能

```
用户: 把 weather 技能分配给助手专家

AI: [调用 assign_skill]
✅ 已将 weather 技能分配给助手专家
```

## 扩展：其他系统专家

按照"万物皆专家"的理念，可以继续添加：

### system-admin 专家

```javascript
{
  id: 'system-admin',
  name: '系统管理',
  introduction: '系统配置管理助手',
  system_prompt: `你是系统管理助手，可以帮助用户：
- 配置模型参数
- 管理提供商设置
- 查看系统状态`,
  skills: ['system-config']
}
```

### debug-expert 专家

```javascript
{
  id: 'debug-expert',
  name: '调试专家',
  introduction: '帮助调试和排错',
  system_prompt: `你是调试专家，可以帮助用户：
- 分析日志
- 排查错误
- 性能分析`,
  skills: ['log-analyzer', 'debug-tools']
}
```

## 实施计划

### Phase 1: 核心 (1 天)

1. 数据库初始化：添加 skill-studio Expert
2. 路由配置：`/skills-studio` 复用 ExpertChatView
3. 实现 register_skill 工具

### Phase 2: 界面 (1 天)

1. 创建 SkillsTabPanel 组件
2. 修改 ChatView：根据 expertId 显示不同右侧面板
3. 添加导航入口

### Phase 3: 完善 (1 天)

1. 技能列表实时更新
2. 技能详情展示
3. 快捷指令支持

## 总结

"万物皆专家"的优势：

1. **界面统一**：所有功能都是"与专家对话"
2. **架构简洁**：复用 ChatView，无需新建视图
3. **权限灵活**：通过技能分配控制专家能力
4. **易于扩展**：添加新功能 = 添加新专家
5. **模型可选**：用户选择与专家对话时使用的模型