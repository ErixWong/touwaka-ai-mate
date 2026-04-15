# 知识库权限控制设计

> 创建日期：2026-03-28
> 最后更新：2026-03-28
> 状态：⏳ 设计草案，待确认

## 需求概述

目前知识库没有权限控制，需要实现以下权限体系：

### 核心概念

- **creator_id**：知识库创建者
- **owner_id**：知识库管理员（拥有管理权限）
- **visibility**：公开级别（owner/department/all）
- **"部门级别"**：指知识库 owner 所在的部门

### 私人知识库判断规则

```
owner_id = creator_id = user_id AND user_role != admin
→ 算作私人知识库，每人限1个
→ 必须删除后才能再次创建
```

> **注意**：系统 admin 创建的知识库不受私人知识库数量限制，即使 `owner_id = creator_id = admin`。

### 公开级别

| 级别 | 可见范围 |
|------|---------|
| `owner` | 仅 owner_id 用户可见 |
| `department` | owner 所在部门的所有成员可见 |
| `all` | 全员可见 |

> **边界情况**：如果 owner 没有部门（`department_id` 为 NULL），则 `visibility = 'department'` 等同于 `visibility = 'owner'`。

---

## 现有数据库结构分析

### 相关表结构

#### users 表（用户）
```sql
-- 已有字段
department_id VARCHAR(20) NULL  -- 所属部门
position_id VARCHAR(20) NULL   -- 职位ID
```

#### departments 表（部门）
```sql
-- 已有字段
id VARCHAR(20) PRIMARY KEY
name VARCHAR(100) NOT NULL
parent_id VARCHAR(20) NULL     -- 父部门ID
path VARCHAR(255) NULL         -- 层级路径，如 /1/2/3
level INT DEFAULT 1            -- 层级深度(1-4)
```

#### positions 表（职位）
```sql
-- 已有字段
id VARCHAR(20) PRIMARY KEY
name VARCHAR(100) NOT NULL
department_id VARCHAR(20) NOT NULL
is_manager BIT(1) DEFAULT b'0' -- 是否为负责人职位 ⭐ 关键字段
```

#### roles 表（角色）
```sql
-- 已有字段
level ENUM('user', 'power_user', 'admin')  -- 角色权限等级 ⭐ 关键字段
```

#### knowledge_bases 表（知识库 - 当前）
```sql
-- 已有字段
id VARCHAR(20) PRIMARY KEY
name VARCHAR(255) NOT NULL
description TEXT
owner_id VARCHAR(32) NOT NULL  -- 当前是创建者，需要改造
embedding_model_id VARCHAR(50)
embedding_dim INT DEFAULT 1536
is_public BIT(1) DEFAULT b'0' -- 预留，暂不使用 ⭐ 需要改造
```

---

## 设计方案

### 1. 数据库字段扩展

#### knowledge_bases 表扩展

