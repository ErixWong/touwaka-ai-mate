# Mind Core / 心智核心

基于数据库配置的多用户 Web 应用系统，支持多用户多专家对话、二分心智架构和技能系统。

> **架构定位**: Mind Core 是 Touwaka Mate 的 V1 版本，作为最小基础内核，专注于构建一个具备自我反思能力的智能体核心。

## 架构概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web Application (Koa + Vue 3)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  Expressive │    │  Reflective │    │   Memory    │          │
│  │    Mind     │◄──►│    Mind     │    │   System    │          │
│  │(deepseek-  │    │(glm-4-flash)│    │  (MariaDB)  │          │
│  │   chat)     │    │             │    │             │          │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘          │
│         │                  │                  │                  │
│         └──────────────────┼──────────────────┘                  │
│                            ▼                                     │
│                   ┌─────────────────┐                           │
│                   │  Context Manager │                           │
│                   │  (System+Soul+   │                           │
│                   │   Inner Voice)   │                           │
│                   └─────────────────┘                           │
│                            ▲                                     │
│         ┌──────────────────┴──────────────────┐                 │
│         ▼                                      ▼                 │
│  ┌─────────────┐                        ┌─────────────┐          │
│  │ Tool Manager│                        │    Skill    │          │
│  │ (Skills)    │                        │   Loader    │          │
│  └─────────────┘                        └─────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   MariaDB DB    │
                    │ (Shared Config) │
                    └─────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置数据库

复制环境变量示例文件：

```bash
cp .env.example .env
# 编辑 .env 填入数据库配置
```

`.env` 文件示例：

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=chat_expert
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
DEEPSEEK_API_KEY=your_api_key
```

### 3. 初始化数据库

```bash
npm run init-db
```

或使用 MySQL 命令行：

```bash
mysql -u root -p < scripts/init-database.sql
```

### 4. 插入示例数据

```sql
-- 插入 Provider
INSERT INTO providers (id, name, base_url, api_key) VALUES
('custom', 'Custom API', 'https://api.example.com/v1', 'your-api-key');

-- 插入 Models
INSERT INTO models (id, provider_id, model_name) VALUES
('deepseek-chat', 'custom', 'deepseek-chat'),
('glm-4-flash', 'custom', 'glm-4-flash');

-- 插入专家
INSERT INTO experts (id, name, introduction, core_values, emotional_tone, expressive_model, reflective_model) VALUES
('eric', 'Eric', 
 '34岁程序员，来自镇江，现在在上海B站工作。',
 '["真诚待人", "尊重对方", "保持幽默"]',
 '温和、自信',
 'deepseek-chat',
 'glm-4-flash');
```

### 5. 启动服务器

```bash
# 启动 API 服务器
npm start

# 或同时启动前端和后端（开发模式）
npm run dev
```

服务器启动后：
- API 服务器：http://localhost:3000
- 前端开发服务器：http://localhost:5173（如果使用 `npm run dev`）

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 数据库端口 | `3306` |
| `DB_USER` | 数据库用户名 | - |
| `DB_PASSWORD` | 数据库密码 | - |
| `DB_NAME` | 数据库名称 | `chat_expert` |
| `JWT_SECRET` | JWT 密钥 | - |
| `JWT_REFRESH_SECRET` | JWT 刷新密钥 | - |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | - |
| `API_PORT` | API 服务器端口 | `3000` |
| `LOG_LEVEL` | 日志级别 | `info` |

## API 接口

### 发送消息

```bash
POST /chat
Content-Type: application/json

{
  "userId": "user_001",
  "content": "你好，今天天气怎么样？"
}
```

### 获取对话历史

```bash
GET /chat/:userId/history?limit=20
```

### 获取专家信息

```bash
GET /expert
```

### 重新加载技能

```bash
POST /admin/reload-skills
```

## 项目结构

```
.
├── server/                     # Koa API 服务器
│   ├── index.js               # 主入口
│   ├── controllers/           # 控制器
│   ├── routes/                # 路由定义
│   └── middlewares/           # 中间件
├── frontend/                  # Vue 3 前端应用
│   ├── src/
│   │   ├── views/             # 页面组件
│   │   ├── components/        # 通用组件
│   │   ├── stores/            # Pinia 状态管理
│   │   ├── router/            # 路由配置
│   │   └── api/               # API 客户端
│   └── package.json
├── lib/                       # 核心库
│   ├── config-loader.js       # 配置加载器
│   ├── context-manager.js     # 上下文管理器
│   ├── db.js                  # 数据库访问层
│   ├── llm-client.js          # LLM API 客户端（双模型）
│   ├── logger.js              # 日志工具
│   ├── memory-system.js       # 记忆系统
│   ├── reflective-mind.js      # 反思心智
│   ├── skill-loader.js        # 技能加载器
│   ├── skill-runner.js        # 技能运行器
│   ├── tool-manager.js        # 工具管理器
│   └── utils.js               # 工具函数
├── scripts/
│   ├── init-database.js       # 数据库初始化脚本
│   └── seed-data.sql          # 种子数据
├── skills/                    # 技能目录
│   ├── search/                # 搜索技能
│   │   ├── index.js
│   │   └── skill.md
│   └── weather/               # 天气技能
│       ├── index.js
│       └── skill.md
├── docs/                      # 文档目录
│   ├── v1/                    # V1 架构文档
│   └── v2/                    # V2 设计文档
├── package.json
├── .env.example               # 环境变量示例
└── .gitignore
```

## 数据库表结构

| 表名 | 用途 |
|------|------|
| `providers` | LLM 提供商配置 |
| `models` | LLM 模型配置 |
| `experts` | 专家定义（Soul、模型等） |
| `skills` | 技能定义 |
| `expert_skills` | 专家-技能关联 |
| `users` | 用户账户信息 |
| `user_profiles` | 专家对用户的印象/档案 |
| `messages` | 对话消息（含 Inner Voice） |
| `topics` | 话题索引 |

## 二分心智架构

系统实现了朱利安·杰恩斯的二分心智理论：

- **Expressive Mind（表达心智）**：负责生成对话回复，使用强语言能力的模型（如 deepseek-chat）
- **Reflective Mind（反思心智）**：负责自我反思和评分，使用轻量级模型（如 glm-4-flash）

每个助手消息都会触发异步反思，生成 Inner Voice 包含：
- `selfEvaluation`: 自我评分（1-10分，四个维度）
- `nextRoundAdvice`: 下一轮建议
- `monologue`: 内心独白

## 技能系统

技能支持两种存储模式：

### 数据库模式（默认）
- 技能代码存储在 `skills` 表的 `skill_md` 和 `index_js` 字段
- 适合单实例部署

### 文件系统模式（Docker 多副本）
- 技能代码存储在 `/shared/skills/{skillId}/` 目录
- 多个专家副本共享同一套技能
- 支持动态更新，无需重启

## Docker 部署

```yaml
version: '3'
services:
  db:
    image: mariadb:10
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: chat_expert
    volumes:
      - db-data:/var/lib/mysql

  api:
    build: .
    environment:
      - DB_HOST=db
      - DB_PORT=3306
      - DB_USER=root
      - DB_PASSWORD=root
      - DB_NAME=chat_expert
    ports:
      - "3000:3000"
    depends_on:
      - db

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    depends_on:
      - api

volumes:
  db-data:
```

**注意**：当前架构为多用户 Web 应用，不再需要为每个专家创建独立容器。

## 许可证

MIT
