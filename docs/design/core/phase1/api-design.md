# V1 Mind Core API 设计文档

**文档状态**: 草案 v0.1
**创建日期**: 2026-02-17
**目标**: 定义 V1 阶段所有 RESTful API 接口

---

## 1. 设计原则

### 1.1 RESTful 规范

- **URL 表示资源**：使用名词复数形式，如 `/api/messages`、`/api/topics`
- **HTTP 方法表示操作**：
  - `GET` - 获取资源
  - `POST` - 创建资源
  - `PUT` - 更新资源（完整替换）
  - `PATCH` - 部分更新
  - `DELETE` - 删除资源

### 1.2 统一返回格式

```typescript
// 成功响应
{
  "code": 200,           // HTTP 状态码或业务状态码
  "message": "success",  // 提示信息
  "data": { ... },       // 业务数据（可选）
  "timestamp": 1708156800000  // 服务器时间戳（毫秒）
}

// 错误响应
{
  "code": 400,
  "message": "参数错误：用户名不能为空",
  "data": null,
  "timestamp": 1708156800000,
  "error": {             // 可选，详细错误信息（开发环境）
    "type": "ValidationError",
    "details": [...]
  }
}
```

### 1.3 HTTP 状态码规范

| 状态码 | 使用场景 | 示例 |
|--------|---------|------|
| 200 | 操作成功 | 查询成功、更新成功 |
| 201 | 创建成功 | 用户注册、专家创建 |
| 204 | 无内容返回 | 删除成功 |
| 400 | 请求参数错误 | 缺少必填字段、格式错误 |
| 401 | 未认证 | Token 过期、未登录 |
| 403 | 无权限 | 普通用户访问管理接口 |
| 404 | 资源不存在 | 用户不存在、专家不存在 |
| 409 | 资源冲突 | 用户名已存在 |
| 422 | 业务逻辑错误 | 密码强度不足 |
| 429 | 请求过于频繁 | 限流触发 |
| 500 | 服务器内部错误 | 数据库连接失败 |

---

## 2. API 列表

### 2.1 认证相关 (Auth)

```yaml
POST   /api/auth/login              # 登录
POST   /api/auth/logout             # 登出
POST   /api/auth/refresh            # 刷新 Token
POST   /api/auth/register           # 注册
GET    /api/auth/me                 # 获取当前用户信息
```

### 2.2 用户相关 (Users)

```yaml
GET    /api/users                   # 用户列表（管理员）
GET    /api/users/:id               # 获取用户详情
PUT    /api/users/:id               # 更新用户信息
DELETE /api/users/:id               # 删除用户（管理员）
PUT    /api/users/:id/role          # 修改用户角色（管理员）
```

### 2.3 消息相关 (Messages)

```yaml
GET    /api/messages?expert_id={id}&limit=20&before={msg_id}
                                    # 获取消息历史（分页）
GET    /api/messages/:id            # 获取单条消息详情
                                    # 返回：content, inner_voice, tool_calls, tokens, timestamp
DELETE /api/messages?expert_id={id} # 清空与某专家的历史
```

### 2.3.1 聊天相关 (Chat)

```yaml
POST   /api/chat                    # 发送消息给 Expert
                                    # Body: { content, expertId, modelId? }
                                    # 返回: { message: "消息已发送", topicId }
GET    /api/chat/stream?expertId={id}&token={token}
                                    # SSE 订阅 Expert 的消息流
```

**设计理念：**
- 用户与 **Expert** 对话，不是与 Topic 对话
- Topic 由后端自动管理，通过 SSE 事件通知前端刷新
- `POST /api/chat` 发送消息（content 在 body 中，安全）
- `GET /api/chat/stream` SSE 订阅 Expert（只订阅，不传消息内容）

**消息对象结构：**
```typescript
interface Message {
  id: string;
  expert_id: string;
  user_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  inner_voice?: {        // 内心独白（仅 assistant 消息有）
    observation: string; // 观察
    evaluation: string;  // 评价
    emotion: string;     // 情感
  };
  tool_calls?: Array<{   // 工具调用
    name: string;
    params: object;
    result?: object;
  }>;
  topic_id?: string;     // 所属 Topic
  tokens?: number;       // Token 数量
  timestamp: string;     // ISO 8601 格式
}
```

### 2.4 Topic 相关 (Topics)

```yaml
GET    /api/topics?expert_id={id}   # 获取 Topic 列表
POST   /api/topics                  # 创建新 Topic
GET    /api/topics/:id              # 获取 Topic 详情
PUT    /api/topics/:id              # 更新 Topic
DELETE /api/topics/:id              # 删除 Topic
POST   /api/topics/:id/messages     # 将消息归档到 Topic
                                    # Body: { message_ids: string[] }
GET    /api/topics/:id/messages     # 获取 Topic 下的消息
```

