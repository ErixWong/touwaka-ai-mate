# V1 UI/API 设计评审报告

**评审日期**: 2026-02-17
**评审角色**: 前端开发者
**评审对象**: `ui-design-draft.md` + `api-design.md`

---

## 一、前端设计问题

### 🔴 严重问题

#### 1. Deep Chat 与 Vue 3 集成细节缺失
**问题描述**: 文档仅提到可以用 Deep Chat，但未提供 Vue 3 的具体集成方案。

**影响**: 
- Deep Chat 官方主要提供 React 版本
- Vue 3 需要通过 Web Component 或 React wrapper 使用
- 样式定制、事件处理的差异未说明

**建议补充**:
```typescript
// Vue 3 中使用 Deep Chat 的方案
// 方案1: Web Component
import 'deep-chat';

// 方案2: 使用 @deep-chat/vue (如果官方提供)
// 方案3: 封装 React wrapper
```

#### 2. 消息历史加载策略不明确
**问题描述**: 未说明是「无限滚动」还是「分页加载」，以及加载触发时机。

**设计建议**:
```
方案A: 无限滚动（推荐）
- 用户滚动到顶部时自动加载更早消息
- 保持平滑体验，类似微信

方案B: 分页 + 加载更多按钮
- 底部显示"加载更多"按钮
- 适合消息量特别大的场景
```

#### 3. SSE 连接管理缺失
**问题描述**: 没有说明 SSE 连接的生命周期管理。

**需要补充的设计**:
- 连接断开后的重连策略（指数退避？）
- 页面切换时的连接保持或重建
- 多端登录时的冲突处理
- 网络恢复后的自动重连

---

### 🟡 中等问题

#### 4. 错误状态 UI 不完整
**当前缺失**:
| 错误场景 | 当前设计 | 建议补充 |
|---------|---------|---------|
| 网络断开 | ❌ 未提及 | Toast 提示 + 重试按钮 |
| API 限流 (429) | ❌ 未提及 | 倒计时提示 |
| Token 过期 | 仅提及跳转登录 | 静默刷新 + 失败提示 |
| 消息发送失败 | ❌ 未提及 | 消息状态标记 + 重发 |
| SSE 连接失败 | ❌ 未提及 | 自动重连 + 降级提示 |

#### 5. 消息输入功能细节不足
**缺失设计**:
- 是否支持 Markdown 输入预览？
- 是否支持多行输入（Shift+Enter 换行）？
- 输入框高度自适应？
- @提及功能（提及专家或其他用户）？

#### 6. ~~文件上传~~
**确认**: 根据需求，文件上传功能**延后讨论**，V1 阶段暂不支持。

---

#### 7. 空状态设计缺失
**场景**: 新用户首次进入，没有任何对话历史

**建议设计**:
```
┌─────────────────────────────────────┐
│                                     │
│     [欢迎插图/动画]                  │
│                                     │
│     开始你的第一次对话               │
│                                     │
│     选择一个专家，或发现更多...      │
│                                     │
│     [Eric] [Linda] [发现更多 →]     │
│                                     │
└─────────────────────────────────────┘
```

#### ~~8. 消息操作功能~~
**确认**: 根据需求，用户**不允许**以下操作：
- ❌ 撤回消息
- ❌ 修改消息
- ❌ 删除消息
- ❌ 引用回复

**保留功能**:
- ✅ 消息复制（基础功能）

---

### 🟢 低优先级问题

#### 9. 响应式断点未定义
**当前**: 仅提到"响应式适配"
**建议补充**:
```
断点定义:
- Mobile: < 768px (单栏，Bottom Sheet)
- Tablet: 768px - 1024px (双栏，隐藏右侧面板)
- Desktop: > 1024px (三栏完整布局)
```

#### 10. 主题/暗黑模式
**问题**: 未提及是否支持暗黑模式
**建议**: 在设计初期就考虑，避免后期重构

#### 11. 多语言支持 (i18n)
**问题**: 文档完全未提及多语言支持
**影响**: 如果 V1 不考虑，后续改造成本高

**建议设计**:
```typescript
// 语言配置
interface I18nConfig {
  defaultLocale: 'zh-CN' | 'en-US';
  supportedLocales: string[];
  fallbackLocale: string;
}

// 需要翻译的内容
- 界面文案（按钮、标签、提示）
- 错误消息
- 专家配置（是否支持多语言专家？）
- 日期时间格式
- 数字格式（Token 数的千分位等）
```

**推荐方案**:
- 前端: Vue I18n (`vue-i18n`)
- 后端: 错误消息也支持多语言（通过 Accept-Language Header）

**API 补充**:
```yaml
GET /api/i18n/:locale          # 获取某语言的翻译资源
GET /api/i18n/locales          # 获取支持的语言列表
```

---

## 二、API 设计遗漏

### 🔴 必须补充的 API

#### 1. 文件上传相关
```yaml
POST   /api/upload/presign        # 获取预签名上传 URL（直传 OSS/S3）
POST   /api/upload/confirm        # 上传完成后确认
GET    /api/upload/:id            # 获取上传文件信息
DELETE /api/upload/:id            # 删除上传文件
```

#### 2. 消息搜索 API
```yaml
GET /api/messages/search?q={keyword}&expert_id={id}&start_date={date}&end_date={date}
                                  # 搜索历史消息
```

#### 3. 批量操作 API
```yaml
POST /api/messages/batch-delete   # 批量删除消息
POST /api/messages/batch-archive  # 批量归档到 Topic
```

