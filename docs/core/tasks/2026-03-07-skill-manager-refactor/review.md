# Code Review: skill-manager 重构

## 基本信息

- **任务**: 重构 skill-manager 为 API 调用模式
- **分支**: `refactor/skill-manager-to-api`
- **提交范围**: `415c97c..c97d11b` (5 commits)
- **审查日期**: 2026-03-07
- **审查人**: Maria

## 提交历史

| 提交 | 描述 |
|------|------|
| `c97d11b` | security: 保护系统参数不被 skill_parameters 覆盖 |
| `67e7ab7` | fix: 修复用户 Token 在调用链中未传递的问题 |
| `295ad6a` | refactor: 移除 list_kbs 别名，只保留 list_my_kbs |
| `7e51e7f` | docs: 添加 skill-manager 重构的代码审计报告 |
| `9f29101` | refactor: 重构 skill-manager 为 API 调用模式 |

## 变更概览

| 文件 | 变更 |
|------|------|
| `data/skills/skill-manager/index.js` | 完全重写，656→236 行 |
| `data/skills/skill-manager/SKILL.md` | 更新配置说明 |
| `lib/chat-service.js` | 添加 access_token 参数传递 |
| `lib/skill-loader.js` | 保护系统参数不被覆盖 |
| `server/middlewares/auth.js` | 保存原始 token |
| `server/controllers/stream.controller.js` | 传递 access_token |

## 代码审查清单

### ✅ 代码风格

- [x] 代码风格与 kb-search 保持一致
- [x] 注释清晰，JSDoc 格式正确
- [x] 变量命名规范（camelCase）
- [x] 无 console.log 残留（生产代码）

### ✅ 功能完整性

| 工具 | 原实现 | 新实现 | 状态 |
|------|--------|--------|------|
| `list_skills` | ✅ SQL | ✅ API | 完成 |
| `list_skill_details` | ✅ SQL | ✅ API | 完成 |
| `register_skill` | ✅ SQL | ✅ API | 完成 |
| `delete_skill` | ✅ SQL | ✅ API | 完成 |
| `toggle_skill` | ✅ SQL | ✅ API | 完成 |
| `assign_skill` | ❌ 无 | ✅ API | 新增 |
| `unassign_skill` | ❌ 无 | ✅ API | 新增 |

### ✅ 错误处理

- [x] 缺少 USER_ACCESS_TOKEN 时抛出明确错误
- [x] 参数验证完整（skill_id、source_path、tools 等）
- [x] HTTP 错误正确传递（状态码、错误消息）
- [x] 超时处理（30秒）

### ✅ 安全性

- [x] 移除了数据库凭证依赖
- [x] 使用用户 Token 认证
- [x] 生产环境启用 SSL 证书验证
- [x] 无敏感信息硬编码

### ⚠️ 需要注意的问题

#### 1. 后台 API 兼容性

**问题**: `register_skill` 的 API 端点参数可能不完全匹配

**分析**:
- skill 传入: `{ source_path, name, description, tools }`
- 后台 API (`server/controllers/skill.controller.js:1322`): 接收 `{ source_path, name, description, tools }`

**结论**: ✅ 参数匹配，无问题

#### 2. 返回值格式

**问题**: API 返回格式与原 skill 返回格式可能不同

**原实现返回**:
```javascript
{
  success: true,
  skill_id: 'xxx',
  name: 'xxx',
  action: 'created',
  tools_registered: 3,
  message: '✅ Skill "xxx" created with 3 tools'
}
```

**新实现返回**:
```javascript
{
  success: true,
  data: { ... } // API 返回的原始数据
}
```

**建议**: 需要确认前端/调用方是否依赖特定返回格式

#### 3. 移除了 getTools() 方法

**问题**: 原实现有 `getTools()` 方法用于定义工具清单，新实现移除了

**分析**:
- 原实现: `module.exports.getTools()` 返回工具定义
- 新实现: 只有 `execute()` 方法

**调查结果**: ✅ 无问题

