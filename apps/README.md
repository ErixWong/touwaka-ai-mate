# Touwaka Mate App Registry

这是 Touwaka Mate 的 App Market（小程序市场）Registry，托管在 GitHub 仓库中。

## 目录结构

```
apps/
├── index.json              # Registry 索引（本目录下所有 App 的清单）
├── README.md               # 本说明文档
├── contract-manager/     # 合同管理 App
│   ├── manifest.json       # App 元数据
│   ├── handlers/           # 处理脚本
│   └── frontend/           # 自定义组件（可选）
└── ...其他 App
```

## 如何使用

### 作为管理员

在 Touwaka Mate 管理后台：
1. 进入 Settings → 系统管理 → App 市场
2. 浏览可用 App 列表
3. 点击"安装"部署到您的实例

### 作为开发者

要创建新的 App：
1. 复制 `_template/document-app/` 模板
2. 修改 `manifest.json` 定义字段和状态
3. 实现 `handlers/` 目录下的处理脚本
4. 提交 PR 到本仓库

## App 规范

每个 App 必须包含：
- `manifest.json`：元数据、字段定义、状态流转
- `handlers/`：至少一个处理脚本（可选）
- `frontend/`：自定义组件（可选）

详见 [App Market 设计文档](../docs/design/parse3/app-market-design.md)

## 仓库地址

- GitHub: https://github.com/ErixWong/touwaka-ai-mate
- Registry Raw URL: https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps/

---

*让我们一起愉快地构建 AI 小程序生态！* 🚀
