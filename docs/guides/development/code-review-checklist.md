# 代码审计清单

> **最后更新**: 2026-03-13
> **来源**: `docs/core/SOUL.md` 自我代码审计清单

---

## 使用时机

提交 PR 前，按以下步骤逐项检查。

---

## 第一步：编译与自动化检查

```bash
# 必须首先通过
npm run lint
npm start &
cd frontend && npm run build
```

**检查项**：
- [ ] `npm run lint` 通过（检查 buildPaginatedResponse 参数）
- [ ] 后端启动无报错
- [ ] 前端构建成功

**⚠️ `npm run lint` 必须通过后才能提交 PR！**

### ⚠️ ES 模块导入验证（重要）

**ESLint 不检查模块导入/导出是否匹配！** 任何涉及 `import`/`export` 的修改都必须验证：

```bash
# 验证模块导入是否正确（替换为实际修改的文件）
node -e "import('./server/services/system-setting.service.js').then(m => console.log('Exports:', Object.keys(m)))"
node -e "import('./lib/skill-loader.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

**常见错误**：
```javascript
// ❌ 错误 - 使用命名导入但模块只有默认导出
import { SystemSettingService } from './service.js';
// service.js 只有: export default class SystemSettingService {}

// ✅ 正确 - 添加命名导出
// service.js:
export { SystemSettingService };  // 添加命名导出
export default SystemSettingService;
```

**何时必须验证**：
- 新增或修改 `export` 语句
- 新增或修改 `import` 语句
- 重构模块导出方式
- **即使认为"不涉及启动流程变更"，只要改了 import/export 就必须验证！**

---

## 第二步：API 响应格式检查

### ctx.success() 使用

```javascript
// ✅ 正确
ctx.success(data);
ctx.success(buildPaginatedResponse(result, pagination, startTime));

// ❌ 错误
ctx.body = data;
```

### buildPaginatedResponse 参数顺序（关键）

```javascript
// ✅ 正确 - (result, pagination, startTime)
const result = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(result, pagination, startTime));

// ❌ 错误 - 不要解构后传递
const { rows, count } = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(rows, count, pagination));
```

---

## 第三步：代码质量检查

| 关键词 | 检查项 |
|--------|--------|
| **SQL 注入** | 用户输入拼接到 SQL？使用参数化查询 |
| **XSS** | 用户输入渲染到页面？使用 DOMPurify |
| **敏感数据** | 日志是否暴露密钥、token？ |
| **错误处理** | try-catch 覆盖完整？错误提示友好？ |
| **边界条件** | 空值、空数组是否有处理？ |
| **并发安全** | 定时任务重叠执行？共享资源竞态？ |
| **资源泄漏** | 连接/文件/定时器是否正确释放？ |
| **N+1 查询** | 循环中有数据库调用？改用批量查询 |
| **路由顺序** | 动态路由 `/:id` 是否在静态路由之后？ |
| **ID 类型匹配** | 自增 ID 字段是否误用手动指定（如 `Utils.newID()`）？检查 Model 定义中 `autoIncrement: true` 的字段 |

### 前端错误处理专项检查

**禁止静默吞掉错误**：

```typescript
// ❌ 错误 - 空 catch 块静默吞掉错误
} catch {
  // 错误已在 store 中处理
}

// ❌ 错误 - 只有注释没有实际处理
} catch (err) {
  // 错误已处理
}

