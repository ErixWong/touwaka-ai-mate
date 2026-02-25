# TODO 归档 - 2026年2月

---

## ORM 集成完成 ✅

**完成日期：** 2026-02-20

**成果：**
- 修改 `lib/db.js` 集成 Sequelize 连接，保留原有接口兼容性
- 更新所有 Controller 使用 Sequelize 模型（7个文件）
- 迁移 `lib/chat-service.js` 中的 SQL 查询到 Sequelize ORM
- 服务器启动测试通过

**技术细节：**
- 采用渐进式迁移策略：保留 `query()`/`execute()`/`getOne()` 等基础方法
- 业务方法全部迁移到使用 Sequelize 模型
- 暴露 `db.Op` 供 Controller 使用复杂查询条件
- 暴露 `db.getModel()` 方法供外部访问模型

**相关文档：**
- [ORM 选型分析](../guides/database/orm-analysis.md)
- [API 查询设计规范](../guides/database/api-query-design.md)
- [数据库手册](../guides/database/README.md)

---

## 后端 ESM 模块化改造 ✅

**完成日期：** 2026-02-20

**成果：**
- 将所有后端代码从 CommonJS 改为 ES Modules (ESM) 规范
- 转换 `lib/` 目录（13个文件）
- 转换 `server/` 目录（20个文件）
- 转换 `scripts/` 目录（3个文件）
- 转换 `tests/` 和 `test/` 目录（4个文件）
- 转换 `skills/` 目录（2个文件）
- 处理 `__dirname` 和 `__filename` 的 ESM 兼容问题
- 服务器启动测试通过

---

## ORM 模型生成 ✅

**完成日期：** 2026-02-20

**成果：**
- 选择 Sequelize 作为 ORM 框架
- 创建 DB First 模型生成脚本 `scripts/generate-models.js`
- 生成 14 个 Sequelize 模型文件到 `models/` 目录
- 实现通用查询构建器 `lib/query-builder.js`
- 设计 API 查询规范（操作符后缀映射到 Sequelize Op）
- 重组文档目录结构

**相关文档：**
- [ORM 选型分析](../guides/database/orm-analysis.md)
- [API 查询设计规范](../guides/database/api-query-design.md)
- [数据库手册](../guides/database/README.md)

---

## 专家编辑界面字段显示问题修复 ✅

**完成日期：** 2026-02-20

**问题描述：** 编辑专家时，部分字段（speaking_style、emotional_tone、core_values、behavioral_guidelines、prompt_template）在界面上没有显示。

**根本原因：** 模板中的 v-model 绑定使用了 camelCase（如 `expertForm.speakingStyle`），但 expertForm 对象的属性定义是 snake_case（如 `expertForm.speaking_style`），导致字段名不匹配。

**修复内容：**
- 修复 [`SettingsView.vue`](../frontend/src/views/SettingsView.vue) 中 5 个字段的 v-model 绑定
  - `speakingStyle` → `speaking_style`
  - `emotionalTone` → `emotional_tone`
  - `coreValues` → `core_values`
  - `behavioralGuidelines` → `behavioral_guidelines`
  - `promptTemplate` → `prompt_template`

---

## Modal static 模式修复 ✅

**完成日期：** 2026-02-20

**问题描述：** 设置页面的对话框（modal）点击背景区域会自动关闭，用户容易误操作丢失正在编辑的内容。

**修复内容：**
- 移除 [`SettingsView.vue`](../frontend/src/views/SettingsView.vue) 中所有 6 个对话框的 `@click.self` 事件处理器
  - Provider 添加/编辑对话框
  - Model 添加/编辑对话框
  - Provider 删除确认对话框
  - Model 删除确认对话框
  - Expert 添加/编辑对话框
  - Expert 删除确认对话框

**提交：** eb8cf32

---

## Sequelize 关联别名修复 ✅

**完成日期：** 2026-02-20

**问题描述：** 测试对话时报错 "provider is associated to ai_model using an alias. You must use the 'as' keyword..."

**根本原因：** Sequelize include 语句中缺少 `as` 别名，与 `models/init-models.js` 中定义的关联别名不匹配。

**修复内容：**
- [`lib/db.js`](../../lib/db.js) 中添加缺失的别名：
  - `getModelConfig`: `ai_model -> provider` 添加 `as: 'provider'`
  - `getExpertFullConfig`: `expert_skill -> skill` 添加 `as: 'skill'`
  - `getUserProfile`: `user_profile -> user` 添加 `as: 'user'`
  - `getExpertSkills`: `expert_skill -> skill` 添加 `as: 'skill'`

**提交：** ab012f3, e1335d2

---

## Sequelize include 数据扁平化修复 ✅

**完成日期：** 2026-02-20

**问题描述：**
- 发送消息时报错 "expressive model missing base_url"
- 其他使用 `include` 的查询也可能存在类似问题

**根本原因：**
Sequelize 使用 `raw: true` 时，include 的关联表数据会以扁平化前缀形式返回（如 `provider.base_url`），但代码期望的是顶层字段（如 `base_url`）。

**修复内容：**
- [`lib/db.js`](../../lib/db.js) 中所有 include 查询添加 `nest: true` 并手动扁平化：
  - `getModelConfig`: 扁平化 `provider.base_url`, `provider.api_key` 等
  - `getUserProfile`: 扁平化 `user.email`, `user.nickname`
  - `getExpertSkills`: 扁平化 `skill.name`, `skill.description` 等
  - `getExpertFullConfig`: 复用 `getExpertSkills` 避免代码重复

