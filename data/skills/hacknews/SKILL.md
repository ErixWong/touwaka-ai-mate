---
name: hackernews-node
description: Browse and search Hacker News with AI domain filtering. Windows-compatible Node.js implementation with bilingual output support.
metadata:
  openclaw:
    emoji: 🚀
---

# Hacker News Node

Windows-compatible Hacker News browser with AI domain filtering and JSON output.

## Quick Start

```bash
# Top stories
node scripts/hn.js top

# AI domain stories
node scripts/hn.js ai

# Search
node scripts/hn.js search "LLM"
```

## Commands

| Command | Description | Options |
|---------|-------------|---------|
| `top` | Top stories | `--limit`, `--json` |
| `new` | Newest stories | `--limit`, `--json` |
| `best` | Best stories | `--limit`, `--json` |
| `ask` | Ask HN | `--limit`, `--json` |
| `show` | Show HN | `--limit`, `--json` |
| `jobs` | Job postings | `--limit`, `--json` |
| `ai` | AI domain filter | `--limit`, `--period`, `--json` |
| `search` | Search stories | `--limit`, `--sort`, `--json` |

## Examples

```bash
# Top 10 AI stories from last 24 hours
node scripts/hn.js ai --limit 10 --period day

# Search with JSON output
node scripts/hn.js search "machine learning" --limit 5 --json

# Get best stories
node scripts/hn.js best --limit 20 --json
```

## Output Format

### JSON Mode (`--json`)
```json
{
  "command": "ai",
  "query": "AI OR artificial intelligence OR LLM",
  "count": 10,
  "stories": [
    {
      "id": 43050023,
      "title": "OpenAI releases GPT-5",
      "url": "https://openai.com/...",
      "points": 523,
      "author": "sama",
      "time": "2026-02-06T08:30:00Z",
      "comments": 156
    }
  ]
}
```

## API Reference

- HN Official API: https://github.com/HackerNews/API
- Algolia Search: https://hn.algolia.com/api
