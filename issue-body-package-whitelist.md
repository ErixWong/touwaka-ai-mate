## 功能描述

为 Skill 执行环境添加全局包白名单配置，让管理员可以在系统设置中统一控制 Node.js 和 Python 技能可以使用的第三方包。

## 背景

当前情况：
- **Node.js 技能**: 模块白名单硬编码在 `lib/skill-runner.js` 中，无法动态配置
- **Python 技能**: 只有危险函数黑名单（`os.system`, `exec` 等），没有包白名单机制

## 需求

### 1. API 端点

- `GET /api/system/packages` - 列出已安装的包（Node.js + Python）
- `GET/PATCH /api/system/settings` - 读取/更新白名单配置

### 2. 系统设置

在 `system_settings` 表中添加：
- `allowed_node_modules`: Node.js 允许的 npm 包列表（JSON 数组）
- `allowed_python_packages`: Python 允许的第三方包列表（JSON 数组）

### 3. 前端界面

- 系统设置页面添加"包白名单"配置区
- 从 API 获取已安装包列表，提供多选下拉框

### 4. 后端执行

修改 `lib/skill-runner.js`：
- Node.js: 从系统设置读取白名单，而非硬编码
- Python: 添加 import 检查，只允许白名单中的包

## 配置示例

```json
{
  "allowed_node_modules": ["fs", "path", "http", "https", "adm-zip", "mysql2"],
  "allowed_python_packages": ["os", "sys", "json", "pdfplumber", "python-docx"]
}
```

## 技术要点

1. Node.js 包列表: `npm list --json --depth=0`
2. Python 包列表: `pip list --format=json`
3. 白名单存储在 `system_settings` 表中
4. 默认白名单包含当前硬编码的模块列表

## 关联

- Issue: https://github.com/ErixWong/touwaka-ai-mate/issues/78
