# Touwaka Mate v2

<div align="center">

**一个具备自我反思能力的 AI 专家副本系统**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3+-4FC08D.svg)](https://vuejs.org/)

[English](#english-docs) | [中文文档](#中文文档)

</div>

---

## ✨ 核心亮点

### 🧠 双心智架构 (Dual-Mind Architecture)
独创的**表达心智 + 反思心智**架构，让 AI 具备自我反思能力：
- **Expressive Mind**：负责生成回复，与用户对话
- **Reflective Mind**：审阅对话质量，生成内心独白，持续优化表现

### 🔧 强大的技能系统
- **多语言支持**：JavaScript (Node.js vm) + Python (subprocess)
- **沙箱隔离**：本地轻量级沙箱 + 生产级 OpenSandbox 支持
- **对话式导入**：通过自然对话即可导入新技能
- **灵活配置**：支持自定义工具定义和参数

### 📚 知识库系统 (RAG)
- **多知识库支持**：用户可创建多个独立的知识库
- **智能文档处理**：文档清洗专家 + 知识整理专家协作
- **向量检索**：语义相似度搜索，支持混合检索
- **知识图谱**：自动构建知识点关联（depends_on / related_to / references）
- **Tool-based RAG**：LLM 主动调用检索工具，自主决定检索策略

### 🤖 专家托管模式
- **双专家协作**：Worker 执行 + Supervisor 监督
- **后台自主运行**：无需用户参与，任务自动推进
- **优雅终止机制**：Supervisor 通过 `shutdown_task` 技能决定任务结束
- **多轮对话循环**：自动审阅 → 反馈 → 改进 → 继续

### 🔒 两层角色安全模型
- **用户角色**：guest / user / power_user / admin - 决定权限上限
- **专家角色**：dialog / analyst / worker / reviewer - 细分访问控制
- **沙箱池管理**：按需创建，闲置回收，权限继承

### 📝 智能上下文管理
- **话题自动识别**：LLM 批量识别对话话题边界
- **渐进式压缩**：Topic 总结 + 未归档消息的分层上下文
- **向量检索**：Topic 级语义索引，精准召回历史对话

---

## 📸 界面预览

![Touwaka Mate 界面预览](docs/images/main.png)

![技能管理界面](docs/images/skill-manage.png)

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- MySQL 8.0+ / MariaDB
- (可选) Python 3.10+ - 用于 Python 技能支持

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
# 编辑 .env 填入数据库配置和 LLM API 密钥
```

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 初始化核心技能

```bash
node scripts/init-core-skills.js
```

系统依赖以下核心技能（位于 `data/skills/` 目录）：

| 技能 | 说明 |
|------|------|
| `file-operations` | 文件读写、搜索、管理 |
| `compression` | ZIP 压缩/解压 |
| `http-client` | HTTP GET/POST 请求 |
| `skill-manager` | 技能注册、删除、分配 |
| `searxng` | SearXNG 搜索集成 |
| `docx` | Word 文档处理 |
| `pdf` | PDF 处理 |
| `pptx` | PPT 处理 |

### 5. 启动服务

```bash
# 开发模式 (同时启动前后端)
npm run dev

# 或分别启动
npm start           # 后端 :3000
npm run dev:frontend # 前端 :5173
```

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + Sequelize |
| 数据库 | MySQL 8.0+ / MariaDB |
| 认证 | JWT 双 Token |
| 流式 | SSE (Server-Sent Events) |
| 沙箱 | Node.js vm + Python subprocess (本地) / OpenSandbox (生产) |

---

## 📁 项目结构

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
│   ├── skill-runner.js    # 技能执行器
│   ├── tool-manager.js    # 工具管理
│   └── sandbox-*.js       # 沙箱执行器
├── models/                 # Sequelize 数据模型
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
    ├── guides/           # 开发指南
    └── core/             # 核心文档
```

---

## 🔌 API 概览

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

---

## 📚 中文文档

### 设计文档
| 文档 | 说明 |
|------|------|
| [V2 设计总览](docs/design/v2/README.md) | Task Layer + 右侧面板设计索引 |
| [任务层设计](docs/design/v2/task-layer-design.md) | Task 生命周期、约束机制、目录结构 |
| [沙箱架构设计](docs/design/v2/sandbox-architecture.md) | 两层角色模型、SandboxPool、平台实现 |
| [上下文压缩设计](docs/design/v2/context-compression-design.md) | 话题识别、渐进式压缩、分层上下文 |
| [专家编排设计](docs/design/v2/expert-orchestration.md) | TaskOrchestrator、专家分身机制 |
| [知识库系统设计](docs/core/tasks/2026-03-03-knowledge-base/README.md) | RAG、知识图谱、文档处理流程 |
| [专家托管模式](docs/core/tasks/2026-03-03-expert-trusteeship/README.md) | 双专家协作、后台自主运行 |

### 开发指南
| 文档 | 说明 |
|------|------|
| [开发手册](docs/guides/development/README.md) | 核心模块、API 参考、编码规范 |
| [快速开始](docs/guides/development/quick-start.md) | 环境配置、启动命令 |
| [数据库指南](docs/guides/database/README.md) | 表结构、迁移脚本 |

---

## 🇺🇸 English Docs

### Design Documents
| Document | Description |
|----------|-------------|
| [V2 Design Overview](docs/design/v2/README.md) | Task Layer + Right Panel design index |
| [Task Layer Design](docs/design/v2/task-layer-design.md) | Task lifecycle, constraints, directory structure |
| [Sandbox Architecture](docs/design/v2/sandbox-architecture.md) | Two-layer role model, SandboxPool, platform implementations |
| [Context Compression](docs/design/v2/context-compression-design.md) | Topic detection, progressive compression |
| [Expert Orchestration](docs/design/v2/expert-orchestration.md) | TaskOrchestrator, expert clone mechanism |
| [Knowledge Base System](docs/core/tasks/2026-03-03-knowledge-base/README.md) | RAG, knowledge graph, document processing |
| [Expert Trusteeship Mode](docs/core/tasks/2026-03-03-expert-trusteeship/README.md) | Dual-expert collaboration, autonomous background execution |

### Development Guides
| Document | Description |
|----------|-------------|
| [Development Manual](docs/guides/development/README.md) | Core modules, API reference, coding standards |
| [Quick Start](docs/guides/development/quick-start.md) | Environment setup, startup commands |
| [Database Guide](docs/guides/database/README.md) | Table structure, migration scripts |

---

## 🗺️ Roadmap

### V1 - Mind Core ✅ (已实现)
- [x] 双心智架构 (Expressive + Reflective)
- [x] 多用户多专家系统
- [x] 技能系统 + 沙箱执行
- [x] 记忆系统 + 向量检索
- [x] 流式对话 (SSE)
- [x] Python 技能支持
- [x] 右侧多功能面板 (Topics/Debug)
- [x] 沙箱池管理 (本地开发环境)

### V2 - Task Layer 🚧 (开发中)
- [ ] 任务生命周期管理
- [ ] 专家编排 (Orchestrator)
- [ ] 知识库系统 (RAG)
- [ ] 专家托管模式
- [ ] 多平台消息通道 (QQ/Zoom)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

[MIT](LICENSE)

---

<div align="center">

**Made with ❤️ by Touwaka Team**

</div>
