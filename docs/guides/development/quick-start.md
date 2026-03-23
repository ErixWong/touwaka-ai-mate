# 快速开始

## 环境要求

- **Node.js** 18+
- **MySQL** 8.0+ / MariaDB
- **Python** 3.10+ (可选，用于 Python 技能支持)

## 环境配置

### 1. 克隆项目

```bash
git clone https://github.com/your-org/touwaka-mate-v2.git
cd touwaka-mate-v2
```

### 2. 安装依赖

```bash
# 后端依赖
npm install

# 前端依赖
cd frontend && npm install && cd ..
```

### 3. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下变量：

```env
# 数据库
DB_HOST=localhost
DB_PORT=3306
DB_NAME=touwaka_mate
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# 其他
API_PORT=3000
FRONTEND_URL=http://localhost:5173
```

> **注意**：LLM Provider 的 API Key 应通过前端界面配置（设置 → 服务提供商），而非环境变量。

### 4. 初始化数据库

```bash
npm run init-db
```

这会执行 `scripts/init-database.js`，创建所有表和初始数据。

### 5. 初始化核心技能

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

如果核心技能被意外删除，可运行上述命令修复。

### 6. 启动开发服务器

```bash
# 开发模式 (同时启动前后端)
npm run dev

# 或分别启动
npm start           # 后端 :3000
npm run dev:frontend # 前端 :5173
```

- **前端**：http://localhost:5173
- **后端 API**：http://localhost:3000

### 测试账号

- 邮箱：`admin@example.com`
- 密码：`password123`

---

## 目录结构

```
touwaka-mate-v2/
├── server/                 # Koa API 服务
│   ├── index.js           # 入口
│   ├── controllers/       # 业务逻辑
│   ├── routes/            # 路由定义
│   └── middlewares/       # 中间件
├── lib/                    # 核心库
│   ├── chat-service.js    # 对话服务
│   ├── expert-chat-service.js # 专家对话服务
│   ├── llm-client.js      # LLM 客户端
│   ├── memory-system.js   # 记忆系统
│   ├── reflective-mind.js # 反思心智
│   ├── skill-loader.js    # 技能加载器
│   ├── skill-runner.js    # 技能执行器
│   ├── tool-manager.js    # 工具管理
│   ├── sandbox-*.js       # 沙箱执行器
│   └── db.js              # 数据库连接
├── models/                 # Sequelize 模型（自动生成）
├── frontend/              # Vue 3 前端
│   └── src/
│       ├── views/         # 页面
│       ├── components/    # 组件
│       │   ├── panel/     # 右侧面板组件
│       │   └── Pagination.vue # 通用分页组件
│       ├── stores/        # Pinia 状态
│       └── api/           # API 封装
├── scripts/               # 工具脚本
│   ├── init-database.js   # 数据库初始化
│   ├── generate-models.js # 模型生成
│   └── init-core-skills.js # 核心技能初始化
├── config/                # 配置文件
│   ├── database.json      # 数据库配置
│   ├── firejail/          # Firejail 沙箱配置
│   └── sandboxie/         # Sandboxie 沙箱配置
├── data/                  # 数据目录
│   ├── skills/            # 技能存储
│   │   ├── file-operations/
│   │   ├── compression/
│   │   ├── http-client/
│   │   ├── skill-manager/
│   │   ├── searxng/
│   │   ├── docx/          # Word 文档处理
│   │   ├── pdf/           # PDF 处理
│   │   └── pptx/          # PPT 处理
│   └── work/              # 工作文件
└── docs/                  # 文档
    ├── design/            # 设计文档
    │   ├── v1/            # V1 架构
    │   └── v2/            # V2 设计
    ├── guides/            # 开发指南
    ├── core/              # 核心文档
    │   ├── SOUL.md        # 开发助手人设
    │   └── TODO.md        # 待办事项
    └── archive/           # 已完成任务归档
```

---

## 常用命令

```bash
# 开发
npm run dev              # 同时启动前后端
npm start                # 仅启动后端
npm run dev:frontend     # 仅启动前端

# 数据库
npm run init-db          # 初始化数据库
node scripts/generate-models.js  # 重新生成 Sequelize 模型

# 技能
node scripts/init-core-skills.js # 初始化核心技能
```

---

## 相关文档

- [编码规范](./coding-standards.md)
- [核心模块](./core-modules.md)
- [API 参考](./api-reference.md)
- [数据库指南](../database/README.md)

---

*最后更新: 2026-03-03*
