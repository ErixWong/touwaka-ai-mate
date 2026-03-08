## ✅ 代码审计修复完成

所有高优先级和中优先级问题已修复并推送。

### 修复内容

#### 1. [高] `_setArticleTags` 添加事务包裹
- ✅ 使用 `db.sequelize.transaction()` 包裹整个标签设置流程
- ✅ 批量创建新标签：`bulkCreate()` 替代循环 `create()`
- ✅ 批量创建关联：`bulkCreate()` 替代循环 `create()`
- ✅ 批量更新计数：使用子查询替代循环 `count() + update()`
- ✅ 错误时自动回滚事务

#### 2. [中] 优化 N+1 查询（标签计数批量更新）
- ✅ `deleteArticle()` 中：先获取所有标签ID，使用 `update()` + `Sequelize.literal()` 批量递减计数
- ✅ `_setArticleTags()` 中：使用子查询批量更新计数

#### 3. [中] 添加章节层级深度限制
- ✅ 新增常量 `MAX_SECTION_DEPTH = 10`
- ✅ `createSection()` 中检查父级层级，超过限制返回 400 错误

#### 4. [低] 外键约束错误友好提示
- ✅ `deleteSection()`：捕获 `ForeignKeyConstraintError`，返回 409 状态码 + 友好提示
- ✅ `deleteParagraph()`：同上
- ✅ `deleteTag()`：同上

### 提交信息
```
[T34] fix: 修复代码审计发现的问题
- _setArticleTags 添加事务包裹，使用 bulkCreate 批量操作
- 优化 N+1 查询：批量更新标签计数
- 添加章节层级深度限制（MAX_SECTION_DEPTH=10）
- 添加外键约束错误友好提示（409 状态码）
```

请审查修复后的代码，如有其他问题请继续反馈！
