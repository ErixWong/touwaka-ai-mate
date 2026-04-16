# 组织架构设计

> 版本：2.0  
> 最后更新：2026-03-08
> 状态：**已实现（Phase 1）**

---

## 概述

本文档描述公司组织架构的设计与实现，用于支持：
- 部门树形结构管理
- 职位定义（含负责人标识）
- 用户-部门-职位关联
- 部门级知识库权限控制（Phase 2）

---

## 设计原则

**第一版简化原则**：
- 一个用户只能属于一个部门、拥有一个职位
- 职位不跨部门（必须属于某个部门）
- 部门层级最多 4 层
- 删除操作禁止级联，必须手工清理
- 权限管理仅 admin 可操作（部门负责人权限后续扩展）

---

## 数据库设计

### 1. 部门表 (departments)

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

### 2. 职位表 (positions)

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

### 3. 用户表扩展 (users)

在 users 表添加字段：

```sql
ALTER TABLE users 
  ADD COLUMN department_id VARCHAR(20) NULL COMMENT '所属部门',
  ADD COLUMN position_id VARCHAR(20) NULL COMMENT '职位ID',
  ADD INDEX idx_department (department_id),
  ADD INDEX idx_position (position_id);
```

---

## 业务规则

### 部门管理
1. 部门层级最多 **4级**
2. 部门**按名称排序**
3. 部门删除规则（禁止级联）：
   - 有子部门时：禁止删除，提示"请先删除子部门"
   - 有职位时：禁止删除，提示"请先删除职位"
   - 有成员时：禁止删除，提示"请先移除部门成员"

### 职位管理
1. 职位必须属于某个部门（不能跨部门）
2. 每个部门建议至少有一个 `is_manager=true` 的职位
3. 职位排序：负责人职位优先，其他**按名称排序**
4. 删除职位前必须先移除该职位下的所有用户

### 用户组织关系
1. 一个用户只能属于**一个部门**、拥有**一个职位**
2. 用户可以无部门（department_id=NULL）
3. 换部门：直接修改用户的 department_id 和 position_id
4. 离职：在用户管理中 disable 用户账号

### 部门负责人
1. 通过职位的 `is_manager` 字段标识
2. 获取部门负责人：查询部门下 `is_manager=true` 的职位对应的用户
3. 一个部门可以有多个负责人（如总监+副总监）

### 权限控制
1. **第一版**：仅 admin 角色可以管理组织架构
2. **后续扩展**：部门负责人可管理本部门成员（通过角色权限系统实现）

---

## API 设计

### 部门管理 API

```
GET    /api/departments/tree       # 获取部门树
POST   /api/departments            # 创建部门
GET    /api/departments/:id        # 获取部门详情
PUT    /api/departments/:id        # 更新部门
DELETE /api/departments/:id        # 删除部门
GET    /api/departments/:id/positions  # 获取部门职位列表（含成员）
GET    /api/departments/:id/managers   # 获取部门负责人
```

### 职位管理 API

```
GET    /api/positions              # 获取职位列表（可按部门筛选）
POST   /api/positions              # 创建职位
GET    /api/positions/:id          # 获取职位详情
PUT    /api/positions/:id          # 更新职位
DELETE /api/positions/:id          # 删除职位
GET    /api/positions/:id/members  # 获取该职位的用户
```

### 用户组织信息 API

```
PUT    /api/users/:id/organization # 设置用户的部门和职位
DELETE /api/users/:id/organization # 移除用户的部门关联
GET    /api/users/unassigned       # 获取未分配部门的用户
```

---

## 前端设计

### 菜单位置

组织架构菜单放在**设置**里，位于**用户管理**的左边。

当前设置页面 Tab顺序：
1. 个人资料 (profile)
2. 模型和提供商 (model)
3. 专家设置 (expert)
4. **组织架构 (organization)** ← 新增
5. 用户管理 (user)
6. 角色管理 (role)
7. 关于 (about)

### 组织架构页面布局

采用左右分栏布局，右侧使用卡片式设计：

```
┌────────────────────┬────────────────────────────────────────────────────┐
│                    │                                                    │
│   部门树            │   部门: 技术部                    [+ 新增职位]       │
│                    │   ─────────────────────────────────────────────    │
│   🏢 总公司         │                                                    │
│   ├── 💻 技术部 ←选中│   ┌──────────────────────────────────────────┐   │
│   │   ├── 🎨 前端组  │   │ ★ 技术总监                        [编辑] │   │
│   │   ├── ⚙️ 后端组  │   │   ┌────────────────────────────────────┐ │   │
│   │   └── 🔧 运维组  │   │   │ 👤 张三                            │ │   │
│   ├── 📋 产品部    │   │   └────────────────────────────────────┘ │   │
│   └── 📢 市场部    │   └──────────────────────────────────────────┘   │
│                    │                                                    │
│   [+ 新增部门]      │   ┌──────────────────────────────────────────┐   │
│                    │   │   高级工程师                      [编辑] │   │
│                    │   │   ┌────────────────────────────────────┐ │   │
│                    │   │   │ 👤 王五  👤 赵六  👤 钱七  +3人      │ │   │
│                    │   │   └────────────────────────────────────┘ │   │
│                    │   └──────────────────────────────────────────┘   │
│                    │                                                    │
└────────────────────┴────────────────────────────────────────────────────┘
```

---

## 实施状态

### Phase 1: 组织架构基础 ✅ 已完成
- [x] 创建 departments 表
- [x] 创建 positions 表
- [x] 修改 users 表添加 department_id、position_id
- [x] 生成 Sequelize 模型
- [x] 部门 CRUD API
- [x] 职位 CRUD API
- [x] 用户组织信息 API
- [x] 前端组织架构管理界面（卡片式布局）

### Phase 2: 知识库权限 ⏳ 待实现
- [ ] 修改 knowledge_bases 表
- [ ] 创建 kb_permissions 表
- [ ] 权限检查中间件
- [ ] 权限管理 API
- [ ] 前端权限设置界面

### Phase 3: 权限扩展 ⏳ 待实现
- [ ] 部门负责人管理本部门成员的权限
- [ ] 集成到角色权限系统

---

## 相关文件

- 数据模型：`models/department.js`, `models/position.js`, `models/user.js`
- 控制器：`server/controllers/department.controller.js`, `server/controllers/position.controller.js`
- 路由：`server/routes/department.routes.js`, `server/routes/position.routes.js`
- 前端组件：`frontend/src/components/settings/OrganizationTab.vue`
- 迁移脚本：`scripts/migrate-organization.js`

---

## 相关 Issue

- GitHub Issue: [#31](https://github.com/ErixWong/touwaka-ai-mate/issues/31)
- Pull Request: [#32](https://github.com/ErixWong/touwaka-ai-mate/pull/32)
