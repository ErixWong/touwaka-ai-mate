# MCP HTTP 支持 - 审计改进修复总结

> **修复日期**: 2026-04-18
> **修复人员**: Maria (AI Assistant)
> **关联审计**: mcp-http-support-code-review.md

---

## 修复内容

### 1. i18n 国际化改进

#### 问题
McpTab.vue 中存在硬编码文本：
- `STDIO` → 未翻译
- `HTTP Stream` → 未翻译  
- `SSE` → 未翻译

#### 修复方案

**添加翻译键（中文）**:
```typescript
// frontend/src/i18n/locales/zh-CN.ts
mcp: {
  // ... 现有翻译
  transportType: '传输类型',
  transportTypeHint: '选择 MCP 服务器的通信方式：STDIO 用于本地进程，HTTP Stream 用于远程服务',
  transportTypes: {
    stdio: 'STDIO (本地进程)',
    http: 'HTTP Stream (远程服务)',
    sse: 'SSE (服务器推送)',
  },
  url: '服务器地址',
  urlPlaceholder: 'https://api.example.com/mcp',
  urlHint: 'HTTP MCP 服务器的 URL 地址',
  headers: '请求头 (JSON格式)',
  headersPlaceholder: '{"Authorization": "Bearer ${user.api_key}"}',
  headersHint: 'HTTP 请求头，JSON 格式。支持 ${user.xxx} 占位符，会被凭证中的对应字段替换',
}
```

**添加翻译键（英文）**:
```typescript
// frontend/src/i18n/locales/en-US.ts
mcp: {
  // ... 现有翻译
  transportType: 'Transport Type',
  transportTypeHint: 'Select MCP server communication method: STDIO for local processes, HTTP Stream for remote services',
  transportTypes: {
    stdio: 'STDIO (Local Process)',
    http: 'HTTP Stream (Remote Service)',
    sse: 'SSE (Server-Sent Events)',
  },
  url: 'Server URL',
  urlPlaceholder: 'https://api.example.com/mcp',
  urlHint: 'HTTP MCP server URL address',
  headers: 'Headers (JSON format)',
  headersPlaceholder: '{"Authorization": "Bearer ${user.api_key}"}',
  headersHint: 'HTTP request headers in JSON format. Supports ${user.xxx} placeholders which will be replaced with corresponding credential fields',
}
```

**更新模板**:
```vue
<!-- frontend/src/components/settings/McpTab.vue -->
<label class="radio-label">
  <input v-model="serverForm.transport_type" type="radio" value="stdio" />
  <span>{{ $t('settings.mcp.transportTypes.stdio') }}</span>
</label>
<label class="radio-label">
  <input v-model="serverForm.transport_type" type="radio" value="http" />
  <span>{{ $t('settings.mcp.transportTypes.http') }}</span>
</label>
<label class="radio-label">
  <input v-model="serverForm.transport_type" type="radio" value="sse" />
  <span>{{ $t('settings.mcp.transportTypes.sse') }}</span>
</label>
```

---

### 2. 日志安全改进

#### 问题
HTTP headers 可能包含敏感信息（Authorization、API Key），直接输出到日志会导致凭证泄露。

#### 修复方案

**添加 headers 脱敏函数**:
```javascript
// data/skills/mcp-client/index.js
async function createTransport(serverConfig, credentials = null) {
  // ...
  if (transportType === 'http' || transportType === 'sse') {
    // 解析 headers 并合并凭证
    const headers = parseHeaders(serverConfig.headers);
    
    // 如果凭证中有 api_key 或 token，添加到 headers
    if (credentials?.api_key) {
      headers['Authorization'] = `Bearer ${credentials.api_key}`;
    } else if (credentials?.token) {
      headers['Authorization'] = `Bearer ${credentials.token}`;
    } else if (credentials?.API_KEY) {
      headers['X-API-Key'] = credentials.API_KEY;
    }
    
    // ✅ 脱敏 headers 用于日志
    const sanitizedHeaders = { ...headers };
    if (sanitizedHeaders.Authorization) {
      sanitizedHeaders.Authorization = 'Bearer ***';
    }
    if (sanitizedHeaders['X-API-Key']) {
      sanitizedHeaders['X-API-Key'] = '***';
    }
    
    log(`Creating HTTP transport for ${serverConfig.name}: ${serverConfig.url}`);
    log(`HTTP headers: ${JSON.stringify(sanitizedHeaders)}`);
    
    return new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
      { headers }
    );
  }
  // ...
}
```

**脱敏规则**:
| Header | 原始值 | 日志显示 |
|--------|--------|----------|
| Authorization | `Bearer sk-abc123` | `Bearer ***` |
| X-API-Key | `sk-abc123` | `***` |

**文档更新**:
```markdown
### HTTP 模式凭证处理

凭证中的以下字段会自动添加到 HTTP headers：
- `api_key` → `Authorization: Bearer {api_key}`
- `token` → `Authorization: Bearer {token}`
- `API_KEY` → `X-API-Key: {API_KEY}`

**安全提示**: 敏感信息（Authorization、X-API-Key）在日志中会被自动脱敏显示为 `***`。
```

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `frontend/src/i18n/locales/zh-CN.ts` | 新增 | 添加中文翻译键 |
| `frontend/src/i18n/locales/en-US.ts` | 新增 | 添加英文翻译键 |
| `frontend/src/components/settings/McpTab.vue` | 修改 | 替换硬编码为翻译键 |
| `data/skills/mcp-client/index.js` | 修改 | 添加 headers 脱敏 |
| `data/skills/mcp-client/SKILL.md` | 修改 | 添加安全提示文档 |

---

## 验证结果

### i18n 验证
```bash
cd frontend && npm run lint:i18n
```
预期结果：无新增缺失的翻译键警告

### 日志安全验证
```javascript
// 测试场景：创建 HTTP MCP Server
{
  "transport_type": "http",
  "url": "https://api.example.com/mcp",
  "headers": "{\"Authorization\": \"Bearer secret_token\"}"
}

// 预期日志输出：
// [mcp-client] Creating HTTP transport for my-server: https://api.example.com/mcp
// [mcp-client] HTTP headers: {"Authorization":"Bearer ***"}
```

---

## 修复后审计状态

| 检查项 | 之前状态 | 修复后状态 |
|--------|----------|------------|
| i18n 国际化 | ⚠️ 硬编码文本 | ✅ 已翻译 |
| 日志安全 | ⚠️ 可能泄露凭证 | ✅ 已脱敏 |

---

*修复完成时间: 2026-04-18*
*状态: ✅ 已完成*

✌Bazinga！