```sql
-- 新增/修改字段
ALTER TABLE knowledge_bases
ADD COLUMN visibility ENUM('owner', 'department', 'all') DEFAULT 'owner'
  COMMENT '公开级别：owner=仅管理员, department=部门可见, all=全员可见' AFTER description,
ADD COLUMN creator_id VARCHAR(32) NOT NULL
  COMMENT '创建者ID' AFTER owner_id;

-- 修改 owner_id 字段注释
ALTER TABLE knowledge_bases
MODIFY COLUMN owner_id VARCHAR(32) NOT NULL COMMENT '知识库管理员ID';

-- 添加索引
CREATE INDEX idx_kb_visibility ON knowledge_bases(visibility);
CREATE INDEX idx_kb_creator ON knowledge_bases(creator_id);

-- 添加外键
ALTER TABLE knowledge_bases
ADD CONSTRAINT fk_kb_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

-- 移除旧的 is_public 字段（或保留用于其他用途）
-- ALTER TABLE knowledge_bases DROP COLUMN is_public;
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `owner_id` | VARCHAR(32) | 知识库管理员，拥有管理权限 |
| `creator_id` | VARCHAR(32) | 创建者，用于私人知识库数量限制 |
| `visibility` | ENUM | 公开级别，决定访问权限 |

---

### 2. 权限规则设计

#### 创建权限

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识库创建权限规则                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  普通用户创建（私人知识库）                                            │
│  ─────────────────────────────                                      │
│  ✅ 任何用户都可以创建                                                │
│  ❌ 每个用户只能创建 1 个私人知识库                                    │
│  📍 判断条件：owner_id = creator_id = user_id AND role != admin     │
│  📍 创建后必须删除才能再次创建                                        │
│  📍 visibility 默认 = 'owner'                                       │
│  📍 owner_id 必须是创建者自己（不能指定其他人）                         │
│                                                                     │
│  部门负责人创建（部门知识库）                                          │
│  ─────────────────────────────                                      │
│  ✅ 部门负责人可以创建（positions.is_manager = true）                  │
│  ❌ 非部门负责人不能创建                                              │
│  📍 部门负责人 = 当前部门，不包括上下级部门                             │
│  📍 owner_id 默认 = creator_id（可指定同部门成员）                    │
│  📍 visibility 默认 = 'department'                                  │
│  📍 不受私人知识库数量限制（即使 owner_id = creator_id）               │
│                                                                     │
│  管理员创建（管理员知识库）                                            │
│  ─────────────────────────────                                      │
│  ✅ admin 角色可以创建（roles.level = 'admin'）                       │
│  ❌ 非 admin 角色不能创建                                             │
│  📍 可以指定任意用户为 owner_id                                       │
│  📍 visibility 默认 = 'owner'                                        │
│  📍 不受私人知识库数量限制                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> **逻辑自洽性说明**：
> - 部门负责人创建知识库时，即使 `owner_id = creator_id`，也不算私人知识库，因为部门负责人有特殊的创建权限。
> - 系统通过判断用户是否是部门负责人来区分"部门知识库"和"私人知识库"。

#### 访问权限

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识库访问权限规则                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  visibility = 'owner'（仅管理员）                                     │
│  ─────────────────────────────                                      │
│  👁 可访问：owner_id 用户                                            │
│  🔒 其他用户不可见                                                    │
│                                                                     │
│  visibility = 'department'（部门可见）                                │
│  ─────────────────────────────                                      │
│  👁 可访问：                                                          │
│     - owner_id 用户                                                 │
│     - owner 所在部门的所有成员                                        │
│       (users.department_id = owner.department_id)                   │
│  🔒 其他部门用户不可见                                                │
│  📍 owner 转移后，visibility 的语义自然变换为新部门                     │
│                                                                     │
│  visibility = 'all'（全员可见）                                       │
│  ─────────────────────────────                                      │
│  👁 可访问：所有用户                                                  │
│  ✏ 编辑：仅 owner                                                   │
│                                                                     │
│  ⚠️ 特殊权限：admin 角色可以访问所有知识库                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3. 权限规则确认

#### 最高权限

| 角色 | 权限 |
|------|------|
| **系统 admin** | 天然拥有所有知识库的最高权限 |
| **知识库 owner** | 拥有该知识库的最高权限 |

#### 创建规则

| 创建者 | owner_id 默认值 | 数量限制 |
|--------|----------------|----------|
| 普通用户 | `owner_id = creator_id` | 私人知识库限1个 |
| 部门负责人 | `owner_id = creator_id`（可修改） | 无限制 |
| 系统 admin | `owner_id = creator_id`（可指定任意用户） | 无限制 |

#### 管理权限汇总

| 操作 | owner | 系统 admin | 说明 |
|------|-------|-----------|------|
| 查看知识库 | ✅ | ✅ | 根据 visibility 判断 |
| 编辑内容 | ✅ | ✅ | 文章、知识点的增删改 |
| 修改 visibility | ✅ | ✅ | 更改公开级别 |
| 转移 owner | ❌ | ✅ | 防止误操作或权限纠纷 |
| 删除空知识库 | ✅ | ✅ | 无任何内容的知识库 |
| 删除非空知识库 | ❌ | ✅ | 有内容的知识库，需管理员确认 |

#### 删除知识库规则

```
┌─────────────────────────────────────────────────────────────────────┐
│                    删除知识库权限规则                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  知识库为空（无文章/知识点）                                           │
│  ─────────────────────────────                                      │
│  ✅ owner 可以删除                                                   │
│  ✅ 系统 admin 可以删除                                              │
│                                                                     │
│  知识库非空（有文章/知识点）                                           │
│  ─────────────────────────────                                      │
│  ❌ owner 不能删除（防止误操作）                                       │
│  ✅ 系统 admin 可以删除                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### owner 转移规则

