# 知识库章节段落过滤失效

## 问题描述
在知识库详情页中，点击章节结构中的任意节点，右侧显示的段落列表都是一样的（显示所有段落），而不是只显示属于该章节的段落。

## 复现步骤
1. 进入知识库详情页
2. 选择一篇文章
3. 点击章节结构中的不同章节节点
4. 观察右侧段落列表

## 预期行为
点击不同章节时，右侧应该只显示属于该章节的段落。

## 实际行为
无论点击哪个章节，都显示所有段落（7个）。

## 问题原因

### 前端问题
前端 API 调用发送的数据格式与后端期望的格式不匹配：
- 前端发送：`{ section_id: "xxx", pagination: {...} }`
- 后端期望：`{ filter: { section_id: "xxx" }, pagination: {...} }`

### 后端问题
后端代码在验证 `section_id` 时，错误地使用了 `queryOptions.where.section_id`，但 `buildQueryOptions` 已经将 `section_id` 转换为了 Sequelize 条件对象 `{ [Op.eq]: "xxx" }`，导致 `findByPk` 接收到一个对象而不是字符串。

## 修复方案

### 1. 前端修复 (`frontend/src/api/services.ts`)
```typescript
queryParagraphs: (kbId: string, data: { section_id?: string; pagination?: PaginationParams }) =>
  apiRequest<PaginatedResponse<KbParagraph>>(apiClient.post(`/kb/${kbId}/paragraphs/query`, {
    filter: data.section_id ? { section_id: data.section_id } : undefined,
    pagination: data.pagination,
  })),
```

### 2. 后端修复 (`server/controllers/kb.controller.js`)
```javascript
// 从原始请求中获取 section_id 值，而不是从 queryOptions.where
const sectionId = queryRequest.filter?.section_id;
if (sectionId) {
  const section = await this.KbSection.findByPk(sectionId, {
    include: [{ model: this.KbArticle, as: 'article' }],
  });
  if (!section || section.article.kb_id !== kb_id) {
    ctx.throw(400, 'Invalid section_id');
  }
}
```

## 相关文件
- `frontend/src/api/services.ts`
- `server/controllers/kb.controller.js`

## 修复验证
修复后，点击不同章节时返回的段落数量不同：
- 章节 A: 3 paragraphs
- 章节 B: 0 paragraphs  
- 章节 C: 1 paragraphs

说明章节过滤功能已正常工作。
