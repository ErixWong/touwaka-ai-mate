# 组织架构与部门级知识库权限控制

## Issue

- GitHub Issue: [#31](https://github.com/ErixWong/touwaka-ai-mate/issues/31)
- Pull Request: [#32](https://github.com/ErixWong/touwaka-ai-mate/pull/32)
- 创建日期: 2026-03-08
- **最后更新: 2026-03-08**（同步实际实现）

## 当前状态

**Phase 1 已完成**：基础组织架构（部门+职位）
**Phase 2 待实现**：知识库权限控制

## 背景

当前系统的知识库仅支持用户级别 ownership（`owner_id` 指向 `users.id`），缺乏组织架构支持，导致：
1. 无法实现部门级别的知识库共享
2. 权限控制粒度不够细
3. 无法按组织结构管理用户

## 目标

建立完整的组织架构体系，支持：
1. 部门树形结构管理 ✅ 已实现
2. 职位定义（含负责人标识） ✅ 已实现
3. 用户-部门-职位的关联 ✅ 已实现（简化版：一个用户只能属于一个部门）
4. 部门级知识库与权限控制 ⏳ 待实现

## 前端设计

### 菜单位置

组织架构菜单放在**设置**里，位于**用户管理**的左边。

当前设置页面 Tab顺序：
1. 个人资料 (profile)
2. 模型和提供商 (model)
3. 专家设置 (expert)
4. **组织架构 (organization)** ← 新增，放在用户管理左边
5. 用户管理 (user)
6. 角色管理 (role)
7. 关于 (about)

### 组织架构页面布局

采用左右分栏布局：

```
┌─────────────────────────────────────────────────────────────┐
│  设置 > 组织架构                                              │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│   部门树              │         部门详情 / 职位管理            │
│                      │                                      │
│   📁 总公司           │   部门名称: [技术部        ]          │
│   ├── 📁 技术部 ←选中  │   部门描述: [负责技术研发    ]        │
│   │   ├── 前端组      │   部门负责人: [张三 ▼]              │
│   │   ├── 后端组      │                                      │
│   │   └── 运维组      │   ┌────────────────────────────┐    │
│   ├── 📁 产品部      │   │ 职位列表                    │    │
│   └── 📁 市场部      │   │                            │    │
│                      │   │ ☰ 技术总监 - 张三           │    │
│   [+ 新增部门]        │   │ ☰ 高级工程师 - 李四, 王五   │    │
│                      │   │ ☰ 工程师 - 赵六            │    │
│                      │   │                            │    │
│                      │   │ [+ 新增职位]                │    │
│                      │   └────────────────────────────┘    │
│                      │                                      │
│                      │   ┌────────────────────────────┐    │
│                      │   │ 部门成员                    │    │
│                      │   │                            │    │
│                      │   │ 张三 (技术总监) [主部门]     │    │
│                      │   │ 李四 (高级工程师)           │    │
│                      │   │ 王五 (高级工程师)           │    │
│                      │   │                            │    │
│                      │   │ [+ 添加成员]                │    │
│                      │   └────────────────────────────┘    │
└──────────────────────┴──────────────────────────────────────┘
```

## 数据库设计（已实现）

> **注意**：以下为实际实现的数据库结构，与原始设计有简化。

### 1. 部门表 (departments) ✅

```sql
CREATE TABLE departments (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '部门名称',
  parent_id VARCHAR(20) NULL COMMENT '父部门ID',
  path VARCHAR(255) NULL COMMENT '层级路径，如 /1/2/3',
  level INT DEFAULT 1 COMMENT '层级深度(1-4)',
  sort_order INT DEFAULT 0 COMMENT '同级排序',
  description TEXT NULL COMMENT '部门描述',
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_path (path),
  INDEX idx_status (status)
);
```

### 2. 职位表 (positions) ✅

```sql
CREATE TABLE positions (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '职位名称',
  department_id VARCHAR(20) NOT NULL COMMENT '所属部门',
  is_manager BOOLEAN DEFAULT FALSE COMMENT '是否为负责人职位',
  sort_order INT DEFAULT 0 COMMENT '排序',
  description TEXT NULL COMMENT '职位描述',
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department_id),
  INDEX idx_status (status)
);
```

### 3. 用户表扩展 (users) ✅

在 users 表直接添加字段（简化设计，一个用户只属于一个部门）：

```sql
ALTER TABLE users 
  ADD COLUMN department_id VARCHAR(20) NULL COMMENT '所属部门',
  ADD COLUMN position_id VARCHAR(20) NULL COMMENT '职位ID',
  ADD INDEX idx_department (department_id),
  ADD INDEX idx_position (position_id);
```

### 4. 知识库权限扩展 ⏳待实现

修改 `knowledge_bases` 表：

```sql
ALTER TABLE knowledge_bases 
  ADD COLUMN owner_type ENUM('user', 'department') DEFAULT 'user' COMMENT '所有者类型' AFTER owner_id,
  ADD COLUMN department_id VARCHAR(20) NULL COMMENT '所属部门ID' AFTER owner_type,
  ADD INDEX idx_department (department_id);
```

新增知识库访问权限表：

```sql
CREATE TABLE kb_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL COMMENT '知识库ID',
  target_type ENUM('user', 'department', 'position') NOT NULL COMMENT '授权对象类型',
  target_id VARCHAR(32) NOT NULL COMMENT '授权对象ID',
  permission_level ENUM('read', 'write', 'admin') DEFAULT 'read' COMMENT '权限级别',
  granted_by VARCHAR(32) NOT NULL COMMENT '授权人',
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_kb_target (kb_id, target_type, target_id),
  INDEX idx_kb (kb_id),
  INDEX idx_target (target_type, target_id)
);
```

### 设计变更说明

| 原设计 | 实际实现 | 原因 |
|--------|----------|------|
| `departments.manager_id` | 通过职位的 `is_manager` 标识 | 更灵活，一个部门可有多个负责人 |
| `positions.level` | 未实现 | 简化第一版 |
| `positions.permissions` | 未实现 | 简化第一版 |
| 独立 `user_departments` 表 | 直接在 `users` 表添加字段 | 简化设计，一个用户只属于一个部门 |

## API 设计（已实现）

### 部门管理 API ✅

```
GET    /api/departments/tree        # 获取部门树
POST   /api/departments             # 创建部门（需管理员权限）
GET    /api/departments/:id         # 获取部门详情
PUT    /api/departments/:id         # 更新部门
DELETE /api/departments/:id         # 删除部门
GET    /api/departments/:id/positions  # 获取部门职位列表（含成员）
GET    /api/departments/:id/managers   # 获取部门负责人
```

### 职位管理 API ✅

```
GET    /api/positions               # 获取职位列表（可按部门筛选）
POST   /api/positions               # 创建职位（需管理员权限）
GET    /api/positions/:id           # 获取职位详情
PUT    /api/positions/:id           # 更新职位
DELETE /api/positions/:id           # 删除职位
GET    /api/positions/:id/members   # 获取该职位的用户
```

### 用户组织信息 API ✅

```
PUT    /api/users/:id/organization  # 设置用户的部门和职位
DELETE /api/users/:id/organization  # 移除用户的部门关联
GET    /api/users/unassigned        # 获取未分配部门的用户
```

### 知识库权限 API ⏳待实现

```
GET    /api/knowledge-bases/:kb_id/permissions  # 获取知识库权限列表
POST   /api/knowledge-bases/:kb_id/permissions  # 添加权限
DELETE /api/knowledge-bases/:kb_id/permissions/:id # 移除权限
```

## 权限检查逻辑

```javascript
async function checkKbAccess(userId, kbId, requiredLevel) {
  const kb = await KnowledgeBase.findByPk(kbId);
  
  // 1. 所有者拥有完全权限
  if (kb.owner_type === 'user' && kb.owner_id === userId) {
    return true;
  }
  
  // 2. 检查直接授权
  const directPerm = await KbPermission.findOne({
    where: { kb_id: kbId, target_type: 'user', target_id: userId }
  });
  if (directPerm && permissionLevel >= requiredLevel) {
    return true;
  }
  
  // 3. 获取用户部门和职位
  const userDepts = await UserDepartment.findAll({ 
    where: { user_id: userId } 
  });
  
  // 4. 检查部门权限
  for (const ud of userDepts) {
    // 部门级知识库，成员自动有读权限
    if (kb.department_id === ud.department_id) {
      if (requiredLevel === 'read') return true;
    }
    
    // 检查部门授权
    const deptPerm = await KbPermission.findOne({
      where: { kb_id: kbId, target_type: 'department', target_id: ud.department_id }
    });
    if (deptPerm && deptPerm.permission_level >= requiredLevel) {
      return true;
    }
    
    // 检查职位授权
    if (ud.position_id) {
      const posPerm = await KbPermission.findOne({
        where: { kb_id: kbId, target_type: 'position', target_id: ud.position_id }
      });
      if (posPerm && posPerm.permission_level >= requiredLevel) {
        return true;
      }
    }
  }
  
  return false;
}
```

## 实施步骤

### Phase 1: 基础架构 ✅ 已完成
- [x] 创建数据库表
- [x] 生成 Sequelize 模型
- [x] 创建基础 Controller 和 Routes

### Phase 2: 部门管理 ✅ 已完成
- [x] 部门 CRUD API
- [x] 部门树形结构查询
- [x] 前端部门管理界面

### Phase 3: 职位管理 ✅ 已完成
- [x] 职位 CRUD API
- [x] 用户-部门-职位关联
- [x] 前端职位管理界面

### Phase 4: 知识库权限 ⏳ 待实现
- [ ] 修改知识库模型
- [ ] 权限检查中间件
- [ ] 权限管理 API
- [ ] 前端权限设置界面

### Phase 5: 测试与文档 ⏳ 待实现
- [ ] 单元测试
- [ ] 集成测试
- [ ] API 文档更新

## 注意事项

1. **数据迁移**: 需要为现有知识库设置默认的 `owner_type = 'user'`
2. **向后兼容**: 权限检查需要兼容旧的个人知识库
3. **性能优化**: 部门树查询使用 `path` 字段优化
4. **权限缓存**: 考虑使用 Redis 缓存用户权限信息

## 相关 Issue

- #20 技能执行支持任务感知的工作目录（可能需要部门级工作空间）
