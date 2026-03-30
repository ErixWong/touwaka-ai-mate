## 变更摘要

为 kb-editor 技能的子资源操作添加完整的权限校验，修复安全漏洞。

## 问题背景

Issue #426 实现了知识库权限控制，但遗漏了子资源（文章/节/段落/标签）的权限校验。任何登录用户只要知道 `kb_id`，就可以操作该知识库中的子资源，即使该用户没有编辑权限。

## 修复内容

在所有子资源的写操作中添加 `canEditKb()` 权限校验：

| 资源 | 修复的方法 |
|------|-----------|
| 文章 | `createArticle`, `updateArticle`, `deleteArticle` |
| 节 | `createSection`, `updateSection`, `moveSection`, `deleteSection` |
| 段落 | `createParagraph`, `updateParagraph`, `moveParagraph`, `deleteParagraph` |
| 标签 | `createTag`, `updateTag`, `deleteTag` |

## 权限校验逻辑

```javascript
// 示例：createArticle 方法
async createArticle(ctx) {
  const { kb_id } = ctx.params;
  const userId = ctx.state.session.id;

  // 权限检查：只有 owner 或 admin 可以编辑
  const canEdit = await canEditKb(this.db, kb_id, userId);
  if (!canEdit) {
    ctx.throw(403, '无权编辑此知识库');
  }

  // 执行业务逻辑...
}
```

## 涉及文件

- `data/skills/kb-editor/index.js` - 添加权限校验逻辑

## 安全提升

- ✅ 防止未授权用户操作他人知识库的子资源
- ✅ 与知识库级别的权限控制保持一致
- ✅ 符合最小权限原则

Closes #431