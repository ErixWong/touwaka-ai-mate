# Code Review 报告

**日期：** 2026-02-28
**审查人：** Maria 🌸
**范围：** 当前已完成的核心代码
**最后更新：** 2026-02-28 18:25

---

## 🔧 修复记录 (2026-02-28 18:14)

### ✅ 已修复问题

| 优先级 | 问题 | 解决方案 | 状态 |
|--------|------|----------|------|
| 🔴 P0 | Firejail 环境变量占位符未替换 | 新增 `buildFirejailArgs()` 方法，动态构建权限参数 | ✅ 已修复 |
| 🔴 P1 | Sandboxie 沙箱创建不完整 | 新增 `checkSandboxConfig()` + `generateSandboxConfig()` 方法 | ✅ 已修复 |
| 🟡 P2 | 数据库回滚脚本缺失 | 创建 `20260228-add-role-level.rollback.sql` | ✅ 已添加 |

### 修改的文件

1. **`lib/firejail-executor.js`**
   - 新增 `buildFirejailArgs()` - 根据角色动态构建 Firejail 参数
   - 新增 `getProcessedProfileContent()` - 处理配置文件变量替换
   - 移除对配置文件中 `${USER_ID}` 占位符的依赖

2. **`lib/sandboxie-executor.js`**
   - 新增 `checkSandboxConfig()` - 检测沙箱是否已配置
   - 新增 `generateSandboxConfig()` - 生成沙箱配置内容
   - 改进 `execute()` - 执行前检查配置，未配置则返回提示

3. **`scripts/migrations/20260228-add-role-level.rollback.sql`**（新建）
   - 数据库回滚脚本

### Git 提交

```
commit d3a65c9
feat: 用户隔离架构 Phase 1 - 沙箱执行器

11 files changed, 1778 insertions(+)
```

---

## 📊 总体评价

代码整体质量良好，架构清晰，符合项目设计规范。以下是详细的审查结果。

| 模块 | 评分 | 状态 |
|------|------|------|
| 后端 chat-service.js | ⭐⭐⭐⭐ | 良好 |
| 后端 tool-manager.js | ⭐⭐⭐⭐ | 良好 |
| 前端 ChatView.vue | ⭐⭐⭐⭐ | 良好 |
| 前端 panel.ts | ⭐⭐⭐ | 需改进 |
| 前端 RightPanel.vue | ⭐⭐⭐⭐ | 良好 |
| 前端 DebugTab.vue | ⭐⭐⭐⭐ | 良好 |
| 前端 TopicsTab.vue | ⭐⭐⭐ | 需完善 |

---

## ✅ 优点

### 后端
1. **架构清晰**：`ChatService` 和 `ExpertChatService` 分离合理
2. **多轮工具调用**：支持最多 20 轮工具调用，有保护机制
3. **SSE 事件完善**：定义了完整的事件类型（start, delta, tool_call, tool_results, complete, error）
4. **上下文压缩**：自动检测并触发压缩，设计合理
5. **工具隔离执行**：内置工具主进程执行，外部技能子进程隔离

### 前端
1. **SSE 重连机制**：完善的断线重连逻辑，最多 10 次尝试
2. **面板可调整**：使用 Splitpanes 支持拖拽调整宽度
3. **状态持久化**：面板宽度、折叠状态保存到 localStorage
4. **调试面板完善**：显示 Token 统计、LLM Payload、响应时间等
5. **国际化支持**：完善的 i18n 配置

---

## ⚠️ 问题与建议

### 🔴 高优先级

#### 1. ToolsTab 组件未实现
**文件：** `frontend/src/components/panel/`
**问题：** 根据设计文档 `tool-visualization.md`，应该有 ToolsTab 组件展示工具调用历史，但目前未实现。
**影响：** 工具调用信息只能在消息气泡中简单显示，无法查看详细参数和结果。
**建议：** 
- 创建 `ToolsTab.vue` 组件
- 在 `panel.ts` 中添加 `TabId = 'tools'`
- 添加 `toolCalls` 状态管理

#### 2. panel.ts 类型不完整
**文件：** [`frontend/src/stores/panel.ts:4`](frontend/src/stores/panel.ts:4)
**问题：** `TabId` 类型定义为 `'expert' | 'topics' | 'debug' | 'skills'`，但缺少 `'tools'`。
```typescript
// 当前
export type TabId = 'expert' | 'topics' | 'debug' | 'skills'

// 应该是
export type TabId = 'expert' | 'topics' | 'tools' | 'debug' | 'skills'
```

