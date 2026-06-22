# Touwaka Mate App Registry

这是仓库根目录 `apps/` 的说明文档，对应项目中的 App Registry 与 app 包目录。

## 目录结构

```text
apps/
├── README.md                 # 本说明文档
├── {appId}/                  # 单个 app 目录
│   ├── manifest.json         # app 元数据入口
│   ├── migrations/           # 安装/卸载数据库脚本
│   ├── tick/                 # 后台 tick 入口（可选）
│   ├── server/               # 自定义 routes / service（可选）
│   ├── frontend/             # 自定义前端组件（可选）
│   ├── handlers/             # 历史或专题处理脚本（按 app 实现决定）
│   └── states.js             # 推荐：状态语义集中定义（可选）
└── ...其他 app
```

## 如何使用

### 作为管理员

在 Touwaka Mate 管理后台：
1. 进入 Settings → 系统管理 → App 市场
2. 浏览可用 App 列表
3. 点击"安装"部署到您的实例

### 作为开发者

要创建新的 App：
1. 参考 `docs/apps/current-architecture.md` 理解平台边界
2. 参考 `docs/apps/app-generation-guide.md` 按当前实现创建 app 目录
3. 编写 `manifest.json`，按需补充 `migrations/`、`tick/`、`server/`、`frontend/`
4. 在仓库中完成开发和验证

## App 规范

当前最小要求：
- `manifest.json`：元数据、字段、视图、配置入口

按需扩展：
- `migrations/`：安装 / 卸载数据库脚本
- `tick/`：后台轮询逻辑
- `server/`：自定义 API
- `frontend/`：自定义前端能力
- `states.js`：推荐的状态语义集中定义

推荐阅读：
- [App 模块文档入口](../docs/apps/README.md)
- [当前架构总纲](../docs/apps/current-architecture.md)
- [App 生成指导手册](../docs/apps/app-generation-guide.md)
- [App 平台设计](../docs/design/app-platform/README.md)
- [历史 App 设计](../docs/apps/historical/README.md)

## 仓库地址

- GitHub: https://github.com/ErixWong/touwaka-ai-mate
- Registry Raw URL: https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps/

---

*让我们一起愉快地构建 AI 小程序生态！* 🚀
