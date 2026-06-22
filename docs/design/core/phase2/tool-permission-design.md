# 技能分级与角色权限设计

## 核心理念

**工具不分级，技能分级**

- 工具是原子能力，本身不分级
- 技能是能力的组合，需要分级
- 专家通过技能获得能力
- 角色决定用户可见哪些专家

## 技能分级

### 级别定义

| 级别 | 名称 | 说明 | 示例技能 |
|------|------|------|----------|
| Level 1 | 基础技能 | 只读操作，无风险 | file-reader, web-search |
| Level 2 | 标准技能 | 写入操作，限制目录 | file-writer, skill-developer |
| Level 3 | 高级技能 | 执行命令，有风险 | code-runner, shell-executor |
| Level 4 | 管理技能 | 系统配置，高风险 | skill-manager, system-admin |

### 数据库设计

```sql
-- skills 表添加 level 字段
ALTER TABLE skills ADD COLUMN level TINYINT DEFAULT 1 
  COMMENT '技能级别: 1=基础, 2=标准, 3=高级, 4=管理';

-- 更新内置技能级别
UPDATE skills SET level = 1 WHERE name = 'builtin';  -- 基础读写工具
UPDATE skills SET level = 2 WHERE name = 'file-writer'; -- 写入工具
UPDATE skills SET level = 3 WHERE name = 'code-runner'; -- 执行命令
UPDATE skills SET level = 4 WHERE name = 'skill-manager'; -- 管理技能
```

### 内置技能分组

```javascript
// tools/builtin/index.js - 拆分为多个技能

// Level 1: 基础技能（只读）
const builtin_readonly = {
  name: 'builtin-readonly',
  description: '基础只读工具：文件读取、列表、搜索、网络请求',
  level: 1,
  tools: [
    'get_env_info', 'list_skills',
    'read_lines', 'read_bytes', 'list_files',
    'search_in_file', 'grep',
    'http_get', 'http_post'
  ]
};

// Level 2: 标准技能（写入）
const builtin_writer = {
  name: 'builtin-writer',
  description: '标准写入工具：文件创建、修改、删除',
  level: 2,
  tools: [
    'write_file', 'append_file', 'replace_in_file',
    'insert_at_line', 'delete_lines',
    'copy_file', 'move_file', 'delete_file', 'create_dir',
    'zip', 'unzip'
  ]
};

// Level 3: 高级技能（执行）
const builtin_executor = {
  name: 'builtin-executor',
  description: '高级执行工具：运行脚本命令',
  level: 3,
  tools: ['execute']
};

// Level 4: 管理技能
const skill_manager = {
  name: 'skill-manager',
  description: '技能管理工具：注册、更新、删除技能',
  level: 4,
  tools: ['register_skill', 'delete_skill', 'assign_skill', 'unassign_skill']
};

const system_admin = {
  name: 'system-admin',
  description: '系统管理工具：配置管理',
  level: 4,
  tools: ['config_get', 'config_set', 'model_manage']
};
```

## 角色与专家可见性

### 数据库设计

```sql
-- 角色表（已存在）
-- roles: id, name, description

-- 专家角色关联表（新增）
CREATE TABLE expert_roles (
  id VARCHAR(32) PRIMARY KEY,
  expert_id VARCHAR(32) NOT NULL COMMENT '专家ID',
  role_id VARCHAR(32) NOT NULL COMMENT '角色ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE KEY uk_expert_role (expert_id, role_id)
) COMMENT '专家角色关联表';

-- 角色最高技能级别限制
ALTER TABLE roles ADD COLUMN max_skill_level TINYINT DEFAULT 2
  COMMENT '该角色可使用的最高技能级别';
```

### 默认角色配置

```javascript
// scripts/init-database.js

const DEFAULT_ROLES = [
  { 
    name: 'admin', 
    description: '管理员',
    max_skill_level: 4  // 可使用所有技能
  },
  { 
    name: 'developer', 
    description: '开发者',
    max_skill_level: 3  // 可使用高级技能
  },
  { 
    name: 'user', 
    description: '普通用户',
    max_skill_level: 2  // 可使用标准技能
  },
  { 
    name: 'guest', 
    description: '访客',
    max_skill_level: 1  // 只能使用基础技能
  }
];
```

### 专家角色配置

```javascript
// 系统专家配置角色可见性

const SYSTEM_EXPERTS = [
  {
    id: 'skill-studio',
    name: 'Skills Studio',
    description: '技能管理助手',
    level: 4,
    roles: ['admin'],  // 只有管理员可见
    skills: ['skill-manager', 'builtin-readonly', 'builtin-writer']
  },
  {
    id: 'system-admin',
    name: '系统管理',
    description: '系统配置管理助手',
    level: 4,
    roles: ['admin'],
    skills: ['system-admin', 'builtin-readonly']
  },
  {
    id: 'developer-assistant',
    name: '开发助手',
    description: '帮助开发者编写代码',
    level: 3,
    roles: ['admin', 'developer'],  // 管理员和开发者可见
    skills: ['builtin-readonly', 'builtin-writer', 'builtin-executor']
  }
];
```

## 权限检查流程