```
┌─────────────────────────────────────────────────────────────────────┐
│                    owner 转移权限规则                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ❌ owner 不能自己转移 owner                                         │
│  ✅ 只有系统 admin 可以转移 owner                                    │
│                                                                     │
│  原因：                                                              │
│  - 防止误操作导致权限丢失                                             │
│  - 防止权限纠纷                                                      │
│  - 需要管理员确认和记录                                               │
│                                                                     │
│  转移后影响：                                                         │
│  - visibility = 'department' 的范围自动变更为新 owner 的部门          │
│  - 原 owner 失去管理权限（除非新 owner 重新授权）                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 4. 业务逻辑实现

#### 创建知识库时的校验逻辑

```javascript
/**
 * 创建知识库权限校验
 * @param {Object} params - 创建参数
 * @param {Object} user - 当前用户
 * @returns {Object} - 校验结果
 */
async function validateKbCreation(params, user) {
  const { owner_id, visibility } = params;
  
  // 1. 检查是否是 admin 角色
  const roles = await db.query(
    `SELECT r.level FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [user.id]
  );
  const isAdmin = roles.some(r => r.level === 'admin');
  
  // 2. admin 角色可以创建任意知识库，数量不限
  if (isAdmin) {
    return { 
      valid: true, 
      owner_id: owner_id || user.id,  // 可指定任意用户
      creator_id: user.id 
    };
  }
  
  // 3. 检查是否是部门负责人
  const position = await db.query(
    `SELECT p.is_manager FROM positions p
     JOIN users u ON u.position_id = p.id
     WHERE u.id = ?`,
    [user.id]
  );
  const isDepartmentManager = position[0]?.is_manager;
  
  // 4. 部门负责人创建部门知识库（不受私人知识库数量限制）
  if (isDepartmentManager) {
    // owner_id 默认是创建者自己，但可以修改
    const finalOwnerId = owner_id || user.id;
    
    // 如果指定了 owner_id，必须是同部门成员
    if (owner_id && owner_id !== user.id) {
      const ownerUser = await db.query(
        'SELECT department_id FROM users WHERE id = ?',
        [owner_id]
      );
      
      if (ownerUser[0]?.department_id !== user.department_id) {
        return { valid: false, error: '知识库管理员必须是同部门成员' };
      }
    }
    
    return { 
      valid: true, 
      owner_id: finalOwnerId,
      creator_id: user.id 
    };
  }
  
  // 5. 普通用户创建私人知识库
  // 检查是否已有私人知识库（owner_id = creator_id = user_id）
  const existing = await db.query(
    `SELECT id FROM knowledge_bases 
     WHERE creator_id = ? AND owner_id = ?`,
    [user.id, user.id]
  );
  
  if (existing.length > 0) {
    return { valid: false, error: '每个用户只能创建1个私人知识库' };
  }
  
  // owner_id 必须是创建者自己
  if (owner_id && owner_id !== user.id) {
    return { valid: false, error: '私人知识库的 owner 必须是创建者自己' };
  }
  
  return { 
    valid: true, 
    owner_id: user.id,
    creator_id: user.id 
  };
}
```

> **逻辑自洽性说明**：
> - 部门负责人创建知识库时，即使 `owner_id = creator_id`，也不会检查私人知识库数量限制。
> - 这是因为部门负责人的创建权限优先级高于普通用户。

#### 访问知识库时的权限过滤

```javascript
/**
 * 获取用户可访问的知识库列表
 * @param {Object} user - 当前用户
 * @returns {Array} - 可访问的知识库列表
 */
async function getAccessibleKbList(user) {
  // 1. 检查是否是 admin 角色
  const roles = await db.query(
    `SELECT r.level FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [user.id]
  );
  const isAdmin = roles.some(r => r.level === 'admin');
  
  // admin 可以访问所有知识库
  if (isAdmin) {
    return await db.query('SELECT * FROM knowledge_bases');
  }
  
  // 2. 构建普通用户的访问条件
  const conditions = [];
  const params = [];
  
  // 条件1: owner
  conditions.push('owner_id = ?');
  params.push(user.id);
  
  // 条件2: department 可见且同部门
  if (user.department_id) {
    conditions.push(`
      (visibility = 'department' AND 
       (SELECT department_id FROM users WHERE id = owner_id) = ?)
    `);
    params.push(user.department_id);
  }
  
  // 条件3: all 可见
  conditions.push('visibility = "all"');
  
  // 组合查询
  const sql = `
    SELECT * FROM knowledge_bases
    WHERE ${conditions.join(' OR ')}
    ORDER BY created_at DESC
  `;
  
  return await db.query(sql, params);
}
```

> **边界情况处理**：
> - 如果 `visibility = 'department'` 但 owner 没有部门（`department_id` 为 NULL），则只有 owner 自己能访问（因为子查询返回 NULL，不匹配任何部门）。
> - 这等同于 `visibility = 'owner'` 的效果。

#### 删除知识库权限校验

```javascript
/**
 * 校验用户是否有删除权限
 * @param {string} kb_id - 知识库ID
 * @param {Object} user - 当前用户
 * @returns {Object} - { canDelete: boolean, reason: string }
 */
