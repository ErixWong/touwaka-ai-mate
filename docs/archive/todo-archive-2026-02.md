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
