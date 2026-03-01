---
name: searxng
description: Search the web using SearXNG. Use when you need current information, news, or web search. Triggers on "search", "look up", "find online", "web search".
argument-hint: "[query]"
user-invocable: true
allowed-tools:
  - Bash(curl *)
---

# SearXNG Search

Search the web using your local SearXNG instance - a privacy-respecting metasearch engine.

## Quick Start

```javascript
// Basic search
{ "query": "machine learning basics" }

// Search with options
{ "query": "breaking news", "category": "news", "time_range": "day", "n": 20 }
```

## Tools

### web_search

Search the web using SearXNG.

**Parameters:**
- `query` (string, required): The search query
- `n` (number, optional): Number of results (default: 10, max: 50)
- `category` (string, optional): "general" | "images" | "videos" | "news" | "map" | "music" | "files" | "it" | "science"
- `language` (string, optional): Language code like "en", "zh", "auto" (default: "auto")
- `time_range` (string, optional): "day" | "week" | "month" | "year"
- `format` (string, optional): "json" (default) or "table" for readable display

**Examples:**
```javascript
// General search
{ "query": "node.js tutorial" }

// Image search
{ "query": "cute cats", "category": "images" }

// Recent news
{ "query": "AI news", "category": "news", "time_range": "day" }

// Get 30 results in table format
{ "query": "climate change", "n": 30, "format": "table" }
```

## Configuration

Set environment variable:
```bash
export SEARXNG_URL=https://your-searxng-instance.com
```

Default: `http://localhost:8080`

## Output

Returns JSON with search results:
```json
{
  "success": true,
  "data": {
    "query": "search term",
    "number_of_results": 1000,
    "results": [
      {
        "title": "Result Title",
        "url": "https://example.com",
        "content": "Snippet...",
        "engines": ["google", "bing"]
      }
    ]
  }
}
```

Use `format: "table"` for human-readable output.