```javascript
// lib/tool-manager.js

/**
 * 检查用户是否有权限使用该技能
 * @param {string} skillId - 技能ID
 * @param {object} context - 上下文 { user, expert, db }
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function checkSkillAccess(skillId, context) {
  const { user, expert, db } = context;
  
  // 1. 获取技能级别
  const skill = await db.Skill.findByPk(skillId);
  if (!skill) {
    return { allowed: false, reason: 'Skill not found' };
  }
  
  const skillLevel = skill.level || 1;
  
  // 2. Level 1 技能：所有人可用
  if (skillLevel === 1) {
    return { allowed: true };
  }
  
  // 3. 获取用户角色
  const userRole = await db.UserRole.findOne({
    where: { user_id: user.id },
    include: [{ model: db.Role }]
  });
  
  if (!userRole || !userRole.Role) {
    return { allowed: false, reason: 'User has no role' };
  }
  
  const role = userRole.Role;
  const maxLevel = role.max_skill_level || 2;
  
  // 4. 检查角色级别限制
  if (skillLevel > maxLevel) {
    return { 
      allowed: false, 
      reason: `Skill level ${skillLevel} exceeds role max level ${maxLevel}` 
    };
  }
  
  // 5. 检查专家角色可见性（如果配置了）
  const expertRole = await db.ExpertRole.findOne({
    where: { expert_id: expert.id, role_id: role.id }
  });
  
  // 如果专家没有角色限制，或者角色匹配
  // 这里的逻辑是：expert_roles 表为空表示公开专家
  const expertRoles = await db.ExpertRole.findAll({
    where: { expert_id: expert.id }
  });
  
  if (expertRoles.length > 0 && !expertRole) {
    return { allowed: false, reason: 'Expert not available for this role' };
  }
  
  return { allowed: true };
}

/**
 * 获取用户可见的专家列表
 * @param {string} userId - 用户ID
 * @param {object} db - 数据库实例
 */
async function getVisibleExperts(userId, db) {
  // 获取用户角色
  const userRole = await db.UserRole.findOne({
    where: { user_id: userId },
    include: [{ model: db.Role }]
  });
  
  if (!userRole) {
    return [];
  }
  
  const roleId = userRole.role_id;
  
  // 查询可见专家：
  // 1. 没有角色限制的专家（公开专家）
  // 2. 角色匹配的专家
  const experts = await db.Expert.findAll({
    where: { is_active: true },
    include: [{
      model: db.ExpertRole,
      required: false,  // LEFT JOIN
      where: { role_id: roleId },
    }]
  });
  
  return experts.filter(expert => {
    // 如果没有角色限制，所有人可见
    if (!expert.ExpertRoles || expert.ExpertRoles.length === 0) {
      return true;
    }
    // 如果有角色限制，检查是否匹配
    return expert.ExpertRoles.length > 0;
  });
}
```

## 使用场景示例

### 场景1: 管理员创建专家

```
Admin: 创建一个"架构师"专家，给它分配高级技能

操作:
1. 创建专家 "architect"
2. 分配技能: builtin-readonly(L1), builtin-writer(L2), builtin-executor(L3), skill-manager(L4)
3. 设置可见角色: admin, developer

结果:
- admin 和 developer 角色可以看到"架构师"专家
- admin 可以使用所有技能（包括 Level 4）
- developer 只能使用 Level 1-3 的技能
```

### 场景2: 普通用户使用专家

```
User (普通用户角色，max_level=2):
- 可以看到: 公开专家 + 角色匹配的专家
- 可以使用: Level 1-2 的技能
- 不能使用: Level 3-4 的技能

如果专家包含 Level 3 技能:
- 技能列表中会显示，但调用时返回权限错误
```

### 场景3: Skills Studio 专家

```
Skills Studio 专家配置:
- 技能: skill-manager(L4), builtin-readonly(L1), builtin-writer(L2)
- 可见角色: admin

结果:
- 只有管理员用户可以看到 Skills Studio
- 其他用户看不到这个专家
```

## 数据库迁移

```sql
-- 1. skills 表添加 level 字段
ALTER TABLE skills ADD COLUMN level TINYINT DEFAULT 1 
  COMMENT '技能级别: 1=基础, 2=标准, 3=高级, 4=管理';

-- 2. roles 表添加 max_skill_level 字段
ALTER TABLE roles ADD COLUMN max_skill_level TINYINT DEFAULT 2
  COMMENT '该角色可使用的最高技能级别';

-- 3. 创建 expert_roles 表
CREATE TABLE expert_roles (
  id VARCHAR(32) PRIMARY KEY,
  expert_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE KEY uk_expert_role (expert_id, role_id)
);

-- 4. 更新默认角色
UPDATE roles SET max_skill_level = 4 WHERE name = 'admin';
UPDATE roles SET max_skill_level = 3 WHERE name = 'developer';
UPDATE roles SET max_skill_level = 2 WHERE name = 'user';
UPDATE roles SET max_skill_level = 1 WHERE name = 'guest';
```

## 前端适配

### 专家列表过滤

```typescript
// frontend/src/stores/expert.ts

async loadExperts() {
  const response = await expertApi.getExperts();
  // 后端已根据角色过滤
  this.experts = response.data;
}
```

### 技能显示

```vue
<template>
  <div class="skill-item" :class="{ disabled: skill.level > userMaxLevel }">
    <span class="skill-name">{{ skill.name }}</span>
    <span class="skill-level">L{{ skill.level }}</span>
    <span v-if="skill.level > userMaxLevel" class="lock-icon">🔒</span>
  </div>
</template>
```

## 总结

### 优势

1. **灵活性高**: Admin 可以自由搭配专家的技能组合
2. **细粒度控制**: 技能分级 + 角色级别限制
3. **可见性控制**: 不同角色看到不同的专家
4. **易于扩展**: 新增技能只需设置级别

### 核心表关系

```
users ──< user_roles >── roles
                         │
                         │ max_skill_level
                         │
experts ──< expert_roles >──┘
   │
   └──< expert_skills >── skills
                             │
                             └── level (1-4)