**Topic 对象结构：**
```typescript
interface Topic {
  id: string;
  expert_id: string;
  user_id: string;
  name: string;
  description?: string;
  category?: string;
  start_time?: string;
  end_time?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}
```

### 2.5 用户画像相关 (User Profiles)

```yaml
GET    /api/user-profiles?expert_id={id}
                                    # 获取当前用户在某专家前的画像
PUT    /api/user-profiles?expert_id={id}
                                    # 更新用户画像（用户自己编辑）
```

**User Profile 对象结构：**
```typescript
interface UserProfile {
  user_id: string;
  expert_id: string;
  preferred_name: string;    // 用户希望被称呼的名字
  introduction: string;      // 自我介绍
  background: string;        // 背景信息
  notes?: string;            // 专家观察笔记
  first_met?: string;        // 首次对话时间
  last_active?: string;      // 最后活跃时间
}
```

### 2.6 专家相关 (Experts)

```yaml
GET    /api/experts                 # 获取专家列表（广场）
GET    /api/experts/:id             # 获取专家详情
                                    # 返回：性格、价值观、禁忌等
GET    /api/experts/:id/stats       # 获取与某专家的对话统计
                                    # 返回：消息数、token 消耗、对话时长等
```

**Expert 对象结构：**
```typescript
interface Expert {
  id: string;
  name: string;
  introduction: string;
  speaking_style: string;
  core_values: string[];
  behavioral_guidelines: string[];
  taboos: string[];
  emotional_tone: string;
  expressive_model: string;  // 表达模型 ID
  reflective_model: string;  // 反思模型 ID
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

### 2.7 专家技能相关 (Expert Skills)

```yaml
GET    /api/expert-skills?expert_id={id}
                                    # 获取某专家启用的技能列表
GET    /api/expert-skills/:id       # 获取技能详情
```

**Expert Skill 对象结构：**
```typescript
interface ExpertSkill {
  id: string;
  expert_id: string;
  skill_id: string;
  skill_name: string;
  skill_description: string;
  is_enabled: boolean;
  config?: object;           // 技能特定配置
}
```

### 2.8 工作室相关 (Studio)

```yaml
# 我的专家
GET    /api/studio/experts          # 获取我的专家列表
POST   /api/studio/experts          # 创建专家
GET    /api/studio/experts/:id      # 获取我的专家详情
PUT    /api/studio/experts/:id      # 更新专家
DELETE /api/studio/experts/:id      # 删除专家
POST   /api/studio/experts/:id/publish
                                    # 发布专家

# 我的技能
GET    /api/studio/skills           # 获取我的技能列表
POST   /api/studio/skills           # 创建技能
GET    /api/studio/skills/:id       # 获取技能详情
PUT    /api/studio/skills/:id       # 更新技能
DELETE /api/studio/skills/:id       # 删除技能
POST   /api/studio/skills/:id/test  # 测试技能
```

### 2.9 管理后台相关 (Admin)

```yaml
# 统计数据
GET    /api/admin/stats             # 平台统计数据
GET    /api/admin/metrics           # 性能指标
GET    /api/admin/logs              # 系统日志

# 提供商管理
GET    /api/admin/providers         # 提供商列表
POST   /api/admin/providers         # 创建提供商
PUT    /api/admin/providers/:id     # 更新提供商
DELETE /api/admin/providers/:id     # 删除提供商

# 模型管理
GET    /api/admin/models            # 模型列表
POST   /api/admin/models            # 创建模型
PUT    /api/admin/models/:id        # 更新模型
DELETE /api/admin/models/:id        # 删除模型

# 技能管理
GET    /api/admin/skills            # 技能列表
POST   /api/admin/skills            # 创建技能
PUT    /api/admin/skills/:id        # 更新技能
DELETE /api/admin/skills/:id        # 删除技能

# 话题管理
GET    /api/admin/topics            # 话题列表
GET    /api/admin/topics/:id        # 话题详情
DELETE /api/admin/topics/:id        # 删除话题

# 专家管理
GET    /api/admin/experts           # 所有专家（管理）
PUT    /api/admin/experts/:id/status
                                    # 审核专家
DELETE /api/admin/experts/:id       # 删除专家
```

### 2.10 SSE 流式接口

```yaml
GET    /api/chat/stream?expertId={id}&token={token}
                                    # SSE 订阅 Expert 的消息流
