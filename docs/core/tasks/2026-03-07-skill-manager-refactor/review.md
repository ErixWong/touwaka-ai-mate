# Code Review: skill-manager 重构

## 基本信息

- **任务**: 重构 skill-manager 为 API 调用模式
- **分支**: `refactor/skill-manager-to-api`
- **提交**: `9f29101`
- **审查日期**: 2026-03-07
- **审查人**: Maria

## 变更概览

| 文件 | 变更 |
|------|------|
| `data/skills/skill-manager/index.js` | 完全重写，656→236 行 |
| `data/skills/skill-manager/SKILL.md` | 更新配置说明 |
| `docs/issues/refactor-skill-manager-to-api.md` | 新建 issue 文档 |

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
2. [ ] 集成测试 - 测试所有工具功能
3. [ ] 更新 skill_parameters 表配置（移除 SKILL_DB_* 参数）

### 建议的后续工作

1. 添加单元测试
2. 通知相关开发者 API 变更

---

*审查完成时间: 2026-03-07*
