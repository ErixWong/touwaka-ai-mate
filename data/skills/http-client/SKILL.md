---
name: http-client
description: HTTP client for making GET and POST requests. Use when you need to fetch web content or call APIs.
argument-hint: "[get|post] [url]"
user-invocable: true
allowed-tools:
  - Bash(curl *)
---

# HTTP Client

Make HTTP requests to fetch web content or call APIs.

## Tools

### http_get

Send an HTTP GET request.

**Parameters:**
- `url` (string, required): Request URL
- `headers` (object, optional): Custom headers
- `timeout` (number, optional): Timeout in ms (default: 10000)

**Examples:**
```javascript
// Simple GET request
{ "url": "https://api.example.com/data" }

// With custom headers
{
  "url": "https://api.example.com/data",
  "headers": {
    "Authorization": "Bearer token123",
    "Accept": "application/json"
  }
}
```

### http_post

Send an HTTP POST request.

**Parameters:**
- `url` (string, required): Request URL
- `body` (object|string, optional): Request body
- `headers` (object, optional): Custom headers
- `timeout` (number, optional): Timeout in ms (default: 10000)

**Examples:**
```javascript
// POST JSON data
{
  "url": "https://api.example.com/create",
  "body": {
    "name": "Test",
    "value": 123
  }
}

// POST with custom headers
{
  "url": "https://api.example.com/create",
  "body": "raw data",
  "headers": {
    "Content-Type": "text/plain"
  }
}
```

## Response Format

```json
{
  "success": true,
  "statusCode": 200,
  "headers": { ... },
  "body": "..."
}
```

## Security

- Maximum response size is limited (default: 1MB)
- Response body is truncated if too large
- HTTPS is recommended for sensitive data