async function checkDeletePermission(kb_id, user) {
  // 1. 获取知识库信息
  const kb = await db.query('SELECT * FROM knowledge_bases WHERE id = ?', [kb_id]);
  if (!kb[0]) {
    return { canDelete: false, reason: '知识库不存在' };
  }
  
  // 2. 检查是否是 admin 角色
  const roles = await db.query(
    `SELECT r.level FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [user.id]
  );
  const isAdmin = roles.some(r => r.level === 'admin');
  
  // admin 可以删除任何知识库
  if (isAdmin) {
    return { canDelete: true };
  }
  
  // 3. 非 admin，检查是否是 owner
  if (user.id !== kb[0].owner_id) {
    return { canDelete: false, reason: '只有知识库管理员可以删除' };
  }
  
  // 4. owner 只能删除空知识库
  const articleCount = await db.query(
    'SELECT COUNT(*) as count FROM kb_articles WHERE kb_id = ?',
    [kb_id]
  );
  
  if (articleCount[0].count > 0) {
    return { 
      canDelete: false, 
      reason: '知识库非空，需要管理员删除' 
    };
  }
  
  return { canDelete: true };
}
```

#### 转移 owner 权限校验

```javascript
/**
 * 校验用户是否有转移 owner 权限
 * @param {string} kb_id - 知识库ID
 * @param {Object} user - 当前用户
 * @returns {boolean} - 是否有转移权限
 */
async function canTransferOwner(kb_id, user) {
  // 只有系统 admin 可以转移 owner
  const roles = await db.query(
    `SELECT r.level FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [user.id]
  );
  
  return roles.some(r => r.level === 'admin');
}
```

---

### 5. API 设计

#### 创建知识库

```
POST /api/knowledge-bases

Request Body:
{
  "name": "知识库名称",
  "description": "描述",
  "visibility": "owner" | "department" | "all",
  "owner_id": "可选，部门负责人/admin创建时可指定"
}

Response:
{
  "id": "kb_xxx",
  "name": "...",
  "visibility": "...",
  "owner_id": "...",
  "creator_id": "..."
}

错误码：
- 403: 无权限创建（如非部门负责人创建部门知识库）
- 400: 已达私人知识库数量上限
```

#### 获取知识库列表

```
GET /api/knowledge-bases

Response: 只返回用户有权访问的知识库
[
  {
    "id": "kb_xxx",
    "name": "...",
    "visibility": "...",
    "is_owner": true,      // 是否是 owner
    "is_creator": true,    // 是否是 creator
    "can_edit": true,      // 是否有编辑权限
    "can_delete": false,   // 是否有删除权限
    "article_count": 5     // 文章数量（用于判断删除权限）
  }
]
```

#### 更新知识库设置

```
PUT /api/knowledge-bases/:id