**提交：** c339256, 6e9ec9e

---

## 话题总结与用户画像修复 ✅

**完成日期：** 2026-02-21

**问题描述：**
1. 前20条消息没有被总结到 topics 里面去
2. user_profiles 里没有有价值信息，AI 应该在这张表留下对用户的印象

**根本原因：**
1. `processHistory()` 中 `slice(0, -10)` 在倒序数组上归档了错误的消息。`getRecentMessages` 返回的消息按 `created_at DESC` 排序（最新的在前），但 `slice(0, -10)` 去掉的是数组最后10条（最旧的），导致归档的是最新消息而非旧消息。
2. `summarizeConversation()` 的 prompt 太简单，没有引导 AI 生成有价值的用户画像。

**修复内容：**

### 1. 归档逻辑修复 ([`lib/memory-system.js`](../../lib/memory-system.js:260-286))
```javascript
// 修复前（错误）
const messagesToArchive = allMessages.slice(0, -10);

// 修复后（正确）
const messagesToArchive = allMessages.length > keepCount
  ? allMessages.slice(keepCount)  // 归档第 10 条之后的消息（较旧的）
  : [];
```

### 2. 用户画像 Prompt 改进 ([`lib/memory-system.js`](../../lib/memory-system.js:350-416))
改进 prompt，引导 AI 分析：
- 职业/身份（程序员、学生、产品经理等）
- 技术水平（初学者、中级、专家）
- 沟通风格（直接、委婉、幽默、严肃）
- 关注点/兴趣（效率、细节、创新、稳定）

### 3. Expert 表字段使用完善

| 字段 | 修复前 | 修复后 |
|------|--------|--------|
| `name` | ❌ 未使用 | ✅ 日志中显示专家名称 |
| `speaking_style` | ❌ 未使用 | ✅ 注入到 Soul 增强模板 |
| `prompt_template` | ❌ 字段名不匹配（代码用 system_prompt） | ✅ 优先使用 prompt_template |

**修改的文件：**
- [`lib/memory-system.js`](../../lib/memory-system.js) - 修复归档逻辑和总结 prompt
- [`lib/context-manager.js`](../../lib/context-manager.js) - 使用 prompt_template 和 speaking_style
- [`lib/chat-service.js`](../../lib/chat-service.js) - 使用 expert.name，添加 speakingStyle 到 Soul
- [`lib/config-loader.js`](../../lib/config-loader.js) - 添加 speakingStyle 到 Soul 配置

---

## 用户信息引导机制 ✅

**完成日期：** 2026-02-22

**需求描述：**
检查 user_profile 的更新时机。如果 profile 中缺少用户的年龄、性别、称呼等要素，能够在对话中自然地引导用户提供，但不要太明显。

**设计方案：**

### 字段分配原则
| 字段 | 存储位置 | 说明 |
|------|---------|------|
| gender | users 表 | 用户固有属性，全局一致 |
| birthday | users 表 | 用户固有属性，全局一致 |
| occupation | users 表 | 用户固有属性，全局一致 |
| location | users 表 | 用户固有属性，全局一致 |
| preferred_name | user_profiles 表 | 称呼偏好，随 expert 不同而不同 |

### 引导策略
- 每 3 轮对话最多引导一次
- 每次只引导一个缺失项
- 以自然的方式在对话中询问

**实现内容：**

### 1. 数据库变更
- [`scripts/init-database.js:104-122`](../../scripts/init-database.js:104) - users 表添加 `gender`、`birthday`、`occupation`、`location` 字段
- [`models/user.js:30-50`](../../models/user.js:30) - user 模型添加新字段

**现有数据库迁移 SQL：**
```sql
-- 用户表新增字段迁移脚本
-- 执行时间：2026-02-22
-- 说明：为 users 表添加性别、生日、职业、所在地字段

-- 添加 gender 字段（性别）
ALTER TABLE users
ADD COLUMN gender VARCHAR(16) NULL COMMENT '性别：male/female/other'
AFTER avatar;

-- 添加 birthday 字段（生日）
ALTER TABLE users
ADD COLUMN birthday DATE NULL COMMENT '生日'
AFTER gender;

-- 添加 occupation 字段（职业）
ALTER TABLE users
ADD COLUMN occupation VARCHAR(128) NULL COMMENT '职业'
AFTER birthday;

-- 添加 location 字段（所在地）
ALTER TABLE users
ADD COLUMN location VARCHAR(128) NULL COMMENT '所在地'
AFTER occupation;

-- 验证字段添加成功
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'users'
AND COLUMN_NAME IN ('gender', 'birthday', 'occupation', 'location');
```

### 2. 核心逻辑
- [`lib/context-manager.js:285-370`](../../lib/context-manager.js:285) - 新增方法：
  - `checkMissingUserInfo()` - 检查缺失的用户信息
  - `generateUserInfoGuidance()` - 生成自然引导提示
  - `enhanceWithUserInfoGuidance()` - 注入到 System Prompt

- [`lib/memory-system.js:125-175`](../../lib/memory-system.js:125) - 新增 `updateUserInfo()` 方法
- [`lib/memory-system.js:428-495`](../../lib/memory-system.js:428) - 对话总结时提取用户信息（gender、age、preferredName、occupation、location）

