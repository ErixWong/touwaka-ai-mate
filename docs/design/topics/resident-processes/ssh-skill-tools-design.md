# SSH 技能工具设计文档

## 概述

本文档定义 SSH 技能的完整工具清单，包括远程命令执行（SSH）和文件传输（SFTP）。

基于 Issue #136 的需求，为 SSH 技能添加 SFTP 文件传输功能。

## 设计原则

1. **专注文件传输** - SFTP 只做文件传输，其他操作用 `ssh_exec` 完成
2. **复用现有架构** - 使用已有的 `resident://` 协议和 session_manager.js
3. **保持一致性** - 与现有 SSH 工具命名和参数风格一致

## 职责划分

| 操作类型 | 使用工具 | 说明 |
|----------|----------|------|
| 文件上传 | `sftp_upload` | 二进制文件传输 |
| 文件下载 | `sftp_download` | 二进制文件传输 |
| 列出目录 | `sftp_list` | 格式化输出，便于 LLM 理解 |
| 创建目录 | `ssh_exec` | `mkdir -p /path` |
| 删除文件 | `ssh_exec` | `rm /path/file` |
| 删除目录 | `ssh_exec` | `rm -rf /path` |
| 重命名 | `ssh_exec` | `mv old new` |
| 修改权限 | `ssh_exec` | `chmod 755 /path` |
| 查看文件信息 | `ssh_exec` | `ls -la /path` |

---

## 工具清单

### SSH 工具（现有）

| 工具名 | 功能 | 核心参数 |
|--------|------|----------|
| `ssh_connect` | 连接远程服务器 | `host`, `username`, `port`, `password`/`private_key` |
| `ssh_disconnect` | 断开连接 | `session_id` |
| `ssh_exec` | 执行远程命令 | `session_id`, `command`, `timeout` |
| `ssh_sudo` | 执行 sudo 命令 | `session_id`, `command`, `password` |
| `ssh_output` | 获取任务输出 | `task_id` |
| `ssh_history` | 获取命令历史 | `session_id`, `limit` |

### SFTP 工具（新增）

| 工具名 | 功能 | ssh2 方法 | 核心参数 |
|--------|------|-----------|----------|
| `sftp_list` | 列出远程目录 | `readdir` | `session_id`, `path` |
| `sftp_download` | 下载文件 | `fastGet` | `session_id`, `remote_path`, `local_path` |
| `sftp_upload` | 上传文件 | `fastPut` | `session_id`, `local_path`, `remote_path` |

---

## 详细设计

### sftp_list

列出远程目录内容。

**参数：**
```json
{
  "session_id": { "type": "string", "required": true, "description": "SSH 会话 ID" },
  "path": { "type": "string", "required": true, "description": "远程目录路径" }
}
```

**返回：**
```json
{
  "success": true,
  "entries": [
    {
      "filename": "example.txt",
      "type": "file",
      "size": 1234,
      "mode": "0644",
      "mtime": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### sftp_download

下载远程文件到本地。

**参数：**
```json
{
  "session_id": { "type": "string", "required": true },
  "remote_path": { "type": "string", "required": true, "description": "远程文件路径" },
  "local_path": { "type": "string", "required": true, "description": "本地保存路径" }
}
```

**返回：**
```json
{
  "success": true,
  "remote_path": "/remote/file.txt",
  "local_path": "/local/file.txt",
  "bytes_transferred": 12345
}
```

---

### sftp_upload

上传本地文件到远程服务器。

**参数：**
```json
{
  "session_id": { "type": "string", "required": true },
  "local_path": { "type": "string", "required": true, "description": "本地文件路径" },
  "remote_path": { "type": "string", "required": true, "description": "远程保存路径" }
}
```

**返回：**
```json
{
  "success": true,
  "local_path": "/local/file.txt",
  "remote_path": "/remote/file.txt",
  "bytes_transferred": 12345
}
```

---

## 架构设计

### SFTP 连接管理

在 `session_manager.js` 中添加 SFTP 连接缓存：

```javascript
// SFTP 连接缓存（sessionId -> SFTP instance）
const sftpConnections = new Map();

/**
 * 获取或创建 SFTP 连接
 */
async function getSftp(sessionId) {
  if (sftpConnections.has(sessionId)) {
    return sftpConnections.get(sessionId);
  }
  
  const conn = connections.get(sessionId);
  if (!conn) {
    throw new Error('Session not connected');
  }
  
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) reject(err);
      else {
        sftpConnections.set(sessionId, sftp);
        resolve(sftp);
      }
    });
  });
}
```

### 权限验证

复用现有的用户隔离机制：

```javascript
const sftpActions = ['sftp_list', 'sftp_download', 'sftp_upload'];

if (sftpActions.includes(action) && params.session_id) {
  if (!isAdmin && userId) {
    if (!db.isSessionOwnedByUser(params.session_id, userId)) {
      throw new Error('Session not found or access denied');
    }
  }
}
```

### 工具注册

在 `skill_tools` 表中注册：

```sql
INSERT INTO skill_tools (skill_id, name, description, parameters, script_path, is_resident) VALUES
(ssh_skill_id, 'sftp_list', '列出远程目录', '...', 'resident://sftp_list', 0),
(ssh_skill_id, 'sftp_download', '下载文件', '...', 'resident://sftp_download', 0),
(ssh_skill_id, 'sftp_upload', '上传文件', '...', 'resident://sftp_upload', 0);
```

---

## 实现计划

### Step 1: 核心实现（session_manager.js）

1. 添加 SFTP 连接管理（`getSftp` 函数）
2. 实现 3 个 SFTP action handler
3. 添加错误处理和超时控制

### Step 2: 工具注册

1. 数据库迁移：添加 SFTP 工具记录
2. 更新 SKILL.md 文档

### Step 3: 测试

1. 编写测试用例（使用 `run-skill.js`）
2. 测试各种边界情况

---

*文档版本: 1.1*
*创建日期: 2026-03-14*
*作者: Maria*