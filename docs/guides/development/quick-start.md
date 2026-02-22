# 快速开始

## 环境配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

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

# LLM API（二选一）
OPENAI_API_KEY=sk-xxx
# 或
DEEPSEEK_API_KEY=sk-xxx

# 其他
API_PORT=3000
FRONTEND_URL=http://localhost:5173
```

### 3. 初始化数据库

```bash
npm run init-db
```

这会执行 `scripts/init-database.js`，创建所有表和初始数据。

### 4. 启动开发服务器

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000

### 测试账号

- 邮箱：`admin@example.com`
- 密码：`password123`

---

## 目录结构

```
server/           # Koa API
  controllers/    # 业务逻辑
  routes/         # 路由定义
  middlewares/    # 中间件
lib/              # 核心库
  chat-service.js # 对话服务
  llm-client.js   # LLM 客户端
  memory-system.js# 记忆系统
  reflective-mind.js # 反思心智
  db.js           # 数据库连接
  utils.js        # 工具函数
frontend/         # Vue 3 前端
  src/
    components/
      panel/      # 右侧面板组件
        RightPanel.vue    # 面板容器
        DocsTab.vue       # 文档 Tab
        TopicsTab.vue     # 话题 Tab
        DebugTab.vue      # 调试 Tab
      Pagination.vue      # 通用分页组件
    stores/
      panel.ts    # 面板状态管理
skills/           # 技能目录
models/           # Sequelize 模型（自动生成）
scripts/          # 工具脚本
  init-database.js    # 数据库初始化
  generate-models.js  # 模型生成
```

---

*最后更新: 2026-02-22*