#### 4. 草稿功能 API
```yaml
GET    /api/drafts?expert_id={id} # 获取某专家的草稿
POST   /api/drafts                # 保存草稿
DELETE /api/drafts/:id            # 删除草稿
```

#### 5. 用户偏好设置 API
```yaml
GET    /api/user-preferences      # 获取用户偏好（主题、通知设置等）
PUT    /api/user-preferences      # 更新用户偏好
```

---

### 🟡 建议补充的 API

#### 6. 专家状态/可用性 API
```yaml
GET /api/experts/:id/status       # 获取专家当前状态（在线、维护中、升级中）
GET /api/experts/:id/health       # 健康检查（模型可用性）
```

#### 7. 导出功能 API
```yaml
POST   /api/export/conversation   # 导出与某专家的对话
GET    /api/export/:id/status     # 查询导出进度
GET    /api/export/:id/download   # 下载导出文件
```

#### 8. 通知/提醒 API
```yaml
GET    /api/notifications         # 获取用户通知列表
PUT    /api/notifications/:id/read # 标记已读
DELETE /api/notifications/:id     # 删除通知
GET    /api/notifications/unread-count # 获取未读数
```

#### 9. 实时在线状态 API（可选）
```yaml
GET /api/users/online-status      # 获取用户在线状态（用于"对方正在输入"等功能）
```

---

### 🟢 已有但需完善的 API

#### 10. SSE 流式接口改进建议
**当前设计**:
```yaml
GET /api/stream/messages?expert_id={id}
```

**问题**:
- 如何传递 Authorization Header？EventSource 不支持自定义 Header
- 需要在 URL 中传 token：`?expert_id={id}&token={jwt}`

**建议改为**:
```yaml
POST /api/messages/stream         # 建立 SSE 连接
Body: { expert_id: string }
Headers: Authorization: Bearer {token}

# 或保持 GET，但使用 Cookie 传递 token
GET /api/stream/messages?expert_id={id}
# 从 Cookie 读取 session/token
```

---

## 三、前后端协作问题

### 1. Token 计算时机不一致
**前端**: 使用 `gpt-tokenizer` 实时估算显示
**后端**: 精确计算后存储

**风险**: 前后端计算结果可能有差异，需要约定以哪个为准。

**建议**: 后端计算后返回给前端，前端仅用于预估。

### 2. 消息 ID 生成策略
**未明确**:
- 前端发送消息时是否预生成 ID？
- 后端返回的消息 ID 格式？
- 临时消息（发送中）与确认消息的状态转换？

### 3. 并发发送处理
**场景**: 用户快速发送多条消息
**问题**:
- SSE 流式响应如何匹配到对应的消息？
- 消息顺序如何保证？

**建议**: 每条消息返回 `request_id`，SSE 事件携带 `request_id` 用于匹配。

---

## 四、建议优先级

### P0（必须解决）
1. Deep Chat Vue 3 集成方案 ✅ 详见 [`chat-component-comparison.md`](./chat-component-comparison.md)
2. SSE 认证方案（EventSource 不支持 Header）
3. 错误状态处理设计 ✅ 详见 [`error-state-design.md`](./error-state-design.md)

### P1（强烈建议）
1. ~~消息历史加载策略~~ ✅ 确认使用**无限滚动**
2. 消息搜索 API
3. 草稿功能
4. 多语言支持 ✅ 详见 [`i18n-design.md`](./i18n-design.md)

### 已确认 V1 不支持
- ❌ 文件上传
- ❌ 消息撤回
- ❌ 消息修改
- ❌ 消息删除
- ❌ 引用回复

### P2（可以后续）
1. 暗黑模式
2. 用户偏好设置
3. 通知系统
4. 在线状态

---

## 五、补充：数据模型检查

### contacts 表 vs user_profiles API
**问题**: 数据库设计是 `contacts` 表（一对一，以 `user_id` 为主键），但 API 设计是 `/api/user-profiles`。

**建议统一**:
- API 路径改为 `/api/contacts` 与表名一致，或
- 表名改为 `user_profiles` 与 API 一致

### messages 表的 tokens 字段
**问题**: 只存储了 token 数量，但没有区分 prompt tokens 和 completion tokens。

**建议**: 如果后期需要计费统计，需要区分：
```typescript
tokens: {
  prompt: number;      // 输入 token
  completion: number;  // 输出 token
  total: number;       // 总计
}
```

---

**评审完成时间**: 2026-02-17
**下次评审建议**: 解决 P0 问题后重新评审

---

## 六、补充设计文档清单

根据评审结果，已补充以下详细设计文档：

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [`chat-component-comparison.md`](./chat-component-comparison.md) | LLM 对话组件选型对比（Deep Chat / naive-ui / 自研） | P0 |
| [`error-state-design.md`](./error-state-design.md) | 错误状态详细设计规范 | P0 |
| [`i18n-design.md`](./i18n-design.md) | 多语言支持设计规范 | P1 |

### 关键决策总结

1. **聊天组件**: 推荐 Deep Chat（通过 Web Component 在 Vue 3 中使用），备选 naive-ui 自研
2. **历史消息加载**: 确认使用 **无限滚动** 策略
3. **SSE 管理**: 后端提供 SSE 端点，前端负责连接管理（自动重连、错误处理）
4. **消息操作**: V1 **不支持**撤回、修改、删除、引用功能
5. **文件上传**: V1 **暂不支持**，后续再讨论
6. **多语言**: UI 支持中英文切换，专家内容保持中文（由 LLM 自动响应用户语言）