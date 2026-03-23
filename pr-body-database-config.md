## 变更说明

移除 `config/database.json` 和 `models/index.js`，统一从环境变量读取数据库配置。

### 删除的文件
- `config/database.json` - 不再需要配置模板文件
- `models/index.js` - 创建了独立的 Sequelize 实例，是不必要的

### 修改的文件
1. `server/index.js` - `loadDatabaseConfig()` 直接从环境变量读取，必填字段缺失时抛出错误
2. `server/controllers/role.controller.js` - 使用 `ctx.db.getModel()` 获取模型
3. `tests/check-tool-usage.js` - 直接从环境变量读取，必填字段缺失时退出
4. `scripts/check-kb.js` - 直接从环境变量读取，必填字段缺失时退出
5. `tests/tool-test.mjs` - 直接从环境变量读取，必填字段缺失时退出
6. `.env.example` / `.dockerignore` - 清理对 `config/database.json` 的引用

### 配置行为
- 有 `.env` 文件 → dotenv 加载 `.env`
- 没有 `.env` 文件 → 直接从环境变量读取
- **必填字段缺失时抛出错误，程序终止**

### 必填字段
- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

### 可选字段（有默认值）
- `DB_PORT` → 默认 3306