#### 3. initFromStorage 验证不完整
**文件：** [`frontend/src/stores/panel.ts:38`](frontend/src/stores/panel.ts:38)
**问题：** 只验证 `['expert', 'topics', 'debug']`，不包含 `'skills'` 和 `'tools'`。
```typescript
// 当前
if (savedTab && ['expert', 'topics', 'debug'].includes(savedTab)) {

// 应该是
const validTabs: TabId[] = ['expert', 'topics', 'tools', 'debug', 'skills']
if (savedTab && validTabs.includes(savedTab)) {
```

### 🟡 中优先级

#### 4. 工具执行缺少超时机制
**文件：** [`lib/tool-manager.js:279`](lib/tool-manager.js:279)
**问题：** `executeTool` 方法没有超时控制，长时间运行的工具可能阻塞整个请求。
**建议：** 添加 Promise.race 超时机制
```javascript
async executeTool(toolId, params, context = {}) {
  const timeout = context.timeout || 30000 // 默认 30 秒
  return Promise.race([
    this._executeToolInternal(toolId, params, context),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
    )
  ])
}
```

#### 5. 使用 alert/confirm 弹窗
**文件：** [`frontend/src/components/panel/DebugTab.vue:210`](frontend/src/components/panel/DebugTab.vue:210)
**问题：** 使用原生 `alert()` 和 `confirm()`，用户体验不佳。
**建议：** 使用项目中已有的 Dialog/Toast 组件。

#### 6. TopicsTab 分页功能未完成
**文件：** [`frontend/src/components/panel/TopicsTab.vue:122`](frontend/src/components/panel/TopicsTab.vue:122)
**问题：** `handlePageChange` 方法已定义但未使用，分页 UI 也未添加。
**建议：** 参考 `Pagination.vue` 组件添加分页功能，或使用无限滚动。

#### 7. 消息保存时 topic_id 参数困惑
**文件：** [`lib/chat-service.js:502`](lib/chat-service.js:502)
**问题：** `saveUserMessage` 方法接收 `topic_id` 参数但始终保存为 `null`，代码意图不清晰。
```javascript
// 当前实现
async saveUserMessage(topic_id, user_id, content, expert_id = null) {
  await this.Message.create({
    id: message_id,
    topic_id: null,  // 始终为 null，参数无意义
    ...
  });
}
```
**建议：** 移除无用的 `topic_id` 参数，或添加注释说明保留原因。

### 🟢 低优先级

#### 8. LLM Payload 内存缓存
**文件：** [`lib/chat-service.js:42`](lib/chat-service.js:42)
**问题：** `llmPayloadCache` 是内存级别的，服务重启后丢失。
**建议：** 如果需要持久化，可以考虑使用 Redis 或数据库存储。

#### 9. 代码注释语言不统一
**问题：** 部分注释使用中文，部分使用英文，不够统一。
**建议：** 统一使用中文注释（根据团队习惯）。

#### 10. 类型注释缺失
**文件：** `lib/chat-service.js`, `lib/tool-manager.js`
**问题：** 部分方法缺少 JSDoc 类型注释。
**建议：** 添加完整的 JSDoc 注释，提高代码可维护性。

---

## 🔄 设计文档与实现差异

根据 [`docs/core/tasks/tool-visualization.md`](docs/core/tasks/tool-visualization.md) 任务文档：

| 功能 | 文档要求 | 实际状态 |
|------|----------|----------|
| 后端 tool_call SSE 事件 | ✅ | ✅ 已完成 |
| 后端 tool_results SSE 事件 | ✅ | ✅ 已完成 |
| 前端 tool_call 事件处理 | ✅ | ⚠️ 仅在消息气泡显示 |
| 前端 tool_results 事件处理 | ✅ | ⚠️ 仅在消息气泡显示 |
| Panel Store toolCalls 状态 | ✅ | ❌ 未实现 |
| ToolsTab 组件 | ✅ | ❌ 未实现 |
| ToolCall/ToolResult 类型定义 | ✅ | ❌ 未实现 |

---

## 📋 改进建议清单

### 立即修复
- [ ] 添加 `'tools'` 到 `TabId` 类型
- [ ] 修复 `initFromStorage` 验证逻辑

### 短期（本周）
- [ ] 实现 `ToolsTab.vue` 组件
- [ ] 添加 `toolCalls` 状态到 panel store
- [ ] 添加 `ToolCall` 和 `ToolResult` 类型定义

### 中期（下周）
- [ ] 工具执行超时机制
- [ ] 替换 alert/confirm 为 UI 组件
- [ ] 完成 TopicsTab 分页功能