### 3. 数据访问层
- [`lib/db.js:283-315`](../../lib/db.js:283) - `getUserProfile()` 包含所有新字段
- [`lib/db.js:375-430`](../../lib/db.js:375) - 新增用户信息更新方法：
  - `updateUserProfilePreferredName()`
  - `updateUserGender()`
  - `updateUserBirthday()`
  - `updateUserOccupation()`
  - `updateUserLocation()`

---

## Expert JSON 字段多重转义修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
编辑 Expert 时，`core_values`、`behavioral_guidelines`、`taboos` 三个字段在多次保存后出现多重转义问题：
- 第一次保存：`["item1", "item2"]`
- 第二次保存：`"[\"item1\", \"item2\"]"`
- 第三次保存：`"\"[\\\"item1\\\", \\\"item2\\\"]\""`

**根本原因：**
1. 后端 `expert.controller.js` 的 `list` 方法没有解析 JSON 字段，直接返回了数据库中的 JSON 字符串
2. 前端收到 JSON 字符串后，在保存时又进行了 `JSON.stringify()`，导致多重转义
3. 数据库字段类型为 `JSON`，强制要求有效的 JSON 格式，无法存储纯文本

**解决方案：**
将这三个字段从 JSON 数组格式改为纯文本格式，每行一条内容。

**修改内容：**

### 1. 数据库迁移 SQL
```sql
ALTER TABLE experts MODIFY COLUMN core_values TEXT;
ALTER TABLE experts MODIFY COLUMN behavioral_guidelines TEXT;
ALTER TABLE experts MODIFY COLUMN taboos TEXT;
```

### 2. 表定义更新 ([`scripts/init-database.js:61-63`](../../scripts/init-database.js:61))
```javascript
// 修复前
core_values JSON,
behavioral_guidelines JSON,
taboos JSON,

// 修复后
core_values TEXT,
behavioral_guidelines TEXT,
taboos TEXT,
```

### 3. 后端 Controller ([`server/controllers/expert.controller.js`](../../server/controllers/expert.controller.js))
- 移除 `JSON.parse()` 和 `JSON.stringify()` 调用
- 直接存储和返回纯文本

### 4. 前端组件 ([`frontend/src/views/SettingsView.vue`](../../frontend/src/views/SettingsView.vue))
- 移除 `arrayToText()` 和 `textToArray()` 辅助函数
- 直接使用字符串绑定 textarea

### 5. 初始数据格式 ([`scripts/init-database.js:298-300`](../../scripts/init-database.js:298))
```javascript
// 修复前
core_values: JSON.stringify(['真诚待人，不欺骗', '尊重对方的选择和边界', '保持适度的幽默感']),

// 修复后
core_values: '真诚待人，不欺骗\n尊重对方的选择和边界\n保持适度的幽默感',
```

**技术要点：**
- MySQL 的 `JSON` 类型会自动验证输入必须是有效的 JSON 格式
- 这不是命名的 CHECK CONSTRAINT，而是数据类型本身的约束
- `DROP CONSTRAINT core_values` 无法删除该约束，必须修改字段类型

---

## 话题检测与反思话题分析 ✅

**完成日期：** 2026-02-22

**问题描述：**
系统永远只有一个话题，无法识别对话中的话题切换。即使用户从"React性能优化"突然转到"今天天气怎么样"，仍然在同一条对话记录中。

**根本原因：**
1. `getOrCreateActiveTopic()` 只要找到 `status: 'active'` 的话题就会复用，永远不会自动创建新话题
2. 历史归档 `processHistory()` 只是将旧消息关联到 Topic，不会改变当前活跃话题
3. 没有检测"用户切换话题"的逻辑

**解决方案：**
实现 LLM 实时话题检测机制，在每次用户发送消息时判断是否发生了话题切换。

### 1. 新增话题检测模块 ([`lib/topic-detector.js`](../../lib/topic-detector.js))

核心功能：
- `detectTopicShift()` - 检测是否应该切换话题
- 输入：当前话题信息 + 最近消息 + 新消息
- 输出：`{ shouldSwitch, confidence, reason, suggestedTitle }`

触发条件：
- 当前话题至少有 6 条消息（3轮对话）
- LLM 判断置信度 >= 0.7 时切换话题

### 2. 集成话题切换逻辑 ([`lib/chat-service.js`](../../lib/chat-service.js))

新增方法：
- `checkAndHandleTopicShift()` - 检测并处理话题切换
  - 获取当前活跃话题
  - 调用 TopicDetector 检测
  - 如果需要切换：归档旧话题 → 创建新话题
- `createNewTopic()` - 创建新话题
- `endTopic()` - 结束当前话题（标记为 archived）

修改 `streamChat()`：
- 在保存消息前检测是否需要切换话题
- 发送 SSE start 事件时包含 `is_new_topic` 字段

### 3. 反思话题分析 ([`lib/reflective-mind.js`](../../lib/reflective-mind.js))

在反思中增加话题分析维度：
- `isOnTopic` - 回复是否切题
- `topicShiftConfidence` - 话题偏移置信度 (0-1)
- `relevanceScore` - 相关性评分 (1-10)
- `reason` - 判断理由

用途：
- 作为前置话题检测的补充验证
- 评估回复是否恰当回应了用户的新方向
- 记录话题切换的合理性

### 4. 前端适配 ([`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue))

