---
name: net-operations
description: Network utilities including DNS lookup, SSL analysis, HTTP headers analysis, connectivity testing, port scanning, and HTTP requests. Use when you need to diagnose network issues or make HTTP requests.
argument-hint: "[check|connect|scan|request] [host]"
user-invocable: true
---

# Network Operations

Network utilities for DNS lookup, SSL analysis, HTTP headers analysis, connectivity testing, port scanning, and HTTP requests.

## Tools

### check

Unified check tool for DNS, SSL, and HTTP analysis. Use `type` parameter to specify check type.

**Parameters:**
- `type` (string, optional): Check type - `"dns"` (default), `"ssl"`, or `"http"`
- `timeout` (number, optional): Timeout in ms (default: 5000)

**DNS Check (type="dns"):**
- `hostname` (string, required): Hostname to check
- `record_type` (string, optional): DNS record type - `"A"` (default), `"AAAA"`, `"MX"`, `"TXT"`, `"CNAME"`, `"NS"`

**SSL Check (type="ssl"):**
- `hostname` (string, required): Hostname to check
- `port` (number, optional): Port for SSL check (default: 443)

**HTTP Check (type="http"):**
- `url` (string, required): URL to analyze

**Examples:**
```javascript
// DNS lookup - A records (IPv4)
{ "tool": "check", "params": { "hostname": "example.com" } }

// DNS lookup - MX records (mail servers)
{ "tool": "check", "params": { "hostname": "gmail.com", "type": "dns", "record_type": "MX" } }

// SSL certificate analysis
{ "tool": "check", "params": { "hostname": "example.com", "type": "ssl" } }

// HTTP headers analysis (security & performance)
{ "tool": "check", "params": { "url": "https://example.com", "type": "http" } }
```

**DNS Response:**
```json
{
  "success": true,
  "hostname": "example.com",
  "recordType": "A",
  "records": ["93.184.216.34"],
  "count": 1
}
```

**SSL Response:**
```json
{
  "success": true,
  "hostname": "example.com",
  "port": 443,
  "ssl": {
    "valid": true,
    "subject": { "CN": "example.com" },
    "issuer": { "CN": "Let's Encrypt" },
    "validFrom": "Jan 1 00:00:00 2024 GMT",
    "validTo": "Apr 1 00:00:00 2024 GMT",
    "daysUntilExpiry": 30,
    "isExpired": false,
    "fingerprint": "..."
  }
}
```

**HTTP Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "hostname": "example.com",
  "statusCode": 200,
  "security": {
    "hsts": true,
    "noSniff": true,
    "frameGuard": "DENY",
    "csp": true
  },
  "performance": {
    "cacheControl": "max-age=31536000",
    "compression": "gzip"
  },
  "recommendations": []
}
```

### connect

TCP connectivity testing - test if a host and port is reachable.

**Parameters:**
- `host` (string, required): Hostname or IP address
- `port` (number, optional): Port number (default: 80)
- `timeout` (number, optional): Timeout in ms (default: 5000)

**Examples:**
```javascript
// Test web server connectivity
{ "tool": "connect", "params": { "host": "example.com", "port": 80 } }

// Test SSH port
{ "tool": "connect", "params": { "host": "server.example.com", "port": 22 } }

// Test database port
{ "tool": "connect", "params": { "host": "db.example.com", "port": 3306 } }
```

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 80,
  "status": "open",
  "responseTime": 15,
  "message": "Port 80 is open on example.com (15ms)"
}
```

### port_scan

Scan multiple ports on a host.

**Parameters:**
- `host` (string, required): Hostname or IP address
- `ports` (string|number|array, optional): Port configuration (default: "common")
  - `"common"` - Common ports (21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443)
  - `"web"` - Web ports (80, 443, 8080, 8443)
  - `"mail"` - Mail ports (25, 110, 143, 465, 587, 993, 995)
  - `"db"` - Database ports (1433, 1521, 3306, 5432, 6379, 27017)
  - Single port number
  - Array of port numbers
- `timeout` (number, optional): Timeout per port in ms (default: 3000)

**Examples:**
```javascript
// Scan common ports
{ "tool": "port_scan", "params": { "host": "example.com" } }

// Scan web ports
{ "tool": "port_scan", "params": { "host": "example.com", "ports": "web" } }

// Scan specific ports
{ "tool": "port_scan", "params": { "host": "example.com", "ports": [80, 443, 8080] } }
```

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "scan": {
    "total": 20,
    "open": [22, 80, 443],
    "closed": [21, 23, 25, ...],
    "filtered": [],
    "results": [
      { "port": 22, "status": "open" },
      { "port": 80, "status": "open" },
      ...
    ]
  }
}
```

### http_request

Make HTTP/HTTPS requests.

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
{ "tool": "http_request", "params": { "url": "https://api.example.com/data" } }

// POST with JSON body
{
  "tool": "http_request",
  "params": {
    "url": "https://api.example.com/create",
    "method": "POST",
    "body": { "name": "Test", "value": 123 }
  }
}

// With custom headers
{
  "tool": "http_request",
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
{ "tool": "check", "params": { "hostname": "example.com" } }

// 2. Test connectivity
{ "tool": "connect", "params": { "host": "example.com", "port": 443 } }

// 3. Check SSL certificate
{ "tool": "check", "params": { "hostname": "example.com", "type": "ssl" } }

// 4. Test HTTP endpoint
{ "tool": "http_request", "params": { "url": "https://example.com" } }
```

### Security Audit

```javascript
// Check HTTP security headers
{ "tool": "check", "params": { "url": "https://example.com", "type": "http" } }

// Check SSL certificate
{ "tool": "check", "params": { "hostname": "example.com", "type": "ssl" } }

// Scan common ports
{ "tool": "port_scan", "params": { "host": "example.com" } }
```

### Check Server Health

```javascript
// Check web server ports
{ "tool": "port_scan", "params": { "host": "myserver.com", "ports": "web" } }

// Check database server
{ "tool": "connect", "params": { "host": "db.myserver.com", "port": 3306 } }

// Check SSH access
{ "tool": "connect", "params": { "host": "myserver.com", "port": 22 } }
```

## Security

- Maximum HTTP response size is limited (1MB)
- Port scan is limited to 20 ports per request
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

1. **Start with DNS** - If a host is unreachable, check DNS first with `check`
2. **Use `check` for all checks** - DNS, SSL, and HTTP analysis in one unified tool
3. **Use appropriate timeouts** - Increase timeout for slow networks
4. **Check common ports** - Use `port_scan` with port groups for quick assessment
5. **Handle errors gracefully** - Network operations can fail for many reasons