### 长期
- [ ] LLM Payload 持久化方案
- [ ] 统一代码注释语言
- [ ] 补充 JSDoc 类型注释

---

## 💡 重构建议

### 1. 提取工具调用状态管理

建议创建专门的 `useToolCalls` composable：

```typescript
// frontend/src/composables/useToolCalls.ts
export function useToolCalls() {
  const toolCalls = ref<ToolCall[]>([])
  
  const addToolCall = (call: ToolCall) => {
    toolCalls.value.unshift(call)
    if (toolCalls.value.length > 50) {
      toolCalls.value = toolCalls.value.slice(0, 50)
    }
  }
  
  const updateToolResult = (toolCallId: string, result: ToolResult) => {
    const index = toolCalls.value.findIndex(c => c.id === toolCallId)
    if (index !== -1) {
      toolCalls.value[index] = { ...toolCalls.value[index], ...result }
    }
  }
  
  const clearToolCalls = () => {
    toolCalls.value = []
  }
  
  return { toolCalls, addToolCall, updateToolResult, clearToolCalls }
}
```

### 2. 工具结果摘要格式化

建议在 `lib/tool-manager.js` 添加 `formatResultSummary` 方法：

```javascript
formatResultSummary(result) {
  const { toolName, success, data, error } = result
  
  if (!success) {
    return { status: 'error', message: error }
  }
  
  // 根据工具类型生成摘要
  const summaries = {
    'searxng_search': `找到 ${data?.results?.length || 0} 条结果`,
    'read_lines': `读取 ${data?.returnedLines || 0} 行`,
    'list_files': `${data?.files?.length || 0} 个文件/目录`,
    'write_file': `写入 ${data?.bytes || 0} 字节`,
  }
  
  return {
    status: 'success',
    summary: summaries[toolName] || '执行成功',
  }
}
```

---

## 📝 结论

代码整体质量良好，核心功能完整。主要问题集中在：

1. **工具调用可视化**：与设计文档存在差距，需要完成 ToolsTab 组件
2. **类型定义**：panel store 需要完善类型和验证
3. **用户体验**：部分交互使用原生弹窗，需要改进

建议按照优先级逐步修复和完善。

---

*审查完成于 2026-02-28*

---

## 🔍 新增文件审查 (2026-02-28)

### 审查范围

本次审查包含以下新文件：

| 文件 | 类型 | 行数 | 状态 |
|------|------|------|------|
| `lib/sandbox-executor.js` | 后端核心 | 106 | ✅ 良好 |
| `lib/sandboxie-executor.js` | 后端核心 | 264 | ✅ 良好 |
| `lib/firejail-executor.js` | 后端核心 | 259 | ✅ 良好 |
| `lib/skill-meta.js` | 后端核心 | 227 | ✅ 良好 |
| `config/firejail/*.profile` | 配置文件 | 3 个 | ✅ 良好 |
| `config/sandboxie/templates.ini` | 配置文件 | 55 | ✅ 良好 |
| `scripts/migrations/20260228-add-role-level.sql` | 数据库迁移 | 17 | ✅ 良好 |

---

### ✅ 优点

#### 1. 沙箱执行器架构设计优秀

**文件：** [`lib/sandbox-executor.js`](lib/sandbox-executor.js:1)

- **跨平台抽象层**：通过统一的 `SandboxExecutor` 类封装了 Windows (Sandboxie) 和 Linux (Firejail) 的差异
- **接口一致性**：两个平台执行器实现相同的接口方法 (`execute`, `isAvailable`, `createSandbox`, `deleteSandbox`)
- **平台检测**：自动检测操作系统并选择合适的执行器

```javascript
// 优秀的跨平台设计
if (this.platform === 'win32') {
  this.executor = new SandboxieExecutor();
} else if (this.platform === 'linux') {
  this.executor = new FirejailExecutor();
}
```

#### 2. 角色隔离设计完善

**文件：** [`lib/firejail-executor.js`](lib/firejail-executor.js:23), [`lib/sandboxie-executor.js`](lib/sandboxie-executor.js:25)

- **三级角色体系**：`admin` / `power_user` / `user`
- **配置文件分离**：每个角色有独立的安全配置文件
- **资源限制分级**：
  - User: 512M 内存，50 进程
  - Power User: 1G 内存，100 进程
  - Admin: 2G 内存，200 进程

#### 3. 技能元数据设计清晰

**文件：** [`lib/skill-meta.js`](lib/skill-meta.js:1)

- **风险等级分类**：`low` / `medium` / `high` / `critical`
- **角色权限映射**：每个技能明确定义所需的最低角色等级
- **工具函数完善**：提供了 `hasSkillAccess`, `filterSkillsByRole`, `validateSkillAccess` 等实用函数

