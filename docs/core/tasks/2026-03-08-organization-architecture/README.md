# 组织架构与部门级知识库权限控制

## Issue

- GitHub Issue: [#31](https://github.com/ErixWong/touwaka-ai-mate/issues/31)
- 创建日期: 2026-03-08

## 背景

当前系统的知识库仅支持用户级别 ownership（`owner_id` 指向 `users.id`），缺乏组织架构支持，导致：
1. 无法实现部门级别的知识库共享
2. 权限控制粒度不够细
3. 无法按组织结构管理用户

## 目标

建立完整的组织架构体系，支持：
1. 部门树形结构管理
2. 职位/角色定义
3. 用户-部门-职位的关联
4. 部门级知识库与权限控制

## 数据库设计

### 1. 部门表 (departments)

```sql
CREATE TABLE departments (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '部门名称',
  parent_id VARCHAR(20) NULL COMMENT '父部门ID，NULL表示顶级部门',
  path VARCHAR(255) NULL COMMENT '层级路径，如 /1/2/3，用于快速查询子树',
  level INT DEFAULT 1 COMMENT '层级深度',
  manager_id VARCHAR(32) NULL COMMENT '部门负责人用户ID',
  description TEXT NULL COMMENT '部门描述',
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_path (path),
  INDEX idx_manager (manager_id)
);
```

### 2. 职位表 (positions)

```sql
CREATE TABLE positions (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '职位名称',
  department_id VARCHAR(20) NULL COMMENT '所属部门，NULL表示全局职位',
  level INT DEFAULT 1 COMMENT '职级，用于权限比较',
  description TEXT NULL COMMENT '职位描述',
  permissions JSON NULL COMMENT '职位特定权限',
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department_id)
);
```

### 3. 用户部门关联表 (user_departments)

```sql
CREATE TABLE user_departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  department_id VARCHAR(20) NOT NULL,
  position_id VARCHAR(20) NULL COMMENT '用户在该部门的职位',
  is_primary BOOLEAN DEFAULT FALSE COMMENT '是否主部门',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_dept (user_id, department_id),
  INDEX idx_user (user_id),
  INDEX idx_department (department_id),
  INDEX idx_position (position_id)
);
```

### 4. 知识库权限扩展

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

## API 设计

### 部门管理 API

```
GET    /api/departments           # 获取部门树
POST   /api/departments           # 创建部门（需管理员权限）
GET    /api/departments/:id       # 获取部门详情
PUT    /api/departments/:id       # 更新部门
DELETE /api/departments/:id       # 删除部门
GET    /api/departments/:id/users # 获取部门成员
```

### 职位管理 API

```
GET    /api/positions             # 获取职位列表
POST   /api/positions             # 创建职位（需管理员权限）
GET    /api/positions/:id         # 获取职位详情
PUT    /api/positions/:id         # 更新职位
DELETE /api/positions/:id         # 删除职位
```

### 用户组织信息 API

```
GET    /api/users/:id/departments # 获取用户所属部门
PUT    /api/users/:id/departments # 设置用户部门关联
```

### 知识库权限 API

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

### Phase 1: 基础架构 (预计 2-3 天)
- [ ] 创建数据库表
- [ ] 生成 Sequelize 模型
- [ ] 创建基础 Controller 和 Routes

### Phase 2: 部门管理 (预计 1-2 天)
- [ ] 部门 CRUD API
- [ ] 部门树形结构查询
- [ ] 前端部门管理界面

### Phase 3: 职位管理 (预计 1-2 天)
- [ ] 职位 CRUD API
- [ ] 用户-部门-职位关联
- [ ] 前端职位管理界面

### Phase 4: 知识库权限 (预计 2-3 天)
- [ ] 修改知识库模型
- [ ] 权限检查中间件
- [ ] 权限管理 API
- [ ] 前端权限设置界面

### Phase 5: 测试与文档 (预计 1-2 天)
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
