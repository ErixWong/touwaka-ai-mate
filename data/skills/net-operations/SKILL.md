---
name: net-operations
description: Network utilities including DNS lookup, ping, port check, and HTTP requests. Use when you need to diagnose network issues or make HTTP requests.
argument-hint: "[dns|ping|port|request] [host]"
user-invocable: true
---

# Network Operations

Network utilities for DNS lookup, connectivity testing, port checking, and HTTP requests.

## Tools

### net_dns

DNS lookup - resolve hostname to IP addresses.

**Parameters:**
- `hostname` (string, required): Hostname to resolve
- `record_type` (string, optional): DNS record type - `"A"` (default), `"AAAA"`, `"MX"`, `"TXT"`, `"CNAME"`, `"NS"`
- `timeout` (number, optional): Timeout in ms (default: 5000)

**Examples:**
```javascript
// Resolve A records (IPv4)
{ "tool": "net_dns", "params": { "hostname": "example.com" } }

// Resolve MX records (mail servers)
{ "tool": "net_dns", "params": { "hostname": "gmail.com", "record_type": "MX" } }

// Resolve TXT records
{ "tool": "net_dns", "params": { "hostname": "example.com", "record_type": "TXT" } }
```

**Response:**
```json
{
  "success": true,
  "hostname": "example.com",
  "recordType": "A",
  "records": ["93.184.216.34"],
  "count": 1
}
```

### net_ping

Ping - test connectivity to a host.

**Parameters:**
- `host` (string, required): Hostname or IP address
- `count` (number, optional): Number of pings (default: 3, max: 5)
- `timeout` (number, optional): Timeout in ms (default: 5000)

**Examples:**
```javascript
// Simple ping
{ "tool": "net_ping", "params": { "host": "google.com" } }

// Multiple pings
{ "tool": "net_ping", "params": { "host": "8.8.8.8", "count": 5 } }
```

**Response:**
```json
{
  "success": true,
  "host": "google.com",
  "count": 3,
  "avgTime": 15,
  "minTime": 10,
  "maxTime": 20,
  "packetLoss": 0
}
```

### net_port

Port check - test if a port is open.

**Parameters:**
- `host` (string, required): Hostname or IP address
- `port` (number, required): Port number (1-65535)
- `timeout` (number, optional): Timeout in ms (default: 3000)

**Examples:**
```javascript
// Check if web server is running
{ "tool": "net_port", "params": { "host": "example.com", "port": 80 } }

// Check SSH port
{ "tool": "net_port", "params": { "host": "server.example.com", "port": 22 } }

// Check database port
{ "tool": "net_port", "params": { "host": "db.example.com", "port": 3306 } }
```

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 80,
  "status": "open",
  "message": "Port 80 is open on example.com"
}
```

### net_request

HTTP request - make HTTP/HTTPS requests.

**Parameters:**
- `url` (string, required): Request URL
- `method` (string, optional): HTTP method - `"GET"` (default), `"POST"`, `"PUT"`, `"DELETE"`, `"PATCH"`
- `headers` (object, optional): Request headers
- `body` (string|object, optional): Request body (for POST/PUT/PATCH)
- `timeout` (number, optional): Timeout in ms (default: 10000)
- `follow_redirects` (boolean, optional): Follow redirects (default: true)

**Examples:**
```javascript
// Simple GET request
{ "tool": "net_request", "params": { "url": "https://api.example.com/data" } }

// POST with JSON body
{
  "tool": "net_request",
  "params": {
    "url": "https://api.example.com/create",
    "method": "POST",
    "body": { "name": "Test", "value": 123 }
  }
}

// With custom headers
{
  "tool": "net_request",
  "params": {
    "url": "https://api.example.com/protected",
    "headers": { "Authorization": "Bearer token123" }
  }
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "statusMessage": "OK",
  "headers": { ... },
  "body": { ... },
  "size": 1234
}
```

## Common Use Cases

### Diagnose Network Issues

```javascript
// 1. Check DNS resolution
{ "tool": "net_dns", "params": { "hostname": "example.com" } }

// 2. Test connectivity
{ "tool": "net_ping", "params": { "host": "example.com" } }

// 3. Check if port is open
{ "tool": "net_port", "params": { "host": "example.com", "port": 443 } }

// 4. Test HTTP endpoint
{ "tool": "net_request", "params": { "url": "https://example.com" } }
```

### Check Server Health

```javascript
// Check web server
{ "tool": "net_port", "params": { "host": "myserver.com", "port": 80 } }
{ "tool": "net_port", "params": { "host": "myserver.com", "port": 443 } }

// Check database server
{ "tool": "net_port", "params": { "host": "db.myserver.com", "port": 3306 } }

// Check SSH access
{ "tool": "net_port", "params": { "host": "myserver.com", "port": 22 } }
```

## Security

- Maximum HTTP response size is limited (1MB)
- Ping count is limited to 5 to prevent abuse
- All operations have configurable timeouts
- HTTPS is recommended for sensitive requests

## Error Handling

All tools return a consistent error format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

## Best Practices for LLM

1. **Start with DNS** - If a host is unreachable, check DNS first
2. **Use appropriate timeouts** - Increase timeout for slow networks
3. **Check common ports** - 80/443 for web, 22 for SSH, 3306 for MySQL
4. **Handle errors gracefully** - Network operations can fail for many reasons