监听 SSE start 事件：
```typescript
eventSource.value.addEventListener('start', (event) => {
  const data = JSON.parse(event.data)
  if (data.is_new_topic) {
    chatStore.loadTopics({ expert_id: currentExpertId.value })
  }
})
```

### 工作流程

```
用户发送消息
    ↓
获取专家服务
    ↓
检测话题切换
    ├─ 消息数 < 6？→ 继续当前话题
    └─ 调用 LLM 检测
        ├─ 置信度 < 0.7 → 继续当前话题
        └─ 置信度 >= 0.7 → 切换话题
            ├─ 归档旧话题（status: archived）
            └─ 创建新话题（使用建议标题）
    ↓
保存消息 → 生成回复
    ↓
异步反思（包含话题分析）
```

**提交：** 84a939d

---

## Expert 和 Skill ID 生成机制统一修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
Expert 和 Skill 的 ID 生成没有按照项目规范使用统一的 `Utils.newID()` 方法，而是使用了不一致的手动拼接方式。

**问题代码：**
```javascript
// expert.controller.js:105
const id = `expert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// skill.controller.js:184, 282
const id = skillData.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

**修复内容：**

### 1. Expert Controller ([`server/controllers/expert.controller.js:105`](../../server/controllers/expert.controller.js:105))
```javascript
// 修复前
const id = `expert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 修复后
const id = Utils.newID(20);
```

### 2. Skill Controller ([`server/controllers/skill.controller.js:184, 282`](../../server/controllers/skill.controller.js:184))
```javascript
// 修复前
const id = skillData.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 修复后
const id = skillData.id || Utils.newID(20);
```

**`Utils.newID()` 的优势：**
- 前 8 位使用时间戳（36进制），便于数据库排序
- 使用 `crypto.randomBytes()` 生成加密安全的随机数
- 与项目其他模块（topic、provider、model）保持一致

**相关代码：**
- [`lib/utils.js:13-24`](../../lib/utils.js:13) - Utils.newID() 实现
- [`server/controllers/topic.controller.js:119`](../../server/controllers/topic.controller.js:119) - 正确用法示例
- [`server/controllers/provider.controller.js:111`](../../server/controllers/provider.controller.js:111) - 正确用法示例
- [`server/controllers/model.controller.js:124`](../../server/controllers/model.controller.js:124) - 正确用法示例

---

## 流式模式工具调用累积修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
在流式模式下，LLM 返回的 `tool_calls` 是增量（delta）格式，每个 chunk 只包含部分信息，需要累积才能得到完整的工具调用。

**根本原因：**
`llm-client.js` 的 `callStream()` 方法中，`onToolCall` 回调只在 `data === '[DONE]'` 时触发，但有些 LLM 可能不会发送 `[DONE]` 事件，导致工具调用丢失。

**修复内容：**

### 1. 流式工具调用累积 ([`lib/llm-client.js:446-539`](../../lib/llm-client.js:446))
```javascript
// 累积工具调用（按 index 累积）
let accumulatedToolCalls = {};

res.on('data', (chunk) => {
  // ...
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      if (!accumulatedToolCalls[idx]) {
        accumulatedToolCalls[idx] = { index: idx, function: {} };
      }
      // 累积各个字段
      if (tc.id) accumulatedToolCalls[idx].id = tc.id;
      if (tc.function?.name) accumulatedToolCalls[idx].function.name = tc.function.name;
      if (tc.function?.arguments) {
        accumulatedToolCalls[idx].function.arguments +=
          (accumulatedToolCalls[idx].function.arguments || '') + tc.function.arguments;
      }
    }
  }
});

// 在 [DONE] 和 res.on('end') 时都处理累积的工具调用
```

### 2. 工具调用收集修复 ([`lib/chat-service.js:147-156`](../../lib/chat-service.js:147))
```javascript
onToolCall: (toolCalls) => {
  // toolCalls 是数组，需要展开添加
  if (Array.isArray(toolCalls)) {
    collectedToolCalls.push(...toolCalls);
  } else {
    collectedToolCalls.push(toolCalls);
  }
}
```

---

## 多轮工具调用支持 ✅

**完成日期：** 2026-02-22

**问题描述：**
工具执行后，系统在 messages 里留下一个 content 为空的记录，没有返回任何消息。工具执行完成后没有把结果交给 LLM 处理。

**根本原因：**
1. 原代码只支持单轮工具调用，执行完工具后直接保存空内容
2. 如果 LLM 决定再次调用工具，没有循环处理机制

**解决方案：**
实现多轮工具调用循环，最多支持 20 轮。

**修复内容：**

### 多轮工具调用循环 ([`lib/chat-service.js:112-210`](../../lib/chat-service.js:112))
```javascript
const MAX_TOOL_ROUNDS = 20;  // 最大工具调用轮数

let currentMessages = [...context.messages];

for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
  let collectedToolCalls = [];
  let roundContent = '';

  // 流式调用 LLM
  await expertService.llmClient.callStream(modelConfig, currentMessages, {
    tools,
    onDelta: (delta) => { roundContent += delta; fullContent += delta; },
    onToolCall: (toolCalls) => { collectedToolCalls.push(...toolCalls); },
  });

  // 如果没有工具调用，退出循环
  if (collectedToolCalls.length === 0) break;

  // 执行工具
  const toolResults = await expertService.handleToolCalls(collectedToolCalls, user_id);

  // 更新消息历史
  currentMessages = [
    ...currentMessages,
    { role: 'assistant', content: roundContent || null, tool_calls: collectedToolCalls },
    ...expertService.toolManager.formatToolResultsForLLM(toolResults),
  ];
}

