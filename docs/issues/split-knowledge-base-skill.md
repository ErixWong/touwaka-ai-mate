# 拆分 knowledge-base 技能为两个独立技能

## 背景

当前 `knowledge-base` 技能混合了两种不同的使用场景：

1. **知识管理**：创建/更新/删除知识库、文章、知识点（知识专家使用）
2. **知识检索**：搜索和查询知识点（普通专家/用户使用）

这导致了以下问题：
- 权限边界不清晰
- 技能职责不单一
- 使用 `INTERNAL_SECRET` 内部认证机制（绕过了正常的用户认证）

## 架构决策：Skill 调用 API vs 直接操作数据库

### 决策：Skill 应该调用 API

经过分析，**Skill 应该通过 API 调用执行操作**，而不是直接操作数据库。原因如下：

| 优势 | 说明 |
|------|------|
| **统一业务逻辑** | 所有验证、计算、副作用都在 API 层，不会因为绕过而导致不一致 |
| **审计日志** | API 可以记录谁在什么时候做了什么操作 |
| **权限控制** | API 层统一验证 `owner_id === userId`，技能无法绕过 |
| **数据一致性** | 触发器、钩子、缓存失效等逻辑都在 API 层 |

### 当前问题

当前使用 `INTERNAL_SECRET` 是一种"后门"认证：
- 技能没有用户的真实 Token
- 用内部密钥 + `X-User-Id` 绕过认证
- 无法追踪到具体的用户会话
- 审计日志不完整

### 解决方案：注入用户 Token

```
┌─────────────────────────────────────────────────────────────┐
│                      主进程 (Koa Server)                     │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │ 用户请求  │──▶│ skill-loader  │──▶│  子进程 skill   │   │
│  │ (Token)  │    │ 注入 Token    │    │  runner         │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│                                             │               │
│                         HTTP (Bearer Token) │               │
│                                             ▼               │
│                                    ┌─────────────────┐     │
│                                    │   Koa API       │     │
│                                    │ 验证 Token      │     │
│                                    │ 记录审计日志     │     │
│                                    │ 执行业务逻辑     │     │
│                                    └─────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## 现状分析

### 当前架构问题

```
knowledge-base/index.js
├── 知识库 CRUD (create_kb, update_kb, delete_kb)
├── 文章 CRUD (create_knowledge, update_knowledge, delete_knowledge)
├── 知识点 CRUD (create_point, update_point, delete_point)
├── 语义搜索 (search, search_in_knowledge, global_search)
└── 通过 HTTP 调用主进程 API（使用 INTERNAL_SECRET 认证 ❌）
```

### 权限模型

- 知识库有 `owner_id` 字段，表示所有者
- 所有操作都需要验证 `owner_id === userId`

## 解决方案

### 拆分为两个技能

#### 1. `kb-editor` - 知识库编辑技能

**目标用户**：知识专家（专门负责整理知识的 AI 专家）

**功能**：
- 创建/更新/删除知识库
- 创建/更新/删除文章
- 创建/更新/删除知识点
- 管理知识结构（树状结构）

**权限**：只能操作 `owner_id === userId` 的知识库

**实现方式**：通过 API 调用（使用注入的用户 Token）

```javascript
// 环境变量配置（由 skill-loader 自动注入）
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN;  // 用户 JWT Token

// HTTP 请求使用用户 Token 认证
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
};
```

**工具列表**：
| 工具名 | 功能 |
|--------|------|
| `list_my_kbs` | 列出我的知识库 |
| `create_kb` | 创建知识库 |
| `update_kb` | 更新知识库 |
| `delete_kb` | 删除知识库 |
| `list_knowledges` | 列出文章 |
| `get_knowledge_tree` | 获取文章树 |
| `create_knowledge` | 创建文章 |
| `update_knowledge` | 更新文章 |
| `delete_knowledge` | 删除文章 |
| `create_point` | 创建知识点 |
| `update_point` | 更新知识点 |
| `delete_point` | 删除知识点 |

#### 2. `kb-search` - 知识库检索技能

**目标用户**：所有专家（需要查询知识的 AI 专家）

**功能**：
- 语义搜索（向量相似度）
- 关键词搜索
- 获取知识点详情

**权限**：只能搜索 `owner_id === userId` 的知识库

**实现方式**：通过 API 调用（使用注入的用户 Token）

```javascript
// 环境变量配置（由 skill-loader 自动注入）
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN;  // 用户 JWT Token
```

**工具列表**：
| 工具名 | 功能 |
|--------|------|
| `list_my_kbs` | 列出我可访问的知识库 |
| `search` | 在指定知识库中语义搜索 |
| `global_search` | 全局语义搜索 |
| `get_knowledge` | 获取文章详情 |
| `get_point` | 获取知识点详情 |

### 架构改进

```
拆分前（使用 INTERNAL_SECRET）：
┌─────────────────┐
│ knowledge-base  │
│  (混合功能)      │
│       │         │
│   HTTP 回环     │
│   X-Internal-Secret ❌
│       ▼         │
│   Koa API       │
└─────────────────┘

