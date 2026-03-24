---
name: net-operations
description: Network utilities for DNS lookup, SSL analysis, HTTP headers analysis, port scanning, and HTTP requests.
argument-hint: "[check|scan|request] [host]"
user-invocable: true
---

# Network Operations

## Tools

### net_check

Unified check tool for DNS, SSL, and HTTP analysis.

**Parameters:**
- `type` (string): Check type - `"dns"` (default), `"ssl"`, `"http"`
- `timeout` (number): Timeout in ms (default: 5000)

**DNS Check:** `hostname` (required), `record_type` - `"A"`, `"AAAA"`, `"MX"`, `"TXT"`, `"CNAME"`, `"NS"`
**SSL Check:** `hostname` (required), `port` (default: 443)
**HTTP Check:** `url` (required)

```javascript
// DNS lookup
{ "tool": "net_check", "params": { "hostname": "example.com" } }
{ "tool": "net_check", "params": { "hostname": "gmail.com", "record_type": "MX" } }

// SSL certificate
{ "tool": "net_check", "params": { "hostname": "example.com", "type": "ssl" } }

// HTTP headers (security & performance)
{ "tool": "net_check", "params": { "url": "https://example.com", "type": "http" } }
```

### port_scan

Scan port(s) on a host. Single port returns detailed result, multi-port returns summary.

**Single Port:** `host`, `port`, `timeout` (default: 5000)
**Multi-Port:** `host`, `ports` - `"common"`, `"web"`, `"mail"`, `"db"`, or array

```javascript
// Single port check
{ "tool": "port_scan", "params": { "host": "example.com", "port": 22 } }

// Multi-port scan
{ "tool": "port_scan", "params": { "host": "example.com" } }
{ "tool": "port_scan", "params": { "host": "example.com", "ports": "web" } }
{ "tool": "port_scan", "params": { "host": "example.com", "ports": [80, 443, 8080] } }
```

**Port Groups:**
- `common` (default): 21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443
- `web`: 80, 443, 8080, 8443
- `mail`: 25, 110, 143, 465, 587, 993, 995
- `db`: 1433, 1521, 3306, 5432, 6379, 27017

### http_request

Make HTTP/HTTPS requests.

**Parameters:** `url` (required), `method`, `headers`, `body`, `timeout` (default: 10000), `follow_redirects` (default: true)

```javascript
// GET request
{ "tool": "http_request", "params": { "url": "https://api.example.com/data" } }

// POST with body
{ "tool": "http_request", "params": { "url": "https://api.example.com/create", "method": "POST", "body": { "name": "Test" } } }

// With headers
{ "tool": "http_request", "params": { "url": "https://api.example.com/protected", "headers": { "Authorization": "Bearer token" } } }
```

## Common Use Cases

**Diagnose Network Issues:**
1. DNS: `net_check` → 2. Connectivity: `port_scan` → 3. SSL: `net_check` → 4. HTTP: `http_request`

**Security Audit:**
- HTTP headers: `net_check` with `type="http"`
- SSL certificate: `net_check` with `type="ssl"`
- Open ports: `port_scan`

**Server Health:**
- Web ports: `port_scan` with `ports="web"`
- Database: `port_scan` with `port=3306`
- SSH: `port_scan` with `port=22`

## Notes

- Max HTTP response: 1MB
- Max ports per scan: 20
- All tools return `{ success, ... }` or `{ success: false, error }`