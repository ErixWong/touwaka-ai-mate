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
| **数据库方法选择** | SELECT 用 `db.query()`，INSERT 用 `db.insert()`，UPDATE/DELETE 用 `db.execute()` |
| **API 权限校验** | 所有写操作是否校验用户权限？详见下方专项检查 |

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

### API 权限校验专项检查

> **来源**：Issue #426 知识库权限控制遗漏教训
> **核心原则**：认证 ≠ 权限校验，所有写操作必须校验用户是否有操作权限

#### 权限校验原则

| 原则 | 说明 |
|------|------|
| **认证 ≠ 授权** | 用户已登录不代表有权限操作所有资源 |
| **最小权限原则** | 默认拒绝，只授予必要权限 |
| **层级权限继承** | 子资源操作必须校验父资源权限 |

#### 检查清单

**每个 API 端点必须检查**：

| 操作类型 | 权限校验要求 |
|----------|-------------|
| **创建（POST）** | 校验用户是否有权限在该父资源下创建子资源 |
| **更新（PUT）** | 校验用户是否有权限编辑该资源 |
| **删除（DELETE）** | 校验用户是否有权限删除该资源 |
| **查询（GET）** | 校验用户是否有权限访问该资源（或过滤结果） |

**层级资源权限校验**：

```
知识库 (kb)           → canEditKb() / canAccessKb()
  └── 文章 (article)  → 必须校验 kb 权限
      └── 节 (section) → 必须校验 kb 权限
          └── 段落 (paragraph) → 必须校验 kb 权限
  └── 标签 (tag)      → 必须校验 kb 权限
```

#### 代码模板

```javascript
// ✅ 正确 - 写操作前校验权限
async createArticle(ctx) {
  const { kb_id } = ctx.params;
  const userId = ctx.state.session.id;

  // 权限检查：只有 owner 或 admin 可以编辑
  const canEdit = await canEditKb(this.db, kb_id, userId);
  if (!canEdit) {
    ctx.throw(403, '无权编辑此知识库');
  }

  // 执行业务逻辑...
}

// ❌ 错误 - 只验证资源存在，未校验权限
async createArticle(ctx) {
  const { kb_id } = ctx.params;

  // 只验证知识库存在，未校验用户是否有权限
  const kb = await this.KnowledgeBase.findByPk(kb_id);
  if (!kb) {
    ctx.throw(404, 'Knowledge base not found');
  }

  // 直接执行业务逻辑 - 安全漏洞！
}
```

#### 快速检查命令

```bash
# 检查所有写操作是否缺少权限校验
# 查找 POST/PUT/DELETE 路由定义
grep -rn "router\.\(post\|put\|delete\)" server/routes/

# 对照检查对应的 controller 方法是否包含权限校验
grep -rn "canEdit\|canAccess\|canDelete" server/controllers/
```

#### 常见遗漏场景

| 场景 | 问题 | 修复 |
|------|------|------|
| 子资源 CRUD | 只验证父资源存在，未校验编辑权限 | 添加 `canEditKb()` 校验 |
| 批量操作 | 只校验部分资源权限 | 所有涉及资源都必须校验 |
| 嵌套资源 | 只校验直接父资源，忽略祖先资源 | 递归校验祖先权限 |
| 公开资源 | 误认为公开=可编辑 | 读权限 ≠ 写权限，分别校验 |

---

## 第 3.5 步：系统复杂度审计

> **来源**：Issue #143 滚动条乱跑问题修复经验
> **核心思想**：新功能开发和Bug修复不可避免会引入复杂性，必须审查是否让系统变得更混乱

### 审计原则

| 原则 | 说明 |
|------|------|
| **熵增警惕** | 每次修改后检查：系统是更清晰了还是更混乱了？ |
| **简化优先** | 复杂问题优先考虑简化现有设计，而非添加更多逻辑 |
| **单一职责** | 一个模块/状态只做一件事，避免功能蔓延 |

### 检查清单

**状态复杂度**：
- [ ] 新增状态变量是否与现有状态职责重叠？
- [ ] 状态之间是否存在交叉判断、相互影响？
- [ ] 是否可以用单一状态替代多个状态？

**逻辑复杂度**：
- [ ] 新增逻辑是否让现有流程更难理解？
- [ ] 是否存在多层嵌套的条件判断？
- [ ] 是否有重复或相似的逻辑可以抽取？

**模块复杂度**：
- [ ] 单个文件/函数是否过长（>300行/>50行）？
- [ ] 模块职责是否清晰？是否存在"上帝类"？
- [ ] 是否需要拆分为更小的模块？

### 重构信号

| 信号 | 问题 | 行动 |
|------|------|------|
| 新增状态需与现有状态联动 | 状态耦合严重 | 合并或重新设计状态 |
| 修复Bug需添加更多判断 | 逻辑腐化 | 重构而非打补丁 |
| 无法快速理解代码流程 | 可读性差 | 简化/拆分/注释 |
| 修改一处影响多处 | 耦合过高 | 解耦/职责分离 |

### 实践案例

