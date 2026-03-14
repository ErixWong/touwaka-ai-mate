# 文件预览窗口嵌入任务面板设计

> Issue: [#140](https://github.com/ErixWong/touwaka-ai-mate/issues/140)
> 创建时间: 2026-03-14
> 状态: 设计完成

## 需求背景

当前专家对话窗口中，右侧任务面板点击文件会弹出 modal 预览。这种实现有以下问题：

1. Modal 弹窗会遮挡专家对话区域，妨碍用户继续与专家交互
2. 无法同时查看文件内容和对话内容
3. 文件发生变化时无法实时看到更新
4. HTML 文件无法正确预览（相对路径资源无法加载）

## 解决方案

### 核心功能

- **嵌入式预览**：预览窗口直接在任务面板内打开，不遮挡对话区域
- **关闭按钮**：右上角显示关闭按钮，方便退出预览
- **自动刷新**：添加自动刷新按钮（间隔5秒），实时查看文件变化
- **HTML 预览支持**：支持预览 HTML 文件及其引用的本地资源

---

## 数据库设计

### task_token 表

存储预览 Token，支持追踪和撤销。

```sql
CREATE TABLE task_token (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token字符串(随机生成，非JWT)',
    task_id INT NOT NULL COMMENT '关联的任务ID',
    user_id INT NOT NULL COMMENT '创建Token的用户ID',
    expires_at DATETIME NOT NULL COMMENT '过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_token (token),
    INDEX idx_task_user (task_id, user_id),
    INDEX idx_expires_at (expires_at),
    
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务预览Token表';
```

### task_token_access_log 表

记录 Token 访问日志，包括 IP 地址。

```sql
CREATE TABLE task_token_access_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token_id INT NOT NULL COMMENT '关联的Token ID',
    file_path VARCHAR(512) NOT NULL COMMENT '访问的文件路径',
    ip_address VARCHAR(45) NOT NULL COMMENT '访问者IP地址',
    user_agent VARCHAR(512) COMMENT '浏览器User-Agent',
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_token_id (token_id),
    INDEX idx_accessed_at (accessed_at),
    
    FOREIGN KEY (token_id) REFERENCES task_token(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Token访问日志表';
```

---

## 核心设计：Token 在 URL 路径中

### 问题

HTML 中引用相对路径资源时，如何自动携带 Token？

```html
<!-- index.html -->
<img src="./assets/001.jpg">  <!-- 如何携带 token？ -->
```

### 解决方案

把 Token 放在 URL 路径中，而非查询参数！

```
URL 格式：/task-static/:token/文件路径

示例：
/task-static/a1b2c3d4e5f6.../input/index.html
/task-static/a1b2c3d4e5f6.../input/assets/001.jpg  ← 相对路径自动继承 token！
```

### 原理

1. iframe 加载 `/task-static/:token/input/index.html`
2. HTML 中的 `./assets/001.jpg` 相对于当前 URL 解析
3. 结果为 `/task-static/:token/input/assets/001.jpg`
4. Token 自动携带，无需修改 HTML 内容！

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        前端                                  │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │ 获取预览 Token   │ ←→ │ 过期前 1 分钟自动刷新 Token   │    │
│  │ POST /api/tasks/:id/preview-token                   │    │
│  └─────────────────┘    └─────────────────────────────┘    │
│           ↓                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ iframe src="/task-static/:token/input/index.html"   │    │
│  └─────────────────────────────────────────────────────┘    │
│           ↓                                                  │
│  HTML 中的 ./assets/001.jpg 自动解析为                       │
│  /task-static/:token/input/assets/001.jpg                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                        后端                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ POST /api/tasks/:id/preview-token                   │    │
│  │ - 验证用户权限                                        │    │
│  │ - 复用现有有效 Token 或创建新 Token（15分钟有效）     │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ GET /task-static/:token/*                           │    │
│  │ - 从 URL 路径解析 token                              │    │
│  │ - 查询数据库验证 token 有效性                         │    │
│  │ - 记录访问日志（IP、User-Agent）                      │    │
│  │ - 返回静态文件                                        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## API 设计

### 1. 获取预览 Token

**请求**：
```
POST /api/tasks/:id/preview-token
Authorization: Bearer <jwt_token>
```

**响应**：
```json
{
  "previewToken": "a1b2c3d4e5f6...",
  "expiresIn": 900,
  "expiresAt": "2024-01-15T10:35:00Z"
}
```

**逻辑**：
1. 验证用户有权限访问该任务
2. 检查是否有现有有效 Token（复用）
3. 如无则生成随机 Token（32字节，hex编码）
4. 存入 `task_token` 表
5. 返回 Token 信息

### 2. 刷新预览 Token

**请求**：
```
POST /api/tasks/:id/preview-token/refresh
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "oldToken": "a1b2c3d4e5f6..."
}
```

**响应**：
```json
{
  "previewToken": "new_token_here...",
  "expiresIn": 900,
  "expiresAt": "2024-01-15T10:50:00Z"
}
```

### 3. 静态文件服务

**URL 格式**：
```
GET /task-static/:token/文件路径
```

**示例**：
```
/task-static/a1b2c3d4e5f6.../input/index.html
/task-static/a1b2c3d4e5f6.../input/assets/001.jpg
```

---

## Token 配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| **有效期** | 15 分钟 | 减少刷新压力 |
| **自动刷新** | 过期前 1 分钟 | 提前刷新避免中断 |
| **Token 长度** | 64 字符（32字节 hex） | 足够安全 |
| **文件大小限制** | 50MB | 防止大文件阻塞 |
| **日志保留** | 30 天 | 平衡存储和审计需求 |

---

## 安全设计

| 安全措施 | 实现方式 |
|---------|---------|
| **用户认证** | 获取 Token 时验证 JWT |
| **任务归属检查** | 验证 `task.created_by === userId` |
| **路径穿越防护** | `path.resolve()` + `startsWith()` 检查 |
| **短期 Token** | 15 分钟有效期，自动刷新 |
| **Token 随机性** | `crypto.randomBytes(32)` 生成 |
| **Token 复用** | 避免重复创建，减少数据库写入 |
| **访问日志** | 记录 IP、User-Agent、文件路径 |
| **XSS 防护** | iframe `sandbox` 属性 |
| **文件大小限制** | 50MB 上限 |

---

## 文件类型处理

| 类型 | 支持的扩展名 | 预览方式 |
|------|------------|---------|
| **HTML** | `.html`, `.htm` | iframe 嵌入预览（静态服务） |
| **Markdown** | `.md` | 渲染为 HTML，支持 GFM |
| **Text** | `.txt`, `.csv`, `.log` | 纯文本显示 |
| **Code** | `.js`, `.ts`, `.vue`, `.py`, `.java`, `.json`, `.yaml`, `.css` 等 | 代码高亮显示 |
| **Image** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.svg` | 图片预览 |
| **PDF** | `.pdf` | iframe 嵌入预览 |
| **不支持的类型** | 其他文件 | 仅显示下载按钮 |

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `frontend/src/components/panel/TasksTab.vue` | 主要修改 |
| `frontend/src/stores/task.ts` | Token 管理 |
| `server/routes/task.routes.js` | 预览 Token API |
| `server/routes/task-static.routes.js` | 静态文件服务（新增） |
| `server/jobs/token-cleanup.js` | Token 清理任务（新增） |
| `scripts/upgrade-database.js` | 数据库迁移 |

---

## 实现清单

- [ ] 数据库迁移：创建 `task_token` 表
- [ ] 数据库迁移：创建 `task_token_access_log` 表
- [ ] 后端：预览 Token API
- [ ] 后端：静态文件服务路由
- [ ] 后端：Token 清理定时任务
- [ ] 前端：Token 管理 Store
- [ ] 前端：嵌入式预览组件
- [ ] 前端：自动刷新功能
- [ ] 前端：Token 过期自动刷新

---

*让我们一起愉快地写代码吧！ 💪✨*