拆分后（使用用户 Token）：
┌─────────────────┐     ┌─────────────────┐
│   kb-editor     │     │   kb-search     │
│  (知识管理)      │     │  (知识检索)      │
│       │         │     │       │         │
│   HTTP API      │     │   HTTP API      │
│   Bearer Token  │     │   Bearer Token  │
│       ▼         │     │       ▼         │
│   Koa API       │     │   Koa API       │
│   ✅ 审计日志    │     │   ✅ 审计日志    │
└─────────────────┘     └─────────────────┘
```

## 需要注入的环境变量

| 变量名 | 说明 | 来源 | 必需 |
|--------|------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | 从当前会话获取 | ✅ |
| `API_BASE` | API 基础地址 | 配置或默认 `http://localhost:3000` | ✅ |
| `USER_ID` | 用户 ID（用于日志和调试） | 从 Token 解析或 context | 可选 |

### skill-loader.js 改动

```javascript
// buildSkillEnvironment 方法需要接收用户 context
buildSkillEnvironment(skillId, config, sourcePath, scriptPath, userContext) {
  // ...
  return {
    ...systemEnv,
    SKILL_ID: skillId,
    SKILL_PATH: skillPath,
    // 注入用户 Token（从 context 获取）
    USER_ACCESS_TOKEN: userContext?.accessToken || '',
    USER_ID: userContext?.userId || '',
    API_BASE: process.env.API_BASE || 'http://localhost:3000',
    // ...
  };
}
```

### 技能代码改动

```javascript
// 移除 INTERNAL_SECRET，使用用户 Token
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_TOKEN = process.env.USER_ACCESS_TOKEN;

function httpRequest(method, path, data) {
  // ...
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${USER_TOKEN}`,  // 使用用户 Token
  };
  // ...
}
```

### 移除内部认证后门

```javascript
// server/middlewares/auth.js - 移除或限制 INTERNAL_SECRET 认证
// 技能调用应该使用正常的用户 Token 认证
```

## 实施步骤

### Phase 0: 基础设施改造（注入用户 Token）

1. 修改 `lib/skill-loader.js` 的 `buildSkillEnvironment` 方法
2. 从 context 获取用户 Token 并注入环境变量
3. 修改 `lib/tool-manager.js` 传递完整的用户 context
4. 测试 Token 注入是否正常工作

### Phase 1: 创建 kb-editor 技能

1. 创建 `data/skills/kb-editor/` 目录
2. 实现 `index.js`（使用 `USER_ACCESS_TOKEN` 调用 API）
3. 创建 `SKILL.md` 文档
4. 测试所有 CRUD 操作

### Phase 2: 创建 kb-search 技能

1. 创建 `data/skills/kb-search/` 目录
2. 实现搜索功能（使用 `USER_ACCESS_TOKEN` 调用 API）
3. 创建 `SKILL.md` 文档
4. 测试搜索功能

### Phase 3: 迁移和清理

1. 将现有专家从 `knowledge-base` 迁移到新技能
2. 标记 `knowledge-base` 为废弃
3. 移除 `INTERNAL_SECRET` 认证机制（或限制使用范围）
4. 更新文档

## 技术细节

### 审计日志

API 层可以记录：
- 操作用户（从 Token 解析）
- 操作时间
- 操作类型（创建/更新/删除）
- 操作对象（知识库ID、文章ID等）
- 来源（Web/技能调用）

### Token 生命周期

- Access Token 有效期：15分钟（当前配置）
- 技能执行时间通常在 30 秒内，Token 不会过期
- 如果 Token 过期，技能会收到 401 错误，需要用户重新发起请求

## 影响范围

- 需要更新使用 `knowledge-base` 技能的专家配置
- 需要在 `skill_parameters` 表添加数据库配置
- 可能需要更新前端的知识库管理界面（如果有）

## 验收标准

- [ ] `kb-editor` 技能可以独立完成所有知识管理操作
- [ ] `kb-search` 技能可以独立完成所有知识检索操作
- [ ] 两个技能都正确验证用户权限
- [ ] 移除对 HTTP 回环的依赖（kb-editor 必须，kb-search 可选）
- [ ] 文档更新完成

## 相关文件

- `data/skills/knowledge-base/index.js` - 当前实现
- `data/skills/skill-manager/index.js` - 参考实现（直接数据库操作）
- `server/controllers/knowledge-base.controller.js` - API 控制器
- `lib/skill-runner.js` - 技能运行器（白名单包含 mysql2）
- `lib/skill-loader.js` - 技能加载器（环境变量注入）
