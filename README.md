# Touwaka Mate (投瓦卡)

一个具备自我反思能力的 AI 专家副本系统，采用渐进式架构设计。

## 项目状态

| 版本 | 状态 | 描述 |
|------|------|------|
| **V1** | ✅ 已实现 | Mind Core / 心智核心 - 基础对话与技能系统 |
| **V2** | 🚧 开发中 | Task Orchestrator / 任务编排层 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + Sequelize |
| 数据库 | MySQL / MariaDB |
| 沙箱隔离 | Firejail (Linux) / Sandboxie (Windows) |

## 核心功能

### V1 - Mind Core (已实现)

- **二分心智架构**：Expressive Mind 生成回复，Reflective Mind 自我反思
- **多用户多专家**：用户管理、角色权限、专家配置
- **技能系统**：内置技能 + 自定义技能，支持工具调用与沙箱执行
- **记忆系统**：Topic 级语义索引，向量检索
- **沙箱执行**：用户隔离，权限控制，安全命令执行
- **流式对话**：SSE 实时响应，多模型支持

### V2 - Task Layer (设计中)

- **任务生命周期**：五阶段状态机 (NEW → ANALYSIS → PROCESS → REVIEW → DONE)
- **组织架构**：职位与专家分离 (Orchestrator/Analyst/Worker/Reviewer)
- **专家编排**：主循环调度，专家分身机制
- **沙箱池**：按需创建，闲置回收，权限继承

## 快速开始

### 1. 安装依赖

```bash
# 后端
npm install

# 前端
cd frontend && npm install
```

### 2. 配置环境

```bash
cp .env.example .env
# 编辑 .env 配置数据库连接
```

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 启动服务

```bash
# 开发模式 (同时启动前后端)
npm run dev

# 或分别启动
npm start           # 后端 :3000
npm run dev:frontend # 前端 :5173
```

## 项目结构

```
touwaka-mate-v2/
├── server/                 # 后端服务
│   ├── index.js           # 入口
│   ├── controllers/       # 控制器
│   ├── routes/            # 路由
│   └── middlewares/       # 中间件
├── lib/                    # 核心库
│   ├── chat-service.js    # 对话服务
│   ├── llm-client.js      # LLM 客户端
│   ├── memory-system.js   # 记忆系统
│   ├── skill-loader.js    # 技能加载器
│   ├── tool-manager.js    # 工具管理
│   ├── sandbox-*.js       # 沙箱执行器
│   └── ...
├── models/                 # 数据模型
├── frontend/              # Vue 3 前端
│   └── src/
│       ├── views/         # 页面
│       ├── components/    # 组件
│       ├── stores/        # Pinia 状态
│       └── api/           # API 封装
├── scripts/               # 工具脚本
├── config/                # 配置文件
├── data/                  # 数据目录
│   ├── skills/           # 技能存储
│   └── work/             # 工作文件
└── docs/                  # 文档
    ├── design/           # 设计文档
    │   ├── v1/          # V1 架构
    │   └── v2/          # V2 设计
    └── guides/          # 开发指南
```

## API 概览

| 模块 | 端点 | 说明 |
|------|------|------|
| Auth | `/api/auth/*` | 登录、注册、令牌刷新 |
| User | `/api/users/*` | 用户管理、配置 |
| Expert | `/api/experts/*` | 专家 CRUD、对话 |
| Skill | `/api/skills/*` | 技能管理、执行 |
| Topic | `/api/topics/*` | 话题管理 |
| Message | `/api/messages/*` | 消息历史 |
| Model | `/api/models/*` | AI 模型配置 |
| Provider | `/api/providers/*` | LLM 提供商配置 |
| Role | `/api/roles/*` | 角色权限管理 |

## 文档

- [V1 架构文档](docs/design/v1/README.md)
- [V2 设计总览](docs/design/v2/README.md)
- [开发指南](docs/guides/development/README.md)
- [数据库指南](docs/guides/database/README.md)

## 许可证

MIT