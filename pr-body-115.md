## 问题背景

LLM 工具调用存在最大轮次限制，之前硬编码在两处：
- `lib/chat-service.js`: `MAX_TOOL_ROUNDS = 20`
- `server/services/assistant-manager.js`: `maxToolRounds: 5`

## 解决方案

将 `tool.max_rounds` 作为系统配置项，管理员可在系统设置中调整。

## 修改内容

### 后端

1. **`server/services/system-setting.service.js`**
   - 添加 `tool.max_rounds` 配置项（默认值 20，范围 1-50）
   - 添加验证规则
   - 新增 `getToolConfig()` 和 `getMaxToolRounds()` 方法

2. **`lib/chat-service.js`**
   - 从系统设置读取 `MAX_TOOL_ROUNDS`

3. **`server/services/assistant-manager.js`**
   - 从系统设置读取 `maxToolRounds`

### 前端

4. **`frontend/src/stores/systemSettings.ts`**
   - 添加 `tool` 类型定义
   - 添加 `toolSettings` getter

5. **`frontend/src/components/settings/SystemConfigTab.vue`**
   - 添加工具调用配置区块
   - 添加 `max_rounds` 输入框（范围 1-50）

6. **国际化**
   - `frontend/src/i18n/locales/zh-CN.ts`: 添加翻译
   - `frontend/src/i18n/locales/en-US.ts`: 添加翻译

## 测试

- [x] 前端构建通过
- [x] 后端模块加载正常
- [x] 代码审计通过

## 后续工作

- 专家级别的工具调用配置（覆盖系统配置）