**Issue #143 教训**：滚动控制引入多个状态变量（`isInitialLoad`、`userScrolledAway`、`scrollStabilizeTimer`等）导致状态冲突，最终简化为单一状态 `isUserAtBottom` 解决问题。

**审查思路**：
1. 发现问题 → 不急于添加逻辑
2. 分析现有设计 → 找出复杂度根源
3. 从基本需求出发 → 重新设计而非打补丁

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

> **最后更新**: 2026-03-31
> **新增**: `npm run lint:i18n` 自动化检查脚本

### 翻译键完整性检查

**必须检查项**：
- [ ] 所有 `$t()` 调用的 key 在 locale 文件中存在
- [ ] 新增功能同时更新 `zh-CN.ts` 和 `en-US.ts`
- [ ] 没有硬编码的中文/英文文本

**自动化检查命令（推荐）**：
```bash
cd frontend

# 运行 i18n 检查脚本，自动检测缺失的翻译键
npm run lint:i18n

# 检查通过后会显示：✅ 所有翻译键都已正确定义！
# 如果有缺失会显示：❌ 在 zh-CN.ts/en-US.ts 中缺失 X 个键
```

**手动检查命令（备用）**：
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

### ESLint i18n 规则

项目已配置 `@intlify/eslint-plugin-vue-i18n`，会在 `npm run lint` 时自动检查：

- `@intlify/vue-i18n/no-raw-text`: 检测硬编码中文文本
- 其他 i18n 相关规则

**注意**：ESLint 的 i18n 规则主要检测硬编码文本，缺失 key 的检测请使用 `npm run lint:i18n`

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

## 第十步：数据库迁移检查

> **⚠️ 关键提醒：修改数据库字段后，必须同步更新 `scripts/upgrade-database.js`！**
>
> **忘记更新的后果**：部署到其他实例时，低版本数据库会因缺少字段而报错！

### 迁移脚本规范

**所有数据库迁移必须统一使用 `scripts/upgrade-database.js`，禁止创建独立的迁移脚本！**

### 何时必须添加迁移

| 场景 | 必须添加迁移 | 检查点 |
|------|-------------|--------|
| 新增表 | ✅ | `hasTable()` |
| 新增字段 | ✅ | `hasColumn()` |
| 修改字段类型 | ✅ | `getColumnType()` |
| 新增索引 | ✅ | `hasIndex()` |
| 新增外键 | ✅ | `hasForeignKey()` |
| 修改模型关联 | ❌ | 仅代码变更 |

### 重要：models/ 目录文件是自动生成的！

**`models/` 目录下的所有文件都是由 `sequelize-auto` 从数据库自动生成的，禁止手动修改！**

```bash
# 重新生成模型（会覆盖所有 models/ 下的文件）
node scripts/generate-models.js
```

**这意味着：**
- 不要手动修改 `models/*.js` 文件
- 不要手动修改 `models/init-models.js` 文件
- 数据库结构变更应该通过 `scripts/upgrade-database.js` 完成
- 变更后重新生成模型文件

### 开发提醒机制

**1. 修改数据库结构时，立即更新迁移脚本：**

```bash
# 修改 scripts/upgrade-database.js 后，运行测试
node scripts/upgrade-database.js
```

**2. PR 前必须检查清单：**
- [ ] 修改了数据库结构（表/字段/索引/外键）？
- [ ] 是否同步更新了 `scripts/upgrade-database.js`？
- [ ] 是否测试了迁移脚本（`node scripts/upgrade-database.js`）？
- [ ] 是否重新生成了模型（`node scripts/generate-models.js`）？

### 幂等性检查清单

- [ ] 每个迁移项有 `check` 函数检查是否已应用
- [ ] 使用 `safeExecute()` 捕获"已存在"类错误
- [ ] 表创建使用 `CREATE TABLE IF NOT EXISTS`
- [ ] 字段添加前检查 `hasColumn()`
- [ ] 外键添加前检查 `hasForeignKey()`

### 新增迁移项模板

```javascript
// 在 MIGRATIONS 数组末尾添加
{
  name: '表名.字段名 或 表名',
  check: async (conn) => {
    // 检查是否已存在（返回 true = 跳过迁移）
    return await hasColumn(conn, 'table_name', 'column_name');
    // 或检查表是否存在
    return await hasTable(conn, 'table_name');
  },
  migrate: async (conn) => {
    // 迁移逻辑
    await conn.execute(`ALTER TABLE ...`);
    // 使用 safeExecute 处理可能的重复错误
    await safeExecute(conn, `CREATE INDEX ...`);
  }
},
```

### 外键约束检查

- [ ] 新建表时检查是否需要外键约束
- [ ] 外键命名规范：`fk_{表名}_{字段名}`（如 `fk_kb_owner`）
- [ ] 外键删除行为：CASCADE / SET NULL / RESTRICT

### 迁移后验证

```bash
# 执行迁移
node scripts/upgrade-database.js

# 重新生成模型
node scripts/generate-models.js

# 验证模型文件
git diff server/models/
```

---

## 相关文档

- [编码规范](./coding-standards.md)
- [API 参考](./api-reference.md)
- [SOUL.md](../../core/SOUL.md)
- [驻留式技能设计](../../design/resident-skill-design.md)