// ✅ 正确 - 显示错误信息给用户
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : t('xxx.failed')
  alert(errorMsg)  // 或使用 toast/notification 组件
}
```

**快速检查命令**：
```bash
# 查找可能静默吞掉错误的 catch 块
grep -rn "} catch {" frontend/src/views/ frontend/src/components/
grep -rn "// 错误已在" frontend/src/views/ frontend/src/components/
```

**错误处理最佳实践**：

1. **优先显示后端返回的具体错误信息**
   ```typescript
   const errorMsg = err instanceof Error ? err.message : t('xxx.failed')
   ```

2. **为每个可能失败的操作添加 i18n 翻译键**
   ```typescript
   // zh-CN.ts
   saveModelFailed: '保存模型失败'
   // en-US.ts
   saveModelFailed: 'Failed to save model'
   ```

3. **删除/保存等关键操作必须给用户明确的成功/失败反馈**

---

## 第四步：前后端契约检查

### 新增字段完整性检查

**新增数据库字段时，必须检查所有 CRUD 操作**：
- [ ] `create` 方法是否处理新字段？
- [ ] `update` 方法是否处理新字段？
- [ ] `list`/`get` 方法的 `attributes` 是否包含新字段？
- [ ] 前端 TypeScript 类型定义是否更新？

### 分页响应格式

**后端返回**：
```javascript
{ code: 200, data: { items: [...], pagination: {...} } }
```

**前端期望**：
```typescript
interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
}
```

**契约变更流程**：
1. 后端变更 → 同步更新前端类型定义
2. 新增字段 → 使用可选字段 `?`
3. 删除字段 → 确认前端无依赖后再删除
4. 重命名字段 → 先新增后删除，保持兼容

---

## 第五步：架构设计审计

| 检查方向 | 思考点 |
|----------|--------|
| **职责边界** | 模块职责是否清晰？是否存在上帝类？ |
| **依赖方向** | 依赖是否单向？是否存在循环依赖？ |
| **扩展性** | 新增功能是否需要大量修改？ |
| **复用性** | 重复代码是否可抽取为公共模块？ |
| **性能瓶颈** | 是否有 O(n²) 或更差的算法？ |
| **可测试性** | 模块是否易于单元测试？ |

---

## 第六步：命名规范检查

| 类型 | 规范 | 示例 |
|------|------|------|
| 数据库字段 | snake_case | `expressive_model_id` |
| 前端组件 | PascalCase | `KnowledgeBaseCard.vue` |
| API 路由 | kebab-case | `/api/kb/:kb_id/articles` |

**Git 提交**：`[T{编号}] {type}: 描述`

---

## 第七步：i18n 国际化检查

### 翻译键完整性检查

**必须检查项**：
- [ ] 所有 `$t()` 调用的 key 在 locale 文件中存在
- [ ] 新增功能同时更新 `zh-CN.ts` 和 `en-US.ts`
- [ ] 没有硬编码的中文/英文文本

**快速检查命令**：
```bash
# 查找所有 $t() 调用
grep -rn "\$t(" frontend/src/views/ frontend/src/components/

