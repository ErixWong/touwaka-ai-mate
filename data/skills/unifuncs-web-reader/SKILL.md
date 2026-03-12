---
name: unifuncs-web-reader
description: 网页内容提取服务，通过 Unifuncs API 获取网页正文内容。支持微信公众号、知乎、头条等主流平台。
argument-hint: "[url]"
user-invocable: true
allowed-tools: []
env-variables:
  - name: UNIFUNCS_API_KEY
    description: Unifuncs API 密钥
    required: true
---

# Unifuncs Web Reader

网页内容提取服务，通过 Unifuncs API 获取网页正文内容。

## 功能特点

- 支持微信公众号文章
- 支持知乎专栏/问答
- 支持今日头条
- 支持其他主流网站
- 自动提取正文内容
- 返回结构化数据

## 配置要求

此技能需要以下环境变量（由系统从 `skill_parameters` 表自动注入）：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `UNIFUNCS_API_KEY` | Unifuncs API 密钥 | ✅ |

## 工具清单

### read_web_page

读取网页内容并提取正文。

**参数：**
- `url` (string, required): 要读取的网页 URL
- `timeout` (number, optional): 超时时间（毫秒），默认 30000

**调用方式：**
```
GET https://api.unifuncs.com/api/web-reader/{path}?apiKey=API_KEY
```

**注意：** path 需要进行 URL 编码

**示例：**
```javascript
// 读取微信公众号文章
{
  "url": "https://mp.weixin.qq.com/s/wmoNh44A4ofkawPNVx_g6A"
}

// 实际请求 URL
// https://api.unifuncs.com/api/web-reader/https%3A%2F%2Fmp.weixin.qq.com%2Fs%2FwmoNh44A4ofkawPNVx_g6A?apiKey=API_KEY
```

**返回示例：**
```json
{
  "success": true,
  "statusCode": 200,
  "statusMessage": "OK",
  "headers": {
    "content-type": "text/markdown; charset=utf-8",
    "x-unifuncs-status": "0"
  },
  "body": "Title: 文章标题\n\nURL Source: https://example.com\n\nMarkdown Content:\n\n正文内容...",
  "size": 12345,
  "originalUrl": "https://example.com"
}
```

**说明：** `body` 字段返回 Markdown 格式的文本内容，包含标题、来源 URL 和正文。

## 错误处理

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | URL 格式错误 |
| 401 | API Key 无效或缺失 |
| 403 | 无权限访问 |
| 404 | 网页不存在 |
| 429 | 请求频率超限 |
| 500 | 服务器错误 |

## 安全说明

- API Key 从环境变量获取，不在代码中硬编码
- 使用 HTTPS 加密传输
- 最大响应大小限制为 5MB
- 默认超时 30 秒

## 使用场景

1. **内容分析**：提取网页正文用于 AI 分析
2. **信息收集**：批量获取特定平台的内容
3. **内容存档**：保存网页内容到本地

## 注意事项

- 请遵守目标网站的使用条款
- 不要频繁请求同一网站
- 部分网站可能有反爬机制