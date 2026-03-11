# Skill 包白名单配置

## 概述

为 Skill 执行环境添加全局包白名单配置，让管理员可以在系统设置中统一控制 Node.js 和 Python 技能可以使用的第三方包。

## 背景

当前情况：
- **Node.js 技能**: 模块白名单硬编码在 `lib/skill-runner.js` 中，无法动态配置
- **Python 技能**: 只有危险函数黑名单（`os.system`, `exec` 等），没有包白名单机制

## 设计

### 1. API 端点

#### GET /api/system/packages

列出已安装的包：

```json
{
  "node": [
    { "name": "adm-zip", "version": "0.5.16" },
    { "name": "mysql2", "version": "3.11.3" }
  ],
  "python": [
    { "name": "pdfplumber", "version": "0.10.0" },
    { "name": "python-docx", "version": "1.1.0" }
  ]
}
```

#### PATCH /api/system/settings

更新白名单配置：

```json
{
  "allowed_node_modules": ["fs", "path", "http", "https", "adm-zip", "mysql2"],
  "allowed_python_packages": ["os", "sys", "json", "pdfplumber", "python-docx"]
}
```

### 2. 系统设置存储

在 `system_settings` 表中添加：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `allowed_node_modules` | TEXT | Node.js 允许的 npm 包列表（JSON 数组） |
| `allowed_python_packages` | TEXT | Python 允许的第三方包列表（JSON 数组） |

### 3. 默认白名单

#### Node.js 默认白名单

```json
[
  "fs", "path", "url", "querystring", "crypto",
  "util", "stream", "http", "https", "zlib",
  "string_decoder", "buffer", "events", "os",
  "mysql2", "mysql2/promise"
]
```

#### Python 默认白名单

```json
[
  "os", "sys", "json", "re", "pathlib", "typing",
  "datetime", "collections", "itertools", "functools"
]
```

### 4. 前端界面

在系统设置页面添加"包白名单"配置区：

1. 从 API 获取已安装包列表
2. 提供多选下拉框，支持搜索和批量选择
3. 显示当前白名单状态（已选/未选）

## 实现计划

1. [ ] 添加 API 端点 `GET /api/system/packages`
2. [ ] 修改 `lib/skill-runner.js` 读取动态白名单
3. [ ] 添加 Python import 检查
4. [ ] 前端系统设置页面添加白名单配置区

## 关联

- Issue: #78
