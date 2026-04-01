# Touwaka Mate v2

<div align="center">

**一个具备自我反思能力的 AI 专家副本系统**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3+-4FC08D.svg)](https://vuejs.org/)
[![MariaDB](https://img.shields.io/badge/MariaDB-11.x-003545.svg)](https://mariadb.org/)

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
- **丰富技能库**：内置 20+ 技能，覆盖文档处理、网络请求、知识库管理等

### 📚 知识库系统 (RAG) ✅
- **多知识库支持**：用户可创建多个独立的知识库
- **层级结构**：文章(Article) → 节(Section, 无限层级) → 段(Paragraph)
- **标签系统**：灵活的标签分类，替代传统树状分类
- **知识点标记**：段落可标记为知识点，支持向量化检索
- **智能文档处理**：文档清洗专家 + 知识整理专家协作
- **向量检索**：语义相似度搜索，支持混合检索
- **Tool-based RAG**：LLM 主动调用检索工具，自主决定检索策略

### 🏢 组织架构管理 ✅
- **部门树形结构**：最多4级部门层级，支持无限扩展
- **职位管理**：职位归属部门，支持负责人标识
- **用户关联**：用户-部门-职位关联
- **权限控制**：管理员统一管理（部门负责人权限预留扩展）

### 🤖 助手系统 ✅
- **可召唤助手**：用户可创建个性化助手
- **工具绑定**：助手可绑定特定技能工具
- **系统提示词**：自定义助手行为和角色
- **多模型支持**：不同助手可使用不同 LLM

### 🔒 两层角色安全模型
- **用户角色**：guest / user / power_user / admin - 决定权限上限
- **专家角色**：dialog / analyst / worker / reviewer - 细分访问控制
- **沙箱池管理**：按需创建，闲置回收，权限继承

### 🧠 Psyche 上下文管理模式 (心神)
- **工作记忆机制**：用结构化的 Psyche JSON 替代原始消息历史，让 LLM 拥有"短期记忆"
- **双阶段处理**：反思心智生成/更新 Psyche，表达心智基于 Psyche 生成回复
- **智能压缩**：Token 超限自动触发压缩，将内容转移至 Notes 引用
- **Notes 手抄系统**：LLM 主动存取关键信息，避免重复查询历史对话
- **滑动窗口**：基于 Token 数量的动态消息截断，确保上下文不溢出

### 📝 智能上下文管理
- **话题自动识别**：LLM 批量识别对话话题边界
- **渐进式压缩**：Topic 总结 + 未归档消息的分层上下文
- **向量检索**：Topic 级语义索引，精准召回历史对话
- **话题分页**：支持大量话题的分页浏览
- **关键词搜索**：话题支持关键词搜索，快速定位历史对话

### 💾 记忆系统
- **用户档案**：专家级用户画像，记录用户背景、偏好、称呼
- **信息提取**：从对话中自动提取用户信息（职业、所在地等）
- **话题归档**：对话自动归档为话题，生成标题和摘要
- **LRU 缓存**：消息内存缓存，加速历史加载
- **Token 估算**：智能估算上下文大小，触发压缩阈值

### ⚡ 内置工具增强
- **recall 工具**：统一召回工具，整合话题搜索与消息读取
- **工具调用优化**：Content 摘要 + Tool_calls 完整存储，节省上下文空间
- **用户级参数**：技能参数支持用户级覆盖，个性化配置

---

## 📸 界面预览

![Touwaka Mate 界面预览](docs/images/main.png)

![技能管理界面](docs/images/skill-manage.png)

---

## 🚀 快速开始

### 环境要求
- Node.js 20+
- MariaDB 11.x (支持原生向量类型)
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
node scripts/init-skills-from-json.js
```

### 5. 构建前端（生产环境）

```bash
cd frontend && npm run build
```

### 6. 启动服务

```bash
# 开发模式 (同时启动前后端)
npm run dev

# 或分别启动
npm start           # 后端 :3000
npm run dev:frontend # 前端 :5173
```

---

## 🐳 Docker 部署

### 推荐方案：使用预构建镜像（快速部署）

我们推荐使用 `nikolaik/python-nodejs:python3.12-nodejs20-bullseye` 镜像，它已经预装了 Python 3.12 和 Node.js 20，无需本地构建。

```bash
# 1. 创建部署目录
mkdir touwaka-mate && cd touwaka-mate

# 2. 下载指定版本的 docker-compose 文件
# 替换 v0.2.2 为你需要的版本号
curl -L https://github.com/ErixWong/touwaka-ai-mate/releases/download/v0.2.2/docker-compose.yml -o docker-compose.yml

# 3. 创建环境配置文件
cat > .env << 'EOF'
# 数据库配置
DB_HOST=db
DB_NAME=touwaka_mate
DB_USER=touwaka
DB_PASSWORD=your_secure_password
DB_ROOT_PASSWORD=your_root_password

# JWT 密钥（必须修改！使用随机字符串）
JWT_SECRET=your_random_secret_key_here
JWT_REFRESH_SECRET=your_random_refresh_key_here

# 应用配置
PORT=3000
LOG_LEVEL=info
EOF

# 4. 启动服务
docker-compose up -d

# 5. 初始化数据库和核心技能（首次部署）
docker-compose exec app npm run init-db
docker-compose exec app node scripts/init-skills-from-json.js

# 6. 查看日志
docker-compose logs -f app
```

**访问应用**：http://localhost:3000

---

### 备选方案：本地构建镜像

如果你需要修改代码或自定义构建：

```bash
# 1. 克隆项目
git clone https://github.com/ErixWong/touwaka-ai-mate.git
cd touwaka-ai-mate

# 2. 复制环境配置
cp .env.example .env

# 3. 编辑 .env 文件，设置必要的配置
# 必须修改: JWT_SECRET, JWT_REFRESH_SECRET
# 可选修改: DB_USER, DB_PASSWORD, DB_ROOT_PASSWORD

# 4. 构建并启动服务
docker-compose up -d --build

# 5. 查看日志
docker-compose logs -f app

# 6. 初始化核心技能 (首次部署)
docker-compose exec app node scripts/init-skills-from-json.js
```

### 版本升级

使用预构建镜像部署时，升级到新版本非常简单：

```bash
# 1. 进入部署目录
cd touwaka-mate

# 2. 下载新版本的 docker-compose.yml（替换 v0.2.2 为目标版本）
curl -L https://github.com/ErixWong/touwaka-ai-mate/releases/download/v0.2.2/docker-compose.yml -o docker-compose.yml

# 3. 拉取最新镜像并重启
docker-compose pull
docker-compose up -d

# 4. 执行数据库迁移（如有需要）
docker-compose exec app node scripts/upgrade-database.js

# 5. 重新初始化核心技能（如有新技能）
docker-compose exec app node scripts/init-skills-from-json.js
```

### 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 应用端口 | `3000` |
| `DB_NAME` | 数据库名 | `touwaka_mate` |
| `DB_USER` | 数据库用户 | `touwaka` |
| `DB_PASSWORD` | 数据库密码 | `touwaka_secret` |
| `DB_ROOT_PASSWORD` | MariaDB root 密码 | `root_secret_password` |
| `JWT_SECRET` | JWT 密钥 (必须修改) | - |
| `JWT_REFRESH_SECRET` | JWT 刷新密钥 (必须修改) | - |
| `LOG_LEVEL` | 日志级别 | `info` |

### 数据持久化

以下目录会持久化到宿主机：
- `./data/` - 应用数据（技能、知识库图片、工作文件）
- MariaDB 数据使用 Docker named volume

### 常用命令

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 查看日志
docker-compose logs -f app

# 重新构建 (代码更新后)
docker-compose build --no-cache app
docker-compose up -d

# 进入容器
docker-compose exec app sh

# 备份数据库
docker-compose exec db mariadb-dump -u root -p touwaka_mate > backup.sql

# 恢复数据库
docker-compose exec -T db mariadb -u root -p touwaka_mate < backup.sql
```

### 使用自定义配置文件

如果需要使用自定义的 docker-compose 配置文件（如 `docker-compose-local.yml`）：

```bash
# 使用 -f 参数指定配置文件
docker-compose -f docker-compose-local.yml up -d
docker-compose -f docker-compose-local.yml logs -f app
docker-compose -f docker-compose-local.yml down

# 或设置环境变量简化命令
export COMPOSE_FILE=docker-compose-local.yml
docker-compose up -d  # 自动使用 docker-compose-local.yml
```

### 独立部署（使用自己的数据库）

如果你已有 MariaDB/MySQL 服务器，可以使用独立版配置：

```bash
# 1. 复制环境配置
cp .env.example .env

# 2. 编辑 .env 文件，配置你的数据库连接
# 必须修改: DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET

# 3. 使用独立版配置启动
docker-compose -f docker-compose.standalone.yml up -d

# 4. 查看日志
docker-compose -f docker-compose.standalone.yml logs -f app
```

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + Sequelize |
| 数据库 | MariaDB 11.x (支持向量类型) |
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
│   ├── kb-images/        # 知识库图片
│   └── work/             # 工作文件
└── docs/                  # 文档
    ├── design/           # 设计文档
    ├── guides/           # 开发指南
    └── core/             # 核心文档
```

---

## 🔌 内置技能

| 技能 | 说明 |
|------|------|
| `fs` | 文件读写、搜索、管理 |
| `compression` | ZIP 压缩/解压 |
| `http-client` | HTTP GET/POST 请求 |
| `skill-manager` | 技能注册、删除、分配 |
| `searxng` | SearXNG 搜索集成 |
| `docx` | Word 文档处理 |
| `pdf` | PDF 处理 |
| `pptx` | PPT 处理 |
| `xlsx` | Excel 处理（支持公式计算） |
| `kb-editor` | 知识库编辑 |
| `kb-search` | 知识库搜索 |
| `wikijs` | Wiki.js 集成 |
| `remote-llm` | 远程 LLM 调用 |
| `user-code-executor` | 用户代码执行 |
| `erix-ssh` | SSH 连接管理 |
| `recall` | 统一召回工具（话题搜索、消息读取） |

---

## 🔌 API 概览

| 模块 | 端点 | 说明 |
|------|------|------|
| Auth | `/api/auth/*` | 登录、注册、令牌刷新 |
| User | `/api/users/*` | 用户管理、配置 |
| Expert | `/api/experts/*` | 专家 CRUD、对话 |
| Assistant | `/api/assistants/*` | 助手管理、召唤 |
| Skill | `/api/skills/*` | 技能管理、执行 |
| Topic | `/api/topics/*` | 话题管理 |
| Message | `/api/messages/*` | 消息历史 |
| Model | `/api/models/*` | AI 模型配置 |
| Provider | `/api/providers/*` | LLM 提供商配置 |
| Role | `/api/roles/*` | 角色权限管理 |
| KB | `/api/kb/*` | 知识库管理 |
| Org | `/api/org/*` | 组织架构管理 |

---

## 📚 中文文档

### 设计文档
| 文档 | 说明 |
|------|------|
| [V2 设计总览](docs/design/v2/README.md) | Task Layer + 右侧面板设计索引 |
| [Psyche 上下文管理](docs/core/design/mind-context-management.md) | 心神工作记忆机制、Notes 手抄系统、上下文压缩策略 |
| [任务层设计](docs/design/v2/task-layer-design.md) | Task 生命周期、约束机制、目录结构 |
| [沙箱架构设计](docs/design/v2/sandbox-architecture.md) | 两层角色模型、SandboxPool、平台实现 |
| [上下文压缩设计](docs/design/v2/context-compression-design.md) | 话题识别、渐进式压缩、分层上下文 |
| [专家编排设计](docs/design/v2/expert-orchestration.md) | TaskOrchestrator、专家分身机制 |
| [知识库重构设计](docs/design/kb-refactor-design.md) | 新知识库结构：文章/节/段/标签 |
| [组织架构设计](docs/design/v2/org-architecture.md) | 部门树、职位管理、用户关联 |

### 开发指南
| 文档 | 说明 |
|------|------|
| [开发手册](docs/guides/development/README.md) | 核心模块、API 参考、编码规范 |
| [快速开始](docs/guides/development/quick-start.md) | 环境配置、启动命令 |
| [数据库指南](docs/guides/database/README.md) | 表结构、迁移脚本 |
| [技能开发标准](docs/guides/skill-md-standard.md) | SKILL.md 编写规范 |

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
| [KB Refactor Design](docs/design/kb-refactor-design.md) | New KB structure: Article/Section/Paragraph/Tags |
| [Organization Architecture](docs/design/v2/org-architecture.md) | Department tree, position management |

### Development Guides
| Document | Description |
|----------|-------------|
| [Development Manual](docs/guides/development/README.md) | Core modules, API reference, coding standards |
| [Quick Start](docs/guides/development/quick-start.md) | Environment setup, startup commands |
| [Database Guide](docs/guides/database/README.md) | Table structure, migration scripts |
| [Skill Development Standard](docs/guides/skill-md-standard.md) | SKILL.md writing specification |

---

## 🗺️ Roadmap

### V1 - Mind Core ✅ (已完成)
- [x] 双心智架构 (Expressive + Reflective)
- [x] 多用户多专家系统
- [x] 技能系统 + 沙箱执行
- [x] 记忆系统 + 向量检索
- [x] 流式对话 (SSE)
- [x] Python 技能支持
- [x] 右侧多功能面板 (Topics/Debug)
- [x] 沙箱池管理 (本地开发环境)

### V2 - Task Layer ✅ (已完成)
- [x] 知识库系统重构 (文章/节/段/标签)
- [x] 组织架构管理 (部门/职位)
- [x] 助手系统 (可召唤助手)
- [x] Docker 部署支持
- [x] MariaDB 向量支持

### V3 - 消息通道 🚧 (规划中)
- [ ] 任务生命周期管理
- [ ] 专家编排 (Orchestrator)
- [ ] 专家托管模式
- [ ] 部门级知识库权限控制
- [ ] 多平台消息通道 (QQ/Zoom)
- [ ] 技能市场 (技能分享、导入、评分)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 💬 技术交流

QQ群：768524453

---

## 📄 许可证

[Apache 2.0](LICENSE)

---

<div align="center">

**Made with ❤️ by Touwaka Team**

</div>
