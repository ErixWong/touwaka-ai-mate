# Code Review: Knowledge Base Skill Split

**日期**: 2026-03-07
**审查者**: Maria
**相关 Issue**: #10
**状态**: ✅ 已修复

---

## 审计范围

| 文件 | 说明 |
|------|------|
| `data/skills/kb-editor/index.js` | 知识库编辑技能 |
| `data/skills/kb-search/index.js` | 知识库搜索技能 |
| `lib/skill-loader.js` | 技能加载器（修改） |
| `lib/tool-manager.js` | 工具管理器（修改） |

---

## 发现的问题

### 🔴 严重问题 (Critical)

#### 1. SSL 证书验证被禁用 ✅ 已修复

**文件**: `kb-editor/index.js:47`, `kb-search/index.js:47`

**原代码**:
```javascript
rejectUnauthorized: false,
```

**风险**: 禁用 SSL 证书验证会导致中间人攻击（MITM）风险，在生产环境中可能泄露敏感数据。

**修复**:
```javascript
// 生产环境启用 SSL 证书验证，开发环境可禁用（自签名证书）
rejectUnauthorized: NODE_ENV === 'production',
```

---

### 🟡 中等问题 (Medium)

#### 2. 未使用的变量 ✅ 已修复

**文件**: `kb-editor/index.js:12,17`, `kb-search/index.js:12,17`

**原代码**:
```javascript
const url = require('url');  // 未使用
const USER_ID = process.env.USER_ID || '';  // 未使用
```

**修复**: 删除了未使用的 `url` 和 `USER_ID` 变量，添加了 `NODE_ENV` 用于 SSL 控制

---

#### 3. 硬编码的嵌入模型默认值 ⚠️ 保留

**文件**: `kb-editor/index.js:144-146`

```javascript
// 默认使用 bge-m3 嵌入模型
const finalEmbeddingModelId = embedding_model_id || 'bge-m3';
// bge-m3 生成的向量维度为 1024
const finalEmbeddingDim = embedding_dim || 1024;
```

**决定**: 保留当前实现，因为：
- 用户可以通过参数覆盖默认值
- 未来可以从 API 获取默认值（低优先级优化）

---

#### 4. 搜索结果格式化函数的参数问题 ✅ 已修复

**文件**: `kb-search/index.js:304`

**原代码**:
```javascript
output: formatSearchResults(result, params.query || params.kb_id),
```

**问题**: 当使用 `global_search` 时，`params.kb_id` 不存在，会导致标题显示为 `undefined`

**修复**:
```javascript
output: formatSearchResults(result, params.query || 'search'),
```

同时添加了 `search_in_knowledge` 到格式化支持列表。

---

### 🟢 轻微问题 (Minor)

#### 5. 重复的 API_BASE 设置 ✅ 已修复

**文件**: `lib/skill-loader.js:469`

**原代码**:
```javascript
const allowedSystemVars = ['PATH', 'NODE_ENV', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'API_BASE'];
```

**修复**: 从 `allowedSystemVars` 中移除 `API_BASE`，因为它在下面单独设置

---

#### 6. 错误消息国际化 ⚠️ 保留

**文件**: `kb-editor/index.js`, `kb-search/index.js`

**决定**: 保持中文错误消息，与项目当前风格一致。未来可考虑 i18n。

---

## 代码质量评估

### ✅ 优点

1. **安全架构正确**: 使用用户 JWT Token 而非内部密钥
2. **代码结构清晰**: 职责分离明确（编辑 vs 搜索）
3. **错误处理完善**: 参数验证、HTTP 错误处理
4. **日志记录**: skill-loader 有详细的日志输出
5. **超时处理**: HTTP 请求有 30 秒超时

### ⚠️ 已改进

1. ✅ SSL 证书验证问题已修复
2. ✅ 删除未使用的变量
3. ✅ 修复格式化函数的参数问题
4. ✅ 移除重复的 API_BASE

---

## 修复清单

| 优先级 | 问题 | 文件 | 状态 |
|--------|------|------|------|
| 🔴 高 | SSL 证书验证 | kb-editor/index.js, kb-search/index.js | ✅ 已修复 |
| 🟡 中 | 未使用变量 | kb-editor/index.js, kb-search/index.js | ✅ 已修复 |
| 🟡 中 | 格式化参数 | kb-search/index.js | ✅ 已修复 |
| 🟢 低 | 重复 API_BASE | skill-loader.js | ✅ 已修复 |

---

## 审计结论

**总体评价**: 代码架构设计合理，安全模型正确。所有发现的问题已修复。

**下一步**:
1. 测试新技能功能
2. 在数据库中注册 `kb-editor` 和 `kb-search` 技能
3. 标记原 `knowledge-base` 技能为废弃

---

*审查完成时间: 2026-03-07 16:50 CST*
*修复完成时间: 2026-03-07 16:52 CST*
