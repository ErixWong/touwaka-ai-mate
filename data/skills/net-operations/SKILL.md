---
name: net-operations
description: "网络操作工具。用于 DNS 查询、SSL 证书分析、HTTP 头分析、端口扫描和 HTTP 请求。当用户需要诊断网络问题或发起 HTTP 请求时触发。"
argument-hint: "[check|scan|request] [host]"
user-invocable: true
---

# Net Operations - 网络操作

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `net_check` | 统一检查工具 | `type`: dns/ssl/http |
| `port_scan` | 端口扫描 | `port` 单端口 / `ports` 多端口 |
| `http_request` | HTTP 请求 | `url`, `method`, `body` |

## net_check

统一检查工具，支持 DNS、SSL、HTTP 三种检查类型。

**参数：**
- `type`: 检查类型 - `"dns"` (默认), `"ssl"`, `"http"`
- `timeout`: 超时时间（毫秒），默认 5000

**DNS 检查：**
- `hostname`: 主机名（必需）
- `record_type`: 记录类型 - `"A"`, `"AAAA"`, `"MX"`, `"TXT"`, `"CNAME"`, `"NS"`

**SSL 检查：**
- `hostname`: 主机名（必需）
- `port`: 端口号，默认 443

**HTTP 检查：**
- `url`: URL 地址（必需）

```javascript
// DNS 查询
net_check({ hostname: "example.com" })
net_check({ hostname: "gmail.com", record_type: "MX" })

// SSL 证书分析
net_check({ hostname: "example.com", type: "ssl" })

// HTTP 头分析（安全性和性能）
net_check({ url: "https://example.com", type: "http" })
```

## port_scan

端口扫描工具，支持单端口和多端口模式。

**单端口模式：**
- `host`: 主机名或 IP（必需）
- `port`: 端口号（必需）
- `timeout`: 超时时间（毫秒），默认 5000

**多端口模式：**
- `host`: 主机名或 IP（必需）
- `ports`: 端口组名或端口数组，默认 `"common"`
  - `"common"`: 常用端口 (21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443)
  - `"web"`: Web 端口 (80, 443, 8080, 8443)
  - `"mail"`: 邮件端口 (25, 110, 143, 465, 587, 993, 995)
  - `"db"`: 数据库端口 (1433, 1521, 3306, 5432, 6379, 27017)
  - 数组: 自定义端口列表，如 `[80, 443, 8080]`

```javascript
// 单端口检查
port_scan({ host: "example.com", port: 22 })

// 多端口扫描
port_scan({ host: "example.com" })                    // 默认 common
port_scan({ host: "example.com", ports: "web" })      // Web 端口
port_scan({ host: "example.com", ports: [80, 443] })  // 自定义端口
```

## http_request

发起 HTTP/HTTPS 请求。

**参数：**
- `url`: 请求 URL（必需）
- `method`: HTTP 方法，默认 `"GET"`
- `headers`: 请求头对象
- `body`: 请求体（字符串或对象）
- `timeout`: 超时时间（毫秒），默认 10000
- `follow_redirects`: 是否跟随重定向，默认 true

```javascript
// GET 请求
http_request({ url: "https://api.example.com/data" })

// POST 请求
http_request({
  url: "https://api.example.com/create",
  method: "POST",
  body: { name: "Test" }
})

// 带请求头
http_request({
  url: "https://api.example.com/protected",
  headers: { "Authorization": "Bearer token" }
})
```

## 常见用例

**网络诊断：**
1. DNS: `net_check` → 2. 连通性: `port_scan` → 3. SSL: `net_check` → 4. HTTP: `http_request`

**安全审计：**
- HTTP 头: `net_check({ url: "...", type: "http" })`
- SSL 证书: `net_check({ hostname: "...", type: "ssl" })`
- 开放端口: `port_scan({ host: "..." })`

**服务器健康检查：**
- Web 端口: `port_scan({ host: "...", ports: "web" })`
- 数据库: `port_scan({ host: "...", port: 3306 })`
- SSH: `port_scan({ host: "...", port: 22 })`

## 限制

- HTTP 响应最大: 1MB
- 端口扫描最大: 20 个端口
- 所有工具返回 `{ success, ... }` 或 `{ success: false, error }`