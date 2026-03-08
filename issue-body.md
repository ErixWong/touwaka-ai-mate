# 知识库 API 路由缺失

## 问题描述

前端调用 `GET /api/kb?page=1&pageSize=12` 获取知识库列表时返回 404 错误：

```json
{"code":404,"message":"接口不存在","data":null,"timestamp":1772949936442}
```

## 根因分析

`server/routes/kb.routes.js` 只定义了 `/:kb_id/...` 格式的子资源路由，缺少知识库本身的 CRUD 路由。

**原有路由结构：**
- `/api/kb/:kb_id/articles` - 文章列表
- `/api/kb/:kb_id/sections` - 节列表
- `/api/kb/:kb_id/paragraphs` - 段落列表
- `/api/kb/:kb_id/tags` - 标签列表

**缺失路由：**
- `GET /api/kb` - 知识库列表
- `POST /api/kb` - 创建知识库
- `GET /api/kb/:kb_id` - 知识库详情
- `PUT /api/kb/:kb_id` - 更新知识库
- `DELETE /api/kb/:kb_id` - 删除知识库

## 修复方案

### 1. 添加路由 (`server/routes/kb.routes.js`)

```javascript
// ==================== 知识库路由 ====================

// 获取知识库列表
router.get('/', authenticate(), controller.listKnowledgeBases.bind(controller));

// 创建知识库
router.post('/', authenticate(), controller.createKnowledgeBase.bind(controller));

// 获取知识库详情
router.get('/:kb_id', authenticate(), controller.getKnowledgeBase.bind(controller));

// 更新知识库
router.put('/:kb_id', authenticate(), controller.updateKnowledgeBase.bind(controller));

// 删除知识库
router.delete('/:kb_id', authenticate(), controller.deleteKnowledgeBase.bind(controller));
```

### 2. 添加控制器方法 (`server/controllers/kb.controller.js`)

- `listKnowledgeBases()` - 分页查询知识库列表，包含文章数统计
- `createKnowledgeBase()` - 创建知识库
- `getKnowledgeBase()` - 获取知识库详情
- `updateKnowledgeBase()` - 更新知识库
- `deleteKnowledgeBase()` - 删除知识库（级联删除文章、节、段落、标签）

### 3. 模型名称修正

模型名称为 `knowledge_basis`（auto-generated），而非 `knowledge_base`：

```javascript
this.KnowledgeBase = this.db.getModel('knowledge_basis');
```

## 影响范围

- 知识库管理页面 (`KnowledgeBaseView.vue`)
- 知识库详情页面 (`KnowledgeDetailView.vue`)

## 关联 Issue

- #43 前端 TypeScript 类型错误修复记录

## 测试验证

重启服务器后，访问 `GET /api/kb?page=1&pageSize=12` 应返回知识库列表。