// 如果最终没有内容，生成默认回复
if (!fullContent || fullContent.trim() === '') {
  fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
}
```

**特性：**
- 支持多轮工具调用（最多 20 轮）
- 每轮累积 LLM 返回的文本内容
- 自动退出：当 LLM 不再调用工具时退出循环
- 默认回复：如果最终没有内容，生成提示

---

## 工具结果格式化修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
`get_env_info` 工具返回的数据在根级别（`cwd`、`allowedRoots` 等），不在 `data` 字段里，导致 `formatToolResultsForLLM` 只返回空对象。

**根本原因：**
`formatToolResultsForLLM` 只取 `result.data` 字段，但某些工具返回的数据结构不同。

**修复内容：**

### 工具结果格式化 ([`lib/tool-manager.js:381-415`](../../lib/tool-manager.js:381))
```javascript
formatToolResultsForLLM(results) {
  return results.map(result => {
    const { toolCallId, toolName, duration, ...resultData } = result;
    
    // 智能判断数据结构
    let content = JSON.stringify(
      result.success !== undefined && result.data !== undefined
        ? { success: result.success, data: result.data, error: result.error }
        : resultData  // 如果没有 data 字段，使用整个结果
    );
    
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content,
    };
  });
}
```

---

## Builtin 工具路径解析修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
调用 `list_files(path: "skills")` 时返回 "Directory not found: skills"，但 skills 目录确实存在。

**根本原因：**
1. 使用 `process.cwd()` 获取根目录，但服务器启动时的工作目录可能不同
2. `safePath` 函数无法识别 "skills" 或 "work" 这样的根目录名称

**修复内容：**

### 1. 使用模块路径计算项目根目录 ([`skills/builtin/index.js:14-30`](../../skills/builtin/index.js:14))
```javascript
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // skills/builtin -> skills -> project_root

const ALLOWED_ROOTS = [
  process.env.SKILLS_ROOT || path.join(PROJECT_ROOT, 'skills'),
  process.env.WORK_ROOT || path.join(PROJECT_ROOT, 'work'),
];
```

### 2. 改进 safePath 函数 ([`skills/builtin/index.js:60-100`](../../skills/builtin/index.js:60))
```javascript
function safePath(targetPath) {
  // ...
  
  // 首先检查是否是根目录名称本身（如 "skills" 或 "work"）
  const normalizedTarget = targetPath.replace(/[/\\]$/, '');
  
  for (const root of ALLOWED_ROOTS) {
    const rootBasename = path.basename(root);
    
    // 如果传入的是根目录名称本身
    if (normalizedTarget === rootBasename) {
      resolved = root;
      break;
    }
    
    // 如果传入的路径以根目录名称开头（如 "skills/subdir"）
    if (normalizedTarget.startsWith(rootBasename + '/') || normalizedTarget.startsWith(rootBasename + '\\')) {
      const subPath = normalizedTarget.slice(rootBasename.length + 1);
      resolved = path.join(root, subPath);
      break;
    }
    
    // ...
  }
}
```

**支持的路径格式：**
- `"skills"` → 根目录本身
- `"skills/builtin"` → 子目录
- `"work"` → 工作目录
- `"work/projects"` → 工作目录子目录

---

## 流式模式 tool_calls 持久化修复 ✅

**完成日期：** 2026-02-22

**问题描述：**
在流式模式下，LLM 调用的工具记录没有被保存到数据库的 `messages.tool_calls` 字段中，导致工具调用历史丢失。

**根本原因：**
非流式模式（`chat()` 方法）在保存消息时有 `tool_calls` 处理逻辑，但流式模式（`streamChat()` 方法）没有将收集到的工具调用保存到数据库。

**修复内容：**

### 1. 收集所有轮次的工具调用 ([`lib/chat-service.js:118`](../../lib/chat-service.js:118))
```javascript
// 修复前
let fullContent = '';
let tokenCount = 0;
let currentMessages = [...context.messages];