```

**设计理念：**
- SSE 只用于**订阅**，不传递消息内容
- 消息内容通过 `POST /api/chat` 发送
- 前端订阅 Expert，不是订阅 Topic
- Topic 由后端自动管理

**SSE 事件类型：**

```
event: connected
data: {"status": "connected", "expertId": "exp_123"}

event: start
data: {"topicId": "topic_456"}

event: delta
data: {"content": "你好"}

event: delta
data: {"content": "！"}

event: tool_call
data: {"tool": "weather", "params": {"city": "上海"}}

event: delta
data: {"content": "上海今天天气晴朗..."}

event: complete
data: {"content": "你好！上海今天天气晴朗...", "usage": {"prompt": 100, "completion": 50}, "model": "gpt-4"}

event: topic_updated
data: {"topicId": "topic_456"}

event: error
data: {"message": "处理失败"}
```

**事件说明：**
| 事件 | 说明 |
|------|------|
| `connected` | SSE 连接成功 |
| `start` | 开始处理消息，返回 topicId |
| `delta` | 流式内容片段 |
| `tool_call` | 工具调用信息 |
| `complete` | 处理完成，返回完整内容 |
| `topic_updated` | Topic 列表已更新，通知前端刷新 |
| `error` | 错误信息 |

---

## 3. 权限矩阵

| API | 普通用户 | 创作者 | 管理员 |
|-----|---------|--------|--------|
| `/api/auth/*` | ✅ | ✅ | ✅ |
| `/api/users` (list) | ❌ | ❌ | ✅ |
| `/api/users/:id` (get/update) | 仅自己 | 仅自己 | ✅ |
| `/api/messages/*` | ✅ | ✅ | ✅ |
| `/api/topics/*` | ✅ | ✅ | ✅ |
| `/api/user-profiles/*` | ✅ | ✅ | ✅ |
| `/api/experts` (list) | ✅ | ✅ | ✅ |
| `/api/experts/:id` | ✅ | ✅ | ✅ |
| `/api/expert-skills/*` | ✅ | ✅ | ✅ |
| `/api/studio/*` | ❌ | ✅ | ✅ |
| `/api/admin/*` | ❌ | ❌ | ✅ |

---

## 4. 分页规范

列表接口统一支持分页参数：

```
GET /api/messages?expert_id=eric&page=1&pageSize=20
```

返回格式：
```typescript
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [...],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 156,
      "totalPages": 8
    }
  },
  "timestamp": 1708156800000
}
```

---

## 5. 筛选与排序

通用筛选参数：

```
GET /api/messages?expert_id=eric&before=msg_123&limit=20
GET /api/topics?expert_id=eric&category=生活
GET /api/experts?is_active=true
```

排序参数：

```
GET /api/messages?sort=timestamp&order=desc
GET /api/topics?sort=updated_at&order=desc
```

---

## 附录：前端调用示例

### 获取消息历史

```typescript
// utils/request.ts
import axios from 'axios';

const request = axios.create({
  baseURL: '/api',
  timeout: 30000
});

// 请求拦截器：自动添加 Token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 使用示例
async function getMessages(expertId: string, before?: string) {
  const { data } = await request.get('/messages', {
    params: { expert_id: expertId, limit: 20, before }
  });
  return data.data;
}
```

### SSE 流式接收

```typescript
// 1. 建立 SSE 连接到 Expert
function connectToExpert(expertId: string, token: string) {
  const sseUrl = `/api/chat/stream?expertId=${expertId}&token=${encodeURIComponent(token)}`;
  const eventSource = new EventSource(sseUrl);
  
  eventSource.addEventListener('connected', (event) => {
    console.log('SSE connected:', event.data);
  });
  
  eventSource.addEventListener('delta', (event) => {
    const data = JSON.parse(event.data);
    // 追加内容到消息
    appendMessageContent(data.content);
  });
  
  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    // 消息完成
    finalizeMessage(data.content, data.usage);
  });
  
  eventSource.addEventListener('topic_updated', (event) => {
    // 刷新 Topic 列表
    loadTopics();
  });
  
  return () => eventSource.close();
}

// 2. 发送消息（POST）
async function sendMessage(content: string, expertId: string, token: string) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ content, expertId }),
  });
  
  return response.json();
}

// 3. 使用示例
const token = localStorage.getItem('access_token');

// 先建立 SSE 连接
const disconnect = connectToExpert('exp_123', token);

// 发送消息
await sendMessage('你好！', 'exp_123', token);
// 响应将通过 SSE 接收

// 清理连接
disconnect();
```