```javascript
// 清晰的风险等级定义
export const SKILL_META = {
  exec: {
    builtin: true,
    risk_level: 'high',
    required_role: 'user',
    description: '在沙箱中执行命令',
  },
  'skill-delete': {
    builtin: false,
    risk_level: 'critical',
    required_role: 'admin',
    description: '删除技能',
  },
};
```

#### 4. 配置文件结构合理

**Firejail 配置：** [`config/firejail/user.profile`](config/firejail/user.profile:1)
- 使用 whitelist 机制限制访问范围
- 明确黑名单保护敏感文件 (`.env`, `*.key`, `*.pem`)
- 启用 seccomp 和 caps.drop 增强安全性

**Sandboxie 配置：** [`config/sandboxie/templates.ini`](config/sandboxie/templates.ini:1)
- 模板化设计，便于复用
- 使用环境变量占位符 (`%PROJECT_ROOT%`, `%USER_ID%`)
- 清晰的使用说明注释

#### 5. 数据库迁移规范

**文件：** [`scripts/migrations/20260228-add-role-level.sql`](scripts/migrations/20260228-add-role-level.sql:1)

- 有清晰的注释说明迁移目的
- 包含现有数据的更新逻辑
- 添加了索引优化查询性能

---

### ⚠️ 问题与建议

#### 🔴 高优先级

##### 1. 环境变量占位符未实现

**文件：** [`config/firejail/user.profile:5`](config/firejail/user.profile:5), [`config/sandboxie/templates.ini:8`](config/sandboxie/templates.ini:8)

**问题：** 配置文件中使用了 `${USER_ID}` 和 `%USER_ID%` 占位符，但代码中没有实现变量替换逻辑。

**当前实现：**
```javascript
// firejail-executor.js:90-92
const args = [
  `--profile=${profilePath}`,
  `--env=USER_ID=${userId}`,  // 只是设置环境变量
  // ...
];
```

**问题：** Firejail 的 profile 文件中的 `${USER_ID}` 不会被自动替换，需要在加载配置文件时进行字符串替换。

**建议：** 在 `getProfilePath` 方法中读取配置文件并进行变量替换：

```javascript
async getProfileContent(role, userId) {
  const profilePath = this.getProfilePath(role);
  let content = fs.readFileSync(profilePath, 'utf-8');
  
  // 替换变量
  content = content
    .replace(/\$\{USER_ID\}/g, userId)
    .replace(/\$\{PROJECT_ROOT\}/g, PROJECT_ROOT);
  
  return content;
}
```

**影响：** 如果不修复，用户隔离将无法正确工作，所有用户可能访问相同的目录。

##### 2. Sandboxie 配置模板未自动应用

**文件：** [`lib/sandboxie-executor.js:145-158`](lib/sandboxie-executor.js:145)

**问题：** `createSandbox` 方法只是返回一个对象，没有实际创建或配置 Sandboxie 沙箱。

```javascript
async createSandbox(userId, role) {
  // 只是返回信息，没有实际操作
  return {
    sandboxName,
    template,
    created: true,
  };
}
```

**建议：** 添加实际的沙箱配置逻辑，或者明确说明需要手动配置：

```javascript
async createSandbox(userId, role) {
  const sandboxName = `user_${userId}`;
  const template = this.getTemplateName(role);
  
  // 方案 1: 调用 Sandboxie API 创建沙箱
  // 方案 2: 生成配置片段，提示用户手动添加
  
  logger.info(`[SandboxieExecutor] Please add to Sandboxie.ini:`);
  logger.info(`[${sandboxName}]`);
  logger.info(`Template=${template}Runtime`);
  logger.info(`Enabled=y`);
  
  return { sandboxName, template, created: true, manualConfigRequired: true };
}
```

#### 🟡 中优先级

##### 3. 沙箱执行未使用角色配置文件

**文件：** [`lib/sandboxie-executor.js:66-81`](lib/sandboxie-executor.js:66)

**问题：** `execute` 方法没有使用角色的配置文件，只是简单地通过 `/box:` 参数指定沙箱名称。

```javascript
const args = [
  `/box:${sandboxName}`,
  `/nosbiectrl`,
  `cmd.exe`, '/c', command
];
```

**建议：** 确保在创建沙箱时已经应用了正确的模板配置，或者在执行时动态指定：

```javascript
// 如果 Sandboxie Plus 支持，可以动态指定模板
const args = [
  `/box:${sandboxName}`,
  `/template:${template}`,
  `/nosbiectrl`,
  `cmd.exe`, '/c', command
];
```