Request Body:
{
  "name": "新名称",
  "description": "新描述",
  "visibility": "owner" | "department" | "all"  // 仅 owner 可修改
}

权限要求: owner 或 admin 角色
```

#### 删除知识库

```
DELETE /api/knowledge-bases/:id

权限规则：
- 知识库为空：owner 或 admin 可删除
- 知识库非空：仅 admin 可删除

Response:
{
  "success": true
}

错误码：
- 403: 无权限删除
- 400: 知识库非空，需要管理员删除
```

#### 转移知识库 owner

```
POST /api/knowledge-bases/:id/transfer-owner

Request Body:
{
  "new_owner_id": "user_id"
}

权限要求: 仅系统 admin

Response:
{
  "success": true,
  "old_owner_id": "...",
  "new_owner_id": "..."
}
```

---

### 6. 数据迁移方案

#### 迁移现有知识库

```sql
-- 将现有知识库迁移
-- owner_id 保持不变（作为知识库管理员）
-- creator_id = owner_id（假设现有数据 owner_id 就是创建者）
UPDATE knowledge_bases
SET visibility = 'owner',
    creator_id = owner_id
WHERE creator_id IS NULL;
```

---

## 实现优先级

| 优先级 | 任务 | 预估工时 |
|--------|------|----------|
| P0 | 数据库字段扩展 | 1h |
| P0 | 创建知识库权限校验 | 2h |
| P0 | 访问权限过滤 | 2h |
| P1 | 编辑权限校验 | 1h |
| P1 | API 接口实现 | 2h |
| P1 | 前端界面改造 | 3h |
| P2 | 数据迁移脚本 | 1h |
| P2 | 权限设置界面 | 2h |

---

## 总结

本设计方案简化了权限模型，通过 `visibility` 字段控制访问范围：

### 核心字段
1. **creator_id**：记录创建者，用于私人知识库数量限制
2. **owner_id**：知识库管理员，拥有管理权限
3. **visibility**：控制访问范围，实现三级可见性

### 关键规则
- **私人知识库**：`owner_id = creator_id = user_id AND role != admin`，每人限1个
- **部门负责人**：当前部门，不包括上下级部门
- **owner 转移**：仅系统 admin 可操作，转移后 visibility 语义自动变换

### 权限矩阵

| 操作 | owner | 系统 admin |
|------|-------|-----------|
| 查看知识库 | ✅（根据 visibility） | ✅（全部） |
| 编辑内容 | ✅ | ✅ |
| 修改 visibility | ✅ | ✅ |
| 转移 owner | ❌ | ✅ |
| 删除空知识库 | ✅ | ✅ |
| 删除非空知识库 | ❌ | ✅ |

### 逻辑自洽性检查

| 场景 | 处理方式 | 状态 |
|------|---------|------|
| 部门负责人创建知识库时 `owner_id = creator_id` | 不计入私人知识库数量限制 | ✅ 已处理 |
| admin 创建知识库时 `owner_id = creator_id` | 不计入私人知识库数量限制 | ✅ 已处理 |
| owner 没有部门时 `visibility = 'department'` | 等同于 `visibility = 'owner'` | ✅ 已处理 |
| owner 转移后 `visibility = 'department'` | 自动变换为新 owner 的部门 | ✅ 已处理 |
| creator 是否有特殊权限 | 无，只有 owner 有管理权限 | ✅ 已明确 |

### 实现优先级

| 优先级 | 任务 | 预估工时 |
|--------|------|----------|
| P0 | 数据库字段扩展 | 1h |
| P0 | 创建知识库权限校验 | 2h |
| P0 | 访问权限过滤 | 2h |
| P1 | 删除权限校验 | 1h |
| P1 | API 接口实现 | 2h |
| P1 | 前端界面改造 | 3h |
| P2 | 数据迁移脚本 | 1h |
| P2 | owner 转移界面 | 2h |

---

✌Bazinga！亲爱的