// 修复后
let fullContent = '';
let tokenCount = 0;
let allToolCalls = [];  // 收集所有轮次的工具调用
let currentMessages = [...context.messages];
```

### 2. 每轮累积工具调用 ([`lib/chat-service.js:177-178`](../../lib/chat-service.js:177))
```javascript
// 在工具执行循环中
// 收集所有工具调用（用于保存到数据库）
allToolCalls.push(...collectedToolCalls);
```

### 3. 保存到数据库 ([`lib/chat-service.js:216-219`](../../lib/chat-service.js:216))
```javascript
// 如果有工具调用，保存到数据库
if (allToolCalls.length > 0) {
  messageOptions.tool_calls = JSON.stringify(allToolCalls);
}
```

**数据格式：**
`messages.tool_calls` 字段存储的是 JSON 字符串，遵循 OpenAI Function Calling 格式：
```json
[
  {
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "list_files",
      "arguments": "{\"path\":\"skills\"}"
    }
  }
]
```

---

## Debug 面板 Token 数显示修复 ✅

**完成日期：** 2026-02-23

**问题描述：**
Debug 面板中的 token 统计始终显示为 0，无法展示真实的 token 使用情况。

**根本原因：**
1. LLM Client 流式调用时没有设置 `stream_options: { include_usage: true }`，API 不返回 token 统计
2. chat-service.js 使用 `tokenCount++` 简单累加 delta 次数，不是真实的 token 数
3. message.controller.js 返回的消息没有将数据库 `tokens` 字段转换为前端期望的 `metadata.tokens` 格式

**修复内容：**

### 1. LLM Client 添加 usage 回调 ([`lib/llm-client.js`](../../lib/llm-client.js))
- 添加 `stream_options: { include_usage: true }` 请求流式响应的 usage 信息
- 添加 `onUsage` 回调参数
- 解析流式响应中的 `usage` 字段并回调

### 2. Chat Service 使用真实 token 数据 ([`lib/chat-service.js`](../../lib/chat-service.js))
- 将 `tokenCount` 改为 `tokenUsage` 对象存储真实的 token 使用信息
- 添加 `onUsage` 回调处理并累加多轮调用的 token 信息
- 保存消息和发送完成事件时使用真实的 token 数据

### 3. Message Controller 数据格式转换 ([`server/controllers/message.controller.js`](../../server/controllers/message.controller.js))
- 在返回消息列表时，将数据库中的 `tokens` 和 `latency_ms` 字段转换为前端期望的 `metadata` 格式

**数据流：**
```
LLM API 流式响应 
  → llm-client.js 解析 usage 字段 
    → chat-service.js 通过 onUsage 回调接收 
      → saveAssistantMessage() 保存到数据库 tokens 字段
        → message.controller.js 转换为 metadata 格式返回前端
```

**提交：** a5d5e64

---

## 移除无用的调试设置功能 ✅

**完成日期：** 2026-02-23

**问题描述：**
前端设置界面的"调试设置"标签页是一个无用的占位符功能——可以切换开关并保存，但没有任何代码实际使用这个设置。

**修复内容：**

### 移除的代码
| 文件 | 移除内容 |
|------|----------|
| `frontend/src/views/SettingsView.vue` | 调试设置标签页模板、`debugForm`、`saveDebug()` 函数 |
| `frontend/src/types/index.ts` | `UserPreference.enable_debug` 类型定义 |
| `frontend/src/stores/user.ts` | 默认 preferences 中的 `enable_debug: false` |
| `frontend/src/i18n/locales/zh-CN.ts` | `debugSettings`、`enableDebug` 等翻译键 |
| `frontend/src/i18n/locales/en-US.ts` | 对应英文翻译键 |

### 保留的功能
右侧面板的 **DebugTab 组件**（`frontend/src/components/panel/DebugTab.vue`）继续保留，它是真正有用的调试工具：
- Token 消耗统计
- 响应时间/延迟
- 模型信息
- 会话统计
- 原始消息数据查看

---

## 聊天消息加载与显示优化 ✅

**完成日期：** 2026-02-22

**问题描述：**
1. 后端获取"最近50条消息"的逻辑错误，实际返回的是最早的50条
2. "加载更多"按钮放在页面底部，用户需要滚动到底部才能加载历史消息，体验不佳
3. 消息没有显示时间戳

**根本原因：**
1. 后端使用 `ORDER BY created_at ASC` 配合 `OFFSET 0, LIMIT 50`，返回的是最早的50条消息
2. 前端 ChatView.vue 将加载按钮放在聊天区域下方
3. ChatWindow.vue 没有渲染消息时间

**修复内容：**

### 1. 后端消息获取逻辑修复 ([`server/controllers/message.controller.js:45-66`](../../server/controllers/message.controller.js:45))

```javascript
// 修复前（错误）
order: [['created_at', 'ASC']],  // 返回最早的50条

// 修复后（正确）
order: [['created_at', 'DESC']],  // 先倒序获取最新的
limit,
offset,
raw: true,
});

