---
name: wikijs
description: "Wiki.js 交互技能。通过 GraphQL API 和 REST 上传端点操作 Wiki.js，支持页面 CRUD、目录浏览、资源管理、搜索。当需要管理 Wiki.js 文档、内容迁移、自动化操作时触发。"
argument-hint: "[listPages|getPage|createPage|updatePage|deletePage|uploadFile] --path=xxx"
user-invocable: false
allowed-tools: []
---

# Wiki.js - Wiki 交互技能

通过 GraphQL API 和 REST 上传端点操作 Wiki.js 实例。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `listPages` | 列出所有页面 | `orderBy` |
| `getPageByPath` | 按路径获取页面 | `path`, `locale` |
| `getPageById` | 按 ID 获取页面 | `id` |
| `createPage` | 创建页面 | `path`, `title`, `content` |
| `updatePage` | 更新页面 | `id`, `content`, `title` |
| `deletePage` | 删除页面 | `id` |
| `getPageTree` | 获取页面树 | `mode`, `locale` |
| `searchPages` | 搜索页面 | `query`, `locale` |
| `uploadFile` | 上传文件 | `filePath`, `filename`, `folderId` |
| `listAssetFolders` | 列出资源文件夹 | `parentId` |
| `createAssetFolder` | 创建资源文件夹 | `name`, `slug`, `parentId` |
| `listAssets` | 列出资源 | `folderId`, `kind` |
| `deleteAsset` | 删除资源 | `id` |

## 页面操作

### listPages

列出所有页面。

**参数：**
- `orderBy` (string, optional): 排序方式，默认 'TITLE'

### getPageByPath

按路径获取页面。

**参数：**
- `path` (string, required): 页面路径
- `locale` (string, required): 语言代码，如 'en'

### createPage

创建页面。

**参数：**
- `path` (string, required): 页面路径
- `title` (string, required): 页面标题
- `content` (string, required): 页面内容（Markdown）
- `locale` (string, optional): 语言代码，默认 'en'
- `description` (string, optional): 页面描述
- `tags` (string[], optional): 标签数组
- `isPublished` (boolean, optional): 是否发布，默认 true

### updatePage

更新页面。

**参数：**
- `id` (number, required): 页面 ID
- `content` (string, optional): 新内容
- `title` (string, optional): 新标题

### deletePage

删除页面。

**参数：**
- `id` (number, required): 页面 ID

## 文件上传

### uploadFile

上传文件到 Wiki.js。

**参数：**
- `filePath` (string, required): 本地文件路径
- `filename` (string, required): 文件名
- `folderId` (number, required): 目标文件夹 ID

**返回：**
```json
{ "succeeded": true, "message": "ok" }
```

**上传格式说明：**
Wiki.js 文件上传需要**两个字段都命名为 `mediaUpload`**：
1. 第一个字段：文件夹元数据 JSON `{"folderId": 1}`
2. 第二个字段：实际文件内容

## 资源管理

### listAssetFolders

列出资源文件夹。

**参数：**
- `parentId` (number, required): 父文件夹 ID（根目录为 0）

### listAssets

列出资源。

**参数：**
- `folderId` (number, required): 文件夹 ID
- `kind` (string, optional): 资源类型 - 'ALL', 'IMAGE', 'BINARY', 'PDF', 'CODE', 'MARKUP', 'VIDEO', 'AUDIO'

## 配置要求

需要以下环境变量：
- `WIKIJS_URL` - Wiki.js 实例 URL（如 `https://wiki.example.com`）
- `WIKIJS_TOKEN` - API Token（从 Admin > API Access 获取）

## 常见上传错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| "Missing upload folder metadata" | 缺少 JSON 元数据字段 | 添加 `mediaUpload={"folderId":1}` |
| "Missing upload payload" | 缺少文件字段 | 添加文件字段 `mediaUpload` |
| "You are not authorized" | 无 `write:assets` 权限 | 检查 API Token 权限 |

## 相关技能

PPT 转 Wiki.js：使用 **ppt-to-wiki** 技能将 PowerPoint 转换为 Wiki.js 页面。