##### 4. 技能元数据缺少完整覆盖

**文件：** [`lib/skill-meta.js:16-96`](lib/skill-meta.js:16)

**问题：** `SKILL_META` 只定义了部分技能的元数据，可能还有其他技能未覆盖。

**建议：**
1. 添加技能注册机制，让外部技能也能定义元数据
2. 或者在技能加载时自动分析并设置默认元数据

```javascript
// 添加注册外部技能元数据的方法
export function registerSkillMeta(skillName, meta) {
  SKILL_META[skillName] = {
    builtin: false,
    risk_level: 'medium', // 默认中等风险
    required_role: 'user', // 默认用户角色
    ...meta,
  };
}
```

##### 5. 数据库迁移缺少回滚脚本

**文件：** [`scripts/migrations/20260228-add-role-level.sql`](scripts/migrations/20260228-add-role-level.sql:1)

**问题：** 只有前向迁移脚本，没有回滚脚本。

**建议：** 创建对应的回滚脚本 `scripts/migrations/20260228-add-role-level.rollback.sql`：

```sql
-- Rollback: Remove level field from roles table
-- Date: 2026-02-28

DROP INDEX idx_level ON roles;
ALTER TABLE roles DROP COLUMN level;
```

#### 🟢 低优先级

##### 6. 代码重复

**文件：** [`lib/firejail-executor.js:161-178`](lib/firejail-executor.js:161), [`lib/sandboxie-executor.js:201-223`](lib/sandboxie-executor.js:201)

**问题：** 两个执行器都有相同的 `getUserWorkDir` 和 `resolveWorkPath` 方法实现。

**建议：** 提取为公共工具函数：

```javascript
// lib/utils/path-resolver.js
export function getUserWorkDir(userId) {
  return path.join(PROJECT_ROOT, 'data', 'work', userId);
}

export function resolveWorkPath(cwd, userId) {
  if (path.isAbsolute(cwd)) {
    return cwd;
  }
  return path.join(getUserWorkDir(userId), cwd);
}
```

##### 7. 日志输出可以更安全

**文件：** [`lib/firejail-executor.js:98-99`](lib/firejail-executor.js:98)

**问题：** 日志中记录了完整的工作目录路径，可能包含用户 ID 等敏感信息。

**建议：** 在生产环境中使用脱敏日志：

```javascript
logger.debug(`[FirejailExecutor] WorkDir: ${maskUserId(workDir)}`);

function maskUserId(path) {
  return path.replace(/work\/[^/]+/g, 'work/***');
}
```

##### 8. 缺少配置验证

**文件：** [`lib/firejail-executor.js:243-256`](lib/firejail-executor.js:243)

**问题：** `initializeConfigDir` 方法只在配置文件不存在时创建，但没有验证现有配置的正确性。

**建议：** 添加配置验证功能：

```javascript
async validateConfigDir() {
  const errors = [];
  
  for (const role of Object.keys(this.roleProfiles)) {
    const profilePath = this.getProfilePath(role);
    if (!fs.existsSync(profilePath)) {
      errors.push(`Missing profile: ${profilePath}`);
    } else {
      const content = fs.readFileSync(profilePath, 'utf-8');
      if (!content.includes('whitelist') && !content.includes('private')) {
        errors.push(`Invalid profile (no access rules): ${profilePath}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}
```

---

### 📋 新增改进建议清单

#### 立即修复
- [ ] **实现配置文件变量替换** - 这是用户隔离功能正常工作的关键
- [ ] 添加数据库迁移的回滚脚本

#### 短期（本周）
- [ ] 完善 Sandboxie 沙箱创建逻辑，或明确说明需要手动配置
- [ ] 提取公共路径解析函数到工具模块
- [ ] 添加技能元数据注册机制

#### 中期（下周）
- [ ] 添加配置文件验证功能
- [ ] 实现日志脱敏功能
- [ ] 补充更多技能的元数据定义

---

## 📝 新增文件审查结论

本次审查的新文件整体质量**优秀**：

1. **架构设计**：沙箱执行器的跨平台抽象设计非常清晰，易于维护和扩展
2. **安全考虑**：角色隔离、资源限制、文件访问控制等安全措施完善
3. **代码规范**：注释清晰，方法命名规范，符合项目代码标准

**关键问题**：配置文件中的变量占位符需要尽快实现替换逻辑，否则用户隔离功能将无法正常工作。

建议优先修复高优先级问题，然后逐步完善其他功能。

---

*新增文件审查完成于 2026-02-28*