// 反转数组，使消息按时间正序返回（最早的在前，便于聊天界面显示）
const sortedRows = rows.reverse();
```

**修复后的行为：**
| 页码 | 修复前（错误） | 修复后（正确） |
|------|---------------|---------------|
| 第1页 | 消息 1-50（最早的） | 消息 51-100（最近的） |
| 第2页 | 消息 51-100 | 消息 1-50（更早的历史） |

### 2. "加载更多"按钮移到顶部 ([`frontend/src/components/ChatWindow.vue`](../../frontend/src/components/ChatWindow.vue))

- 移除 ChatView.vue 底部的加载按钮
- 在 ChatWindow 消息列表顶部添加加载按钮
- 支持滚动到顶部（距顶部 100px 内）时**自动触发加载**
- 加载后保持滚动位置（不会跳到顶部）

新增 Props：
- `hasMoreMessages?: boolean` - 是否有更多历史消息
- `isLoadingMore?: boolean` - 是否正在加载

新增 Emit：
- `loadMore: []` - 加载更多事件

### 3. 消息时间显示 ([`frontend/src/components/ChatWindow.vue:41-43`](../../frontend/src/components/ChatWindow.vue:41))

每条消息下方显示时间：
- 1分钟内：`刚刚`
- 1小时内：`X分钟前`
- 今天：`HH:mm`
- 昨天：`昨天 HH:mm`
- 一周内：`X天前`
- 更早：`MM-DD HH:mm`

### 4. i18n 翻译更新

**中文 ([`frontend/src/i18n/locales/zh-CN.ts:57-61`](../../frontend/src/i18n/locales/zh-CN.ts:57))：**
```typescript
loadMoreHistory: '加载更早消息',
timeJustNow: '刚刚',
timeMinutesAgo: '{n}分钟前',
timeYesterday: '昨天',
timeDaysAgo: '{n}天前',
```

**英文 ([`frontend/src/i18n/locales/en-US.ts:57-61`](../../frontend/src/i18n/locales/en-US.ts:57))：**
```typescript
loadMoreHistory: 'Load earlier messages',
timeJustNow: 'Just now',
timeMinutesAgo: '{n} min ago',
timeYesterday: 'Yesterday',
timeDaysAgo: '{n} days ago',
```

**修改的文件：**
- [`server/controllers/message.controller.js`](../../server/controllers/message.controller.js) - 修复消息获取排序逻辑
- [`frontend/src/components/ChatWindow.vue`](../../frontend/src/components/ChatWindow.vue) - 顶部加载按钮、滚动检测、时间显示
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - 移除底部加载按钮、传递新 props
- [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) - 中文翻译
- [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) - 英文翻译

---

## 专家头像功能 ✅

**完成日期：** 2026-02-23

**成果：**
- 数据库 `experts` 表添加 `avatar_base64` 和 `avatar_large_base64` 字段
- 后端 Sequelize 模型自动生成
- 前端 `types/index.ts` Expert 接口添加字段
- `SettingsView.vue` 添加头像上传功能（Base64 转换）
- `HomeView.vue` 专家卡片显示小头像
- `ChatView.vue` 聊天头部显示小头像，对话区域背景显示大头像（半透明模糊效果）
- 国际化翻译（中英文）

**设计亮点：**
- 使用 Base64 存储头像，无需文件上传服务
- 大头像作为聊天背景，opacity: 0.08 + blur(2px) 实现淡雅效果

**相关文档：**
- [tasks/expert-avatar.md](../core/tasks/expert-avatar.md)

---

## 专家 LLM 参数配置化 ✅

**完成日期：** 2026-02-23

**成果：**
- 数据库 `experts` 表添加 LLM 参数字段：`temperature`、`reflective_temperature`、`top_p`、`frequency_penalty`、`presence_penalty`
- 后端 `models/expert.js` 模型定义更新
- 后端 `lib/config-loader.js` 读取新字段
- 后端 `lib/llm-client.js` 和 `lib/reflective-mind.js` 使用配置的参数
- 前端 `types/index.ts` Expert 接口更新
- 前端 `SettingsView.vue` 添加高级参数表单
- 国际化中英文翻译

**相关文档：**
- [tasks/expert-llm-params.md](../core/tasks/expert-llm-params.md)

---

## 上下文压缩与话题总结重构 ✅

**完成日期：** 2026-02-23

**成果：**
- 重构上下文压缩机制，基于 Token 阈值触发
- 话题总结生成优化
- 用户画像更新逻辑改进

**相关文档：**
- [tasks/context-compression.md](../core/tasks/context-compression.md)
- [context-compression-design.md](../design/v2/context-compression-design.md)

---

## 对话界面左右面板可拖拽调整比例 ✅

**完成日期：** 2026-02-23

**描述：** 实现对话界面左侧聊天窗口和右侧面板之间的可拖拽分割条，允许用户自由调整两者比例。

**实现内容：**
- **可拖拽分割条**：使用 splitpanes 库实现左右面板拖拽调整
- **视觉反馈**：分割条悬停时高亮显示，带有 `⋮` 图标提示
- **宽度持久化**：调整后的比例保存到 localStorage，刷新后保持
- **默认比例**：右侧面板默认占 25%，聊天窗口占 75%

**技术方案：**
- 使用 `splitpanes` 库（Vue 生态最流行的分屏组件）
- 直接保存百分比到 localStorage，简化计算逻辑
- 移除原有的折叠功能，专注于拖拽调整

**相关文件：**
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - 集成 Splitpanes 组件
- [`frontend/src/types/splitpanes.d.ts`](../../frontend/src/types/splitpanes.d.ts) - 类型声明文件

---

## SSE 连接自动重连机制 ✅

**完成日期：** 2026-02-23

**描述：** 解决后端重启后前端无法连接的问题，实现 SSE 连接断开自动重连和 API 健康检查。

**实现内容：**
- **SSE 自动重连**：连接断开后每 3 秒自动重试，最多 10 次
- **健康检查**：每 5 秒检测后端可用性
- **智能等待**：发送消息时如后端不可用，自动等待后端恢复（最多 30 秒）
- **状态提示**：UI 显示连接状态和重连进度

**相关文件：**
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - SSE 连接管理和重连逻辑
- [`frontend/src/composables/useNetworkStatus.ts`](../../frontend/src/composables/useNetworkStatus.ts) - 网络状态检测 composable
- [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) - 中文翻译
- [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) - 英文翻译

---

## 专家头像功能 ✅

**完成日期：** 2026-02-23

**描述：** 为专家添加两种尺寸的头像支持，小头像用于日常显示，大头像用于聊天背景装饰。

**实现内容：**

### 数据库
- `experts` 表添加 `avatar_base64`（TEXT）和 `avatar_large_base64`（MEDIUMTEXT）字段
- 使用 Base64 存储而非 URL，简化部署和备份

### 图片压缩
- 新增 [`frontend/src/utils/imageCompress.ts`](../../frontend/src/utils/imageCompress.ts) 工具
- 小头像：128×128，质量 80%，限制 100KB
- 大头像：800×800，质量 70%，限制 500KB
- 自动调整尺寸、智能降质、超限拒绝

### 显示位置
| 尺寸 | 位置 |
|------|------|
| 小头像 | 专家列表卡片、聊天头部、消息头像（AI） |
| 大头像 | 消息区域背景（固定、模糊 2px、透明度 15%） |

### 修改的文件
- `models/expert.js` - 模型字段
- `scripts/init-database.js` - 初始化脚本
- `server/controllers/expert.controller.js` - API 支持
- `frontend/src/types/index.ts` - 类型定义
- `frontend/src/utils/imageCompress.ts` - 压缩工具（新增）
- `frontend/src/views/HomeView.vue` - 卡片头像
- `frontend/src/views/ChatView.vue` - 头部头像
- `frontend/src/views/SettingsView.vue` - 上传功能
- `frontend/src/components/ChatWindow.vue` - 消息头像和背景
- `frontend/src/i18n/locales/*.ts` - 国际化

**相关文档：** [tasks/expert-avatar.md](../core/tasks/expert-avatar.md)

---

## 更新代码以适配 builtin 工具迁移到 tools 目录 ✅

**完成日期：** 2026-02-24

**背景：**
用户已将内置技能从 `data/skills/builtin` 迁移到 `tools/builtin`，考虑到 skills 里面是用户自行安装的技能，分开是很有必要的。

**修改内容：**

### 1. 更新 lib/tool-manager.js
```javascript
// 修复前
const builtinPath = path.join(__dirname, '..', 'data', 'skills', 'builtin', 'index.js');

// 修复后
const builtinPath = path.join(__dirname, '..', 'tools', 'builtin', 'index.js');
```

### 2. 更新 tools/builtin/index.js
```javascript
// 修复前
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..'); // data/skills/builtin -> data/skills -> data -> project_root

// 修复后
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // tools/builtin -> tools -> project_root
```

### 3. 删除旧目录
- 删除 `data/skills/builtin/` 目录（包含 index.js 和 skill.md）

**目录结构变化：**
```
project/
├── data/
│   └── skills/          # 用户安装的技能
│       ├── installed/
│       ├── search/
│       ├── searxng/
│       └── weather/
├── tools/
│   └── builtin/         # 系统内置工具（从 data/skills/builtin 迁移过来）
│       ├── index.js
│       └── skill.md
```

---

## LLM 上下文消息顺序修复 ✅

**完成日期：** 2026-02-25

**问题描述：**
LLM 经常搞不清当前话题，把一开始的话题当作当前话题。

**根本原因：**
在 [`context-manager.js`](../../lib/context-manager.js) 的 `buildMessages()` 方法中，消息被错误地反转了：

1. [`db.getUnarchivedMessages()`](../../lib/db.js:463) 返回 `order: [['created_at', 'ASC']]` - **正序（旧→新）**
2. 但 `buildMessages()` 中的注释错误地认为返回的是 DESC 顺序，所以做了 `.reverse()`
3. 结果：消息被反转成 **新→旧** 顺序发送给 LLM

**影响：**
- LLM 收到的消息顺序是：最新消息在前，最旧消息在后
- 这导致 LLM 把一开始的话题当作当前话题（因为最早的消息在最后）

**修复内容：**

### [`lib/context-manager.js`](../../lib/context-manager.js:550)

```javascript
// 修复前（错误）
// 历史消息（按时间顺序）
// recentMessages 是从数据库获取的 DESC 顺序，需要反转
const sortedMessages = [...recentMessages].reverse();

for (const msg of sortedMessages) {
  messages.push({
    role: msg.role,
    content: msg.content,
  });
}

// 修复后（正确）
// 历史消息（按时间正序：旧→新）
// getUnarchivedMessages 返回 ASC 顺序，直接使用
for (const msg of recentMessages) {
  messages.push({
    role: msg.role,
    content: msg.content,
  });
}
```

**修复后的消息顺序：**
1. System Prompt
2. 历史消息（旧→新，正确的时间顺序）
3. 当前用户消息

---

## Debug 面板 UI 重构 ✅

**完成日期：** 2026-02-25

**描述：** 重构 Debug 面板的区域命名和布局，使其更加用户友好和清晰。

**修改内容：**

### 1. 区域名称调整
| 原名称 | 新名称 | 说明 |
|--------|--------|------|
| TOKEN 消耗 | 本次会话 | 显示最后一次 LLM 调用的 token 消耗 |
| 会话统计 | 历史总计 | 显示整个对话历史的累计数据 |
| LLM Payload | Payload | 简化名称 |
| 原始数据 | Response | 更直观的名称 |

### 2. 布局调整
- `使用模型` 区域移到顶部
- 提供商显示 `provider.name` 而不是 `provider_id`

### 3. UI 优化
- Payload 刷新按钮改为图标（🔄），放在标题行右边
- Payload 详情和 Response 都使用折叠显示，默认收起

### 4. 后端修复
- 修复 `model.controller.js` 中 `provider_name` 的获取逻辑
- 兼容处理 Sequelize 在 raw 模式下返回的数据结构

**修改的文件：**
- [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) - 中文翻译
- [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) - 英文翻译
- [`frontend/src/components/panel/DebugTab.vue`](../../frontend/src/components/panel/DebugTab.vue) - 组件重构
- [`server/controllers/model.controller.js`](../../server/controllers/model.controller.js) - provider_name 获取修复

---