经过分析 `lib/skill-loader.js`，工具定义是从 `skill_tools` 表加载的（第 139-159 行 `loadSkillTools` 方法），不是从 skill 的 `getTools()` 方法获取。

```javascript
// lib/skill-loader.js:139-159
async loadSkillTools(skill) {
  const toolRows = await SkillTool.findAll({
    where: { skill_id: skill.id },
    raw: true,
  });
  return toolRows.map(row => this.convertToolToOpenAIFormat(row, skill));
}
```

**结论**: 移除 `getTools()` 方法是正确的，不会影响功能

### ✅ 文档更新

- [x] SKILL.md 已更新
- [x] 环境变量说明完整
- [x] 工具参数说明清晰
- [x] 架构说明已添加

## 测试建议

### 单元测试

```javascript
// 测试用例建议
describe('skill-manager', () => {
  test('list_skills 应该返回技能列表', async () => {
    const result = await execute('list_skills', {});
    expect(result.success).toBe(true);
    expect(result.data.skills).toBeDefined();
  });

  test('缺少 USER_ACCESS_TOKEN 应该抛出错误', async () => {
    // 临时移除 token
    const originalToken = process.env.USER_ACCESS_TOKEN;
    delete process.env.USER_ACCESS_TOKEN;
    
    await expect(execute('list_skills', {})).rejects.toThrow('用户未登录');
    
    process.env.USER_ACCESS_TOKEN = originalToken;
  });
});
```

### 集成测试

1. 启动后台服务
2. 设置环境变量 `API_BASE` 和 `USER_ACCESS_TOKEN`
3. 依次测试所有工具:
   - [ ] `list_skills` - 列出技能
   - [ ] `list_skill_details` - 获取详情
   - [ ] `register_skill` - 注册技能
   - [ ] `toggle_skill` - 启用/禁用
   - [ ] `assign_skill` - 分配技能
   - [ ] `unassign_skill` - 取消分配
   - [ ] `delete_skill` - 删除技能

## 审查结论

### 总体评价: ✅ 通过

重构质量良好，代码简洁，与 kb-search 风格一致。

### 已确认问题

1. **skill-loader 加载机制** - ✅ 已确认不依赖 `getTools()` 方法，工具定义从 `skill_tools` 表加载
2. **返回值格式兼容性** - ⚠️ 需要确认调用方是否依赖特定返回格式
3. **环境变量注入** - ✅ skill-loader 会自动注入 `USER_ACCESS_TOKEN` 和 `API_BASE`（第 518-520 行）

### ⚠️ 框架级别问题：用户 Token 未传递（已修复）

**问题描述**：虽然 skill-loader 支持注入 `USER_ACCESS_TOKEN`，但后端在调用链中没有传递用户的 access token。

**调用链分析**：

```
stream.controller.js::processMessageAsync()
  ↓ 没有传递 accessToken
chat-service.js::streamChat()
  ↓ 没有传递 accessToken
chat-service.js::handleToolCalls()  (第 1130-1138 行)
  ↓ context 没有 accessToken
tool-manager.js::executeToolCalls()  (第 300-323 行)
  ↓ context.accessToken 为 undefined
tool-manager.js::executeTool()  (第 255 行)
  ↓ accessToken = context.accessToken (undefined)
skill-loader.js::executeSkillTool()
  ↓ userContext.accessToken 为 undefined
skill-loader.js::buildSkillEnvironment()  (第 518 行)
  ↓ USER_ACCESS_TOKEN: userContext.accessToken || ''  (空字符串!)
```

**根本原因**：
1. `server/middlewares/auth.js` 只保存 `userId` 和 `userRole`，**没有保存原始 token**
2. `chat-service.js::handleToolCalls()` 创建的 context 没有 accessToken

**修复内容**：
1. ✅ `server/middlewares/auth.js` - 保存原始 token 到 `ctx.state.accessToken`
2. ✅ `server/controllers/stream.controller.js` - 传递 `access_token` 到 `streamChat()`
3. ✅ `lib/chat-service.js::streamChat()` - 接收 `access_token` 参数
4. ✅ `lib/chat-service.js::handleToolCalls()` - 传递 `accessToken` 到 context

