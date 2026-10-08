# 部署指南（Docker / Compose）

> 本文件是部署形态的**唯一入口**。此前 `docs/development/` 下没有任何文档讲 docker，
> 而实际在跑的容器定义甚至没入库——2026-10-08 补齐（见文末变更记录）。

## 1. compose 文件矩阵

仓库里有四份 compose，**按环境分工，不是彼此的副本**：

| 文件 | 适用场景 | 数据库 | 端口 | 密钥来源 | 入库 |
|---|---|---|---|---|---|
| `docker-compose.yml` | 标准一体化：compose 自带 mariadb 服务，单机全托管 / 首次体验 | compose 内置 `db` 服务 | 默认 3000 | `${VAR:-占位默认}` | 是 |
| `docker-compose.dev.yml` | **本机日常开发（本机正在用这份）**：复用宿主 mariadb，源码 bind mount，启动时自愈依赖与前端构建 | 宿主 `mariadb` 容器（外部网络 `prod`，`DB_HOST=mariadb`） | `3017:3000` | `${VAR:-本地占位}`，可用 `.env` 覆盖 | 是（2026-10-08 起） |
| `docker-compose.nas.yml` | NAS 内网部署 | 复用现有 `mariadb`（`erixProd` 网络） | `3000:3000`（局域网可访问） | `${VAR:?}` **强制注入** | 是 |
| `docker-compose.standalone.yml` | 用户自带外部 MariaDB/MySQL（1Panel 等） | 外部数据库服务 | 默认 3000 | `${VAR:?}` **强制注入** | 是 |

选哪份：本机改代码验证用 `dev`；内网常开服务用 `nas`；给外部用户/独立机器用 `standalone`；想一条命令起一整套（含库）用 `docker-compose.yml`。

## 2. 本机部署现状

- 容器 `touwaka-mate`，compose 项目 `touwaka`，配置 `docker-compose.dev.yml`
- 端口：宿主 **3017** → 容器 3000（`/api/health` 为健康检查端点）
- 代码：`bind mount` 仓库根 → `/app`，依赖走命名卷 `node_modules` / `frontend_node_modules`
- **改代码后生效方式**：`docker compose -f docker-compose.dev.yml restart app` 即可（源码是 bind mount，不需要重建镜像）
- **改了依赖才需要动卷**：卷里 `node_modules/.package-lock.json` 缺失时启动脚本才会重装
- ⚠️ 本机 `NODE_ENV=production`：裸跑 `npm install` 会**剪掉 devDependencies**（`chai`/`mocha`/`concurrently`/`sequelize-auto`），导致测试报 `Cannot find package 'chai'`；装依赖固定用 `npm install --include=dev`

## 3. 前端构建自愈（为什么启动命令那么长）

`docker-compose.dev.yml` 的启动命令不是随手写的，它修过两类真实故障，改动前务必读懂注释：

1. **依赖陈旧**：持久化卷里的旧 `node_modules` 会用旧工具链构建新源码，产物带 TDZ / MIME 等 bug → 用 `package-lock.json` 与 `node_modules/.package-lock.json` 的 mtime 比较触发重装。
2. **构建产物陈旧**：只看 `frontend/dist` 是否存在会漏掉「git pull 新代码后仍加载旧 chunk」→ 用源码 mtime 与 `dist/index.html` 比较触发重建。

另有一处 compose 插值坑已修：命令里引用容器内 shell 变量必须写 `$$VAR`，否则被 compose 提前插值成空串，会让整个前端构建分支变成死代码。

## 4. 密钥与环境变量

- 真实密钥**不入库**：`.env` 已在 `.gitignore`，模板见 `.env.example`
- `dev` / 标准版 compose 的默认值是**本地占位串**（如 `touwaka_secret`、`local-dev-secret-…`），仅供本机方便；`nas` / `standalone` 用 `${VAR:?}` 强制注入，漏填直接起不来
- 数据库账号：本机 `touwaka`@`%` 对 `touwaka_mate` 有全权限，**宿主机 `127.0.0.1:3306` 可直连**执行迁移（`node scripts/upgrade-database.js`）；只读 MCP 用的 `eric` 账号看不到 `touwaka_mate`，那只影响用 MCP 查库

## 5. 常用命令

```bash
# 本机起停
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml restart app
docker compose -f docker-compose.dev.yml logs -f app

# 也可用 COMPOSE_FILE 省去 -f
export COMPOSE_FILE=docker-compose.dev.yml

# 数据库备份 / 恢复（走宿主 mariadb，不是 compose 内置 db）
docker exec mariadb mariadb-dump -utouwaka -p"$DB_PASSWORD" touwaka_mate > backup.sql
```

> 注意：改名或改配置后首次 `up -d`，compose 可能判定配置有变而**重建容器**（连带触发依赖安装与前端构建判定）。日常只想让代码生效用 `restart app`。

## 变更记录

- 2026-10-08：原未跟踪的 `docker-compose.local.yml` 入库并改名 `docker-compose.dev.yml`；密钥改为 `${VAR:-默认}` 插值（行为不变）；新建本文件补齐 compose 矩阵与本机现状；修正 README 中错误示例文件名 `docker-compose-local.yml`。
