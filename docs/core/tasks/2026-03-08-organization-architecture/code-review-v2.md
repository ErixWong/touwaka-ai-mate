# PR #32 代码审计报告

**审计日期**: 2026-03-08
**审计人**: Maria
**审计范围**: 组织架构功能（前后端完整实现）

## 审计结果摘要

| 类别 | 数量 | 状态 |
|------|------|------|
| 🔴 严重问题 | 1 | 待修复 |
| 🟡 中等问题 | 3 | 待修复 |
| 🟢 轻微问题/建议 | 4 | 可选修复 |

---

## 🔴 严重问题

### 1. 路由顺序冲突导致职位接口无法访问

**文件**: `server/routes/position.routes.js:47-48`

**问题**: `GET /positions/:id` 和 `GET /positions/department/:department_id` 路由冲突

```javascript
// 第 27 行
router.get('/:id', authMiddleware, async (ctx) => { ... });

// 第 47 行
router.get('/department/:department_id', authMiddleware, async (ctx) => { ... });
```

当请求 `/positions/department/abc123` 时，会被 `/:id` 路由先匹配，导致 `department` 被当作 `id` 参数处理。

**修复方案**: 调整路由顺序，将更具体的路由放在前面：

```javascript
// 获取部门下的所有职位（放在 /:id 前面）
router.get('/department/:department_id', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartmentPositions(ctx);
});

// 获取职位详情
router.get('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).getPosition(ctx);
});
```

---

## 🟡 中等问题

### 2. 部门名称重复检查缺失

**文件**: `server/controllers/department.controller.js:48-110`

**问题**: 创建和更新部门时未检查同名部门是否已存在，可能导致组织架构混乱。

**修复建议**: 在 `createDepartment` 和 `updateDepartment` 方法中添加重名检查：

```javascript
// 创建部门时检查同级是否已有同名部门
const existing = await this.Department.findOne({
  where: { 
    name, 
    parent_id: parentId,
    status: 'active' 
  }
});
if (existing) {
  ctx.error('同级部门已存在同名部门', 409);
  return;
}
```

### 3. 更新操作未过滤空值

**文件**: `server/controllers/department.controller.js:160-163`

**问题**: 更新部门时直接传入 `name` 和 `description`，未检查是否为 `undefined`，可能导致意外覆盖。

```javascript
await this.Department.update(
  { name, description },  // 如果前端未传，会覆盖为 undefined
  { where: { id } }
);
```

**修复建议**:

```javascript
const updates = {};
if (name !== undefined) updates.name = name;
if (description !== undefined) updates.description = description;

if (Object.keys(updates).length === 0) {
  ctx.error('没有要更新的字段');
  return;
}

await this.Department.update(updates, { where: { id } });
```

### 4. 职位管理中删除职位时未验证状态

**文件**: `server/controllers/position.controller.js:134-160`

**问题**: 删除职位时仅检查是否有成员，未检查职位状态是否为 `inactive`，直接物理删除可能导致数据丢失。

**建议**: 考虑使用软删除（将 status 改为 'inactive'）而非物理删除，与系统其他模块保持一致。

---

## 🟢 轻微问题/建议

### 5. 前端错误提示使用 alert

**文件**: `frontend/src/components/settings/OrganizationTab.vue:306, 323, 368, 381`

**问题**: 使用原生 `alert()` 提示错误，用户体验不佳。

```javascript
alert(t('common.saveFailed'))
```

**建议**: 使用统一的 Toast 或 Message 组件进行提示。

### 6. 迁移脚本缺少错误回滚机制

**文件**: `scripts/migrate-organization.js`

**问题**: 迁移脚本执行多个 DDL 操作，但未使用事务或提供回滚脚本。如果中途失败，可能导致数据库状态不一致。

**建议**: 
- 创建对应的 `rollback-organization.js` 回滚脚本
- 或在文档中说明如何手动回滚

### 7. 前端组件未处理空字符串 parent_id

**文件**: `frontend/src/components/settings/OrganizationTab.vue:298`

**问题**: 新建部门时，`parent_id` 为空字符串 `''` 而非 `undefined`，后端可能无法正确处理。

```javascript
parent_id: departmentForm.parent_id || undefined,
```

此处处理正确，但建议在前端表单初始化时就使用 `null` 或 `undefined`。

### 8. 前端未显示职位成员信息

**文件**: `frontend/src/components/settings/OrganizationTab.vue`

**问题**: 后端 `getDepartmentPositions` 返回了职位成员信息（`members` 字段），但前端未展示。建议按照 PR 设计文档展示每个职位下的成员列表。

---

## ✅ 代码亮点

1. **权限控制完善**: 所有写操作都检查了 `admin` 权限
2. **删除保护机制**: 删除前检查子部门、职位、成员，符合设计文档
3. **外键约束正确**: 使用 `ON DELETE RESTRICT` 和 `ON DELETE SET NULL` 合理控制删除行为
4. **模型关联正确**: `models/index.js` 中正确设置了 Department/Position/User 的关联关系
5. **API 设计规范**: RESTful 风格，路由命名清晰
6. **国际化支持完整**: 中英文翻译齐全

---

## 🔧 修复优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | 路由顺序冲突 | 必须修复，否则无法使用 |
| P1 | 部门名称重复检查 | 建议修复，避免数据混乱 |
| P1 | 更新操作空值过滤 | 建议修复，避免意外覆盖 |
| P2 | 其他问题 | 可在后续迭代优化 |

---

## 审计结论

整体代码质量良好，架构设计合理。**必须修复路由顺序冲突问题后方可合并**。其他问题建议在后续迭代中优化。

✌Bazinga！