**影响范围**：
- ✅ **kb-search** - 修复后可以正常调用后台 API
- ✅ **skill-manager** - 修复后可以正常调用后台 API
- ✅ **kb-editor** - 修复后可以正常调用后台 API

### 合并前需完成

1. [x] **修复 Token 传递问题** - 在调用链中传递用户的 access token（框架级别修复）
2. [x] **保护系统参数** - `API_BASE`、`USER_ACCESS_TOKEN` 等不可被 skill_parameters 覆盖
3. [ ] 集成测试 - 测试所有工具功能
4. [ ] 更新 skill_parameters 表配置（移除 SKILL_DB_* 参数）

---

## 详细代码审查

### 1. skill-manager/index.js

#### ✅ 优点

1. **代码量大幅减少**: 656→236 行，降低 64%
2. **职责清晰**: 只负责 API 调用，业务逻辑在后台
3. **与 kb-search 风格一致**: 使用相同的 `httpRequest` 模式
4. **错误处理完善**: 参数验证、HTTP 错误、超时处理

#### 检查项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 模块依赖 | ✅ | 只使用 http/https，无外部依赖 |
| 环境变量 | ✅ | API_BASE, USER_ACCESS_TOKEN, NODE_ENV |
| 错误消息 | ✅ | 中文提示，用户友好 |
| 超时设置 | ✅ | 30秒，合理 |
| SSL 验证 | ✅ | 生产启用，开发禁用 |

#### 代码片段审查

```javascript
// 第 28-94 行: httpRequest 函数
// ✅ 正确处理了 204 No Content
// ✅ 正确解析响应体
// ✅ 错误消息传递正确
// ✅ 超时处理完善
```

### 2. skill-loader.js 变更

#### 检查项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| RESERVED_ENV_VARS | ✅ | 包含所有安全关键参数 |
| 日志输出 | ✅ | 冲突时记录警告 |
| 向后兼容 | ✅ | 不影响现有配置 |

```javascript
// 第 477-480 行
const RESERVED_ENV_VARS = [
  'SKILL_ID', 'DATA_BASE_PATH', 'SKILL_CONFIG', 'NODE_OPTIONS', 'SCRIPT_PATH',
  'USER_ACCESS_TOKEN', 'USER_ID', 'API_BASE',  // 安全关键参数
];
```

### 3. chat-service.js 变更

#### 检查项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| streamChat 参数 | ✅ | 新增 access_token 参数 |
| chat 参数 | ✅ | 新增 access_token 参数 |
| handleToolCalls 参数 | ✅ | 新增 access_token 参数 |
| context 传递 | ✅ | accessToken 正确传递 |

### 4. auth.js 变更

#### 检查项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| authenticate | ✅ | 保存 token 到 ctx.state.accessToken |
| optionalAuth | ✅ | 同样保存 token |

---

## 安全审查

### ✅ 安全增强

1. **移除数据库凭证**: skill 不再需要 `SKILL_DB_*` 参数
2. **用户 Token 认证**: 使用 `USER_ACCESS_TOKEN` 替代内部认证
3. **参数保护**: 安全关键参数不可被配置覆盖
4. **Token 不传递给 LLM**: 只在 skill 执行时注入

### 潜在风险分析

| 风险 | 等级 | 说明 |
|------|------|------|
| Token 泄露 | 低 | 只在服务端内部传递，不暴露给 LLM |
| 恶意 Skill | 中 | 需要信任内置 Skill；第三方 Skill 需审查 |
| 参数覆盖 | 已修复 | RESERVED_ENV_VARS 保护 |

---

## 建议的后续工作

1. 添加单元测试
2. 通知相关开发者 API 变更
3. 更新部署文档，说明 `API_BASE` 环境变量

---

*审查完成时间: 2026-03-07*