# 检查是否有硬编码中文（排除注释和字符串中的英文）
grep -rn "[一-龥]" frontend/src/views/*.vue frontend/src/components/*.vue
```

**修复示例**：
```typescript
// ❌ 错误 - 硬编码中文
<h1>知识库文章</h1>

// ❌ 错误 - key 不存在
<h1>{{ $t('knowledgeBase.articles') }}</h1>  // 如果 locales 中没有这个 key

// ✅ 正确
<h1>{{ $t('knowledgeBase.articles') }}</h1>
// 同时在 zh-CN.ts 和 en-US.ts 中添加：
// knowledgeBase: { articles: '知识库文章' / 'Knowledge Base Articles' }

---

## 第八步：前端 API 客户端检查

### 使用 apiClient 而非原生 fetch

**必须使用项目统一的 `apiClient`**：
- `apiClient` 自动处理 `access_token` 认证
- `apiClient` 支持 Token 过期自动刷新
- `apiClient` 统一错误处理

```typescript
// ❌ 错误 - 使用原生 fetch 和错误的 token 键名
const token = localStorage.getItem('token')  // 错误键名
const response = await fetch('/api/system/packages', {
  headers: { 'Authorization': `Bearer ${token}` },
})

// ✅ 正确 - 使用项目标准的 apiClient
import apiClient, { apiRequest } from '@/api/client'
const result = await apiRequest<PackageList>(apiClient.get('/system/packages'))
```

**快速检查命令**：
```bash
# 检查是否有直接使用 fetch 调用 API 的代码（应该无结果）
grep -rn "fetch('/api" frontend/src/stores/
grep -rn 'fetch("/api' frontend/src/stores/
```

**Token 存储键名**：
- ✅ 正确：`localStorage.getItem('access_token')`（由 apiClient 自动处理）
- ❌ 错误：`localStorage.getItem('token')`

---

## 常见问题快速修复

### 分页数据不显示

```bash
# 检查错误模式（应该无结果）
grep -rn "buildPaginatedResponse(rows" server/
grep -rn "buildPaginatedResponse(count" server/
```

**修复**：
```javascript
// ❌ 错误
const { rows, count } = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(rows, count, pagination));

// ✅ 正确
const result = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(result, pagination, startTime));
```

---

## 第九步：技能（Skill）代码审计

### 技能类型区分

| 类型 | `is_resident` | 执行方式 | 入口脚本 |
|------|--------------|---------|---------|
| **普通工具** | 0 | VM 沙箱，一次性执行 | 通过 `script_path` 指定 |
| **驻留进程** | 1 | 独立子进程，常驻内存 | 固定使用 `index.js` |

### 普通工具（is_resident=0）审计清单

#### 1. 模块格式检查

**必须使用 CommonJS 格式**（VM 沙箱要求）：

```javascript
// ✅ 正确 - CommonJS
const fs = require('fs');
const path = require('path');

async function execute(toolName, params, context = {}) {
  // 处理逻辑
}

module.exports = { execute };

// ❌ 错误 - ES Module（VM 沙箱不支持）
import fs from 'fs';
export async function execute(toolName, params, context) { }
```

#### 2. execute 函数签名检查

**必须包含 toolName 参数**：

```javascript
// ✅ 正确 - 三个参数
async function execute(toolName, params, context = {}) {
  if (toolName !== 'expected_tool') {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
  // ...
}

// ❌ 错误 - 缺少 toolName
async function execute(params, context) {
  // ...
}
```

#### 3. package.json 检查

- **有外部依赖**：需要 `package.json`（如 `compression` 依赖 `adm-zip`）
- **无外部依赖**：不需要 `package.json`（只用内置模块如 `fs`, `http`）

```bash
# 检查是否有不必要的 package.json
# 如果技能只用内置模块，删除 package.json
```

#### 4. 数据库 skill_tools 表检查

| 字段 | 检查项 |
|------|--------|
| `script_path` | 必须正确指向入口脚本（如 `submit.js`） |
| `is_resident` | 普通工具为 `0` |
| `parameters` | JSON Schema 格式正确 |

### 驻留进程（is_resident=1）审计清单

#### 0. 模块格式检查（关键！）

**必须使用 ES Module 格式**（独立子进程运行，继承项目 `"type": "module"`）：

```javascript
// ✅ 正确 - ES Module
import https from 'https';
import http from 'http';
import { URL } from 'url';
import readline from 'readline';

async function main() {
  // ...
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});

// ❌ 错误 - CommonJS（子进程会报错：require is not defined）
const https = require('https');
const readline = require('readline');
```

**原因**：项目根目录 `package.json` 有 `"type": "module"`，驻留进程作为独立子进程运行时会继承这个设置。

#### 1. 通信协议检查

**必须使用 stdio 通信**：

```javascript
// ✅ 正确 - stdout 返回结果，stderr 输出日志
function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function log(message) {
  process.stderr.write(`[${timestamp}] ${message}\n`);
}

// ❌ 错误 - 使用 console.log（会污染 stdout）
console.log('result');
```

#### 2. 命令处理检查

**必须支持基本命令**：

```javascript
// 必须处理的命令
switch (command.command) {
  case 'invoke':  // 调用任务
    handleInvoke(command.task_id, command.params);
    break;
  case 'ping':    // 健康检查
    sendResponse({ type: 'pong', timestamp: Date.now() });
    break;
  case 'exit':    // 退出命令
    process.exit(0);
    break;
}
```

#### 3. 任务队列检查

**异步处理，立即返回确认**：

```javascript
// ✅ 正确 - 立即返回确认，异步处理
async function handleInvoke(taskId, params) {
  // 立即返回确认
  sendResponse({
    task_id: taskId,
    result: { status: 'queued' }
  });
  
  // 添加到队列异步处理
  taskQueue.push({ task_id: taskId, params });
  processQueue();
}

// ❌ 错误 - 同步等待结果
async function handleInvoke(taskId, params) {
  const result = await longRunningTask(params);
  sendResponse({ task_id: taskId, result });  // 可能超时
}
```

#### 4. 启动就绪信号

**必须发送 ready 信号**：

```javascript
// 主函数最后
async function main() {
  // 初始化...
  
  // 发送启动就绪信号
  sendResponse({ type: 'ready', timestamp: Date.now() });
}
```

### 内部 API 响应格式检查

**内部 API 统一使用 `{ code, message, data }` 格式**：

```javascript
// ✅ 正确 - 检查 code 字段
const response = await httpRequest(url, options);
if (response.code === 200 && response.data?.model_id) {
  return response.data.model_id;
}

// ❌ 错误 - 检查 success 字段（不存在）
if (response.success) {  // success 字段不存在
  return response.data.model_id;
}
```

**API 响应格式对比**：

| API 类型 | 响应格式 |
|---------|---------|
| 外部 API（`/api/*`） | `{ code: 200, message: 'success', data: {...} }` |
| 内部 API（`/internal/*`） | `{ code: 200, message: 'success', data: {...} }` |

**注意**：项目中不使用 `response.success` 字段，统一使用 `response.code === 200` 判断成功。

### 通用检查项

| 检查项 | 说明 |
|--------|------|
| **语法检查** | `node --check data/skills/{skill}/index.js` |
| **依赖白名单** | 只使用 `MODULE_WHITELIST` 中的模块 |
| **错误处理** | 所有异步操作有 try-catch |
| **参数验证** | 检查必要参数是否存在 |
| **日志输出** | 驻留进程用 stderr，普通工具可用 console |
| **API 响应格式** | 使用 `response.code === 200` 而非 `response.success` |

### 快速检查命令

```bash
# 检查技能语法
node --check data/skills/remote-llm/index.js
node --check data/skills/remote-llm/submit.js

# 检查数据库工具配置
node tests/db-query.js skill_tools --where="skill_id='remote-llm'" --format=json

# 检查是否有不必要的 package.json（只用内置模块的技能）
ls data/skills/*/package.json
```

---

## 相关文档

- [编码规范](./coding-standards.md)
- [API 参考](./api-reference.md)
- [SOUL.md](../../core/SOUL.md)
- [驻留式技能设计](../../design/resident-skill-design.md)
