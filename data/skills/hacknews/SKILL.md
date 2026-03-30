---
name: hackernews-node
description: Browse and search Hacker News with AI domain filtering. Windows-compatible Node.js implementation with bilingual output support.
metadata:
  openclaw:
    emoji: 🚀
---

# Hacker News Node

Windows-compatible Hacker News browser with AI domain filtering and JSON output.

## Tools

### `stories`

获取 Hacker News 故事，支持多种类型和搜索。

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Story type: `top`, `new`, `best`, `ask`, `show`, `jobs`, `ai`, `search` |
| `limit` | number | No | Number of stories to return (default: 10) |
| `period` | string | No | Time filter for AI type: `day`, `week`, `month`, `all` (default: `all`) |
| `query` | string | No | Search query (required when type is `search`) |
| `json` | boolean | No | Return JSON format instead of text (default: false) |

**Story Types:**

| Type | Description |
|------|-------------|
| `top` | Top stories |
| `new` | Newest stories |
| `best` | Best stories |
| `ask` | Ask HN posts |
| `show` | Show HN posts |
| `jobs` | Job postings |
| `ai` | AI domain stories with time filter |
| `search` | Search stories by query |

## Examples

```javascript
// Get top stories
{ "type": "top", "limit": 10 }

// Get new stories in JSON format
{ "type": "new", "limit": 20, "json": true }

// Get AI stories from last 24 hours
{ "type": "ai", "limit": 10, "period": "day" }

// Search for machine learning stories
{ "type": "search", "query": "machine learning", "limit": 5 }

// Get best stories
{ "type": "best", "limit": 15 }
```

## Output Format

### Text Mode (default)
```
🔥 Top Stories
==================================================

1. Story Title
   https://example.com/story
   👍 523 | 💬 156 | @author
```

### JSON Mode (`json: true`)
```json
{
  "count": 10,
  "stories": [
    {
      "id": 43050023,
      "title": "Story Title",
      "url": "https://example.com/story",
      "points": 523,
      "author": "author",
      "comments": 156
    }
  ]
}
```

## API Reference

- HN Official API: https://github.com/HackerNews/API
- Algolia Search: https://hn.algolia.com/api
