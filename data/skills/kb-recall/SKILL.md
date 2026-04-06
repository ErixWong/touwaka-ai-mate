---
name: kb-recall
description: "知识库召回技能。用于从知识库召回相关内容，支持图文召回和上下文增强。当专家需要查询知识库内容、回答用户专业问题时触发。"
argument-hint: "[recall|global_recall] --query=xxx"
user-invocable: false
allowed-tools: []
---

# KB Recall - 知识库召回技能

知识库召回技能，用于从知识库召回相关内容，支持图文召回和上下文增强。

## 工具（2个）

| 工具 | 说明 |
|------|------|
| `recall` | 从指定知识库召回相关内容 |
| `global_recall` | 从用户所有可访问的知识库中召回相关内容 |

## recall - 单知识库召回

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `kb_id` | string | ✅ | 知识库 ID |
| `query` | string | ✅ | 搜索查询文本 |
| `top_k` | integer | - | 返回结果数量，默认 5 |
| `threshold` | number | - | 相似度阈值（0-1），默认 0.1 |
| `article_id` | string | - | 限定在特定文章内搜索（可选） |
| `min_tokens` | integer | - | 最小 Token 数量，默认 200 |
| `context_mode` | string | - | 上下文模式：`none`/`auto`/`section`/`article`，默认 `auto` |

### context_mode 模式说明

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `none` | 仅返回匹配段落，不扩展上下文 | 精确问答 |
| `auto` | 自动扩展相邻段落，直到满足 `min_tokens` | 默认模式，平衡精确性和上下文 |
| `section` | 返回匹配段落所在节的全部段落 | 需要完整章节上下文 |
| `article` | 返回匹配段落所在文章的全部段落 | LLM 需要完整文档理解 |

### 示例

```javascript
// 基本召回
{ kb_id: 'kb_001', query: '如何设计 API 接口' }

// 指定返回数量和阈值
{ kb_id: 'kb_001', query: 'Python 异步编程', top_k: 10, threshold: 0.2 }

// 在特定文章内搜索
{ kb_id: 'kb_001', query: '数据库优化', article_id: 'art_001' }

// 获取更多上下文
{ kb_id: 'kb_001', query: '高层次人才落户', min_tokens: 500, context_mode: 'section' }
```

### 返回结果

```json
{
  "items": [
    {
      "score": 0.85,
      "paragraph": {
        "id": "para_123",
        "title": "API 设计原则",
        "content": "![架构图](/attach/t/abc123xyz/img_456)\n\nAPI 设计应遵循 RESTful 规范...",
        "is_knowledge_point": true,
        "token_count": 150
      },
      "section": {
        "id": "sec_456",
        "title": "第二章 API 设计",
        "level": 1,
        "path": "第一章 > 1.2 API 设计"
      },
      "article": {
        "id": "art_789",
        "title": "系统设计指南"
      },
      "knowledge_base": {
        "id": "kb_001",
        "name": "技术文档库"
      },
      "context_info": {
        "has_more_before": true,
        "has_more_after": true,
        "total_tokens": 350
      }
    }
  ],
  "total": 5,
  "query": "如何设计 API 接口",
  "token": {
    "url": "/attach/t/abc123xyz",
    "expires_at": "2026-04-05T17:30:00.000Z"
  }
}
```

## global_recall - 全局召回

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | ✅ | 搜索查询文本 |
| `top_k` | integer | - | 返回结果数量，默认 10 |
| `threshold` | number | - | 相似度阈值（0-1），默认 0.1 |
| `kb_ids` | string[] | - | 限定知识库 ID 数组（可选） |
| `min_tokens` | integer | - | 最小 Token 数量，默认 200 |
| `context_mode` | string | - | 上下文模式，默认 `auto` |

### 示例

```javascript
// 搜索所有可访问的知识库
{ query: 'Python 装饰器' }

// 限定在特定知识库中搜索
{ query: '数据库索引', kb_ids: ['kb_001', 'kb_002'] }

// 获取更多结果
{ query: '微服务架构', top_k: 20, min_tokens: 300 }
```

### 返回结果

```json
{
  "items": [
    {
      "score": 0.92,
      "paragraph": { ... },
      "section": { ... },
      "article": { ... },
      "knowledge_base": {
        "id": "kb_002",
        "name": "后端技术"
      }
    }
  ],
  "total": 10,
  "query": "Python 装饰器",
  "tokens": [
    {
      "kb_id": "kb_002",
      "url": "/attach/t/def456abc",
      "expires_at": "2026-04-05T17:30:00.000Z"
    }
  ]
}
```

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |

## 典型工作流程

### 回答用户专业问题

1. `recall` / `global_recall` - 召回相关知识库内容
2. 将召回结果中的 `paragraph.content` 作为上下文提供给 LLM
3. LLM 基于上下文生成回答（图片 URL 已包含 Token，可直接使用）

### 多轮对话中的知识查询

1. 识别用户问题涉及的专业知识
2. `recall` - 从特定知识库召回相关内容
3. 如果结果不足，`global_recall` - 扩大搜索范围
4. 根据 `context_info.has_more_before/after` 决定是否需要更多上下文

## 图片处理说明

召回结果中的图片引用已自动处理：

- 原始 Markdown：`![替代文本](attach:img_123456789)`
- 处理后 Markdown：`![替代文本](/attach/t/abc123def456/img_123456789)`

图片 URL 包含临时 Token，有效期 1 小时，可直接用于 `<img>` 标签。

## 权限说明

只能访问用户有权限的知识库（由 API 层验证）。
