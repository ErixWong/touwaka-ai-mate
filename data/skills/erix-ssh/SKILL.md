---
name: ssh
description: SSH remote server management toolkit with session support. Use when Claude needs to connect to remote servers via SSH, execute commands, manage files, or perform system administration tasks. Supports persistent sessions, async command execution, and message history with SQLite storage.
argument-hint: "[connect|exec|sudo|history|output|disconnect] --session ID"
user-invocable: false
allowed-tools: []
---

# SSH Remote Server Management

Session-based SSH client with async execution and SQLite storage.

## ⚠️ 重要安全说明

**Session ID 是访问凭证，必须妥善保存！**

- Session ID 采用 **Capability-based Security** 机制：**知道 Session ID = 拥有该 Session 的完全控制权**
- **LLM 必须将 Session ID 保存在本地**（如对话上下文、本地文件等）
- **丢失 Session ID = 丢失访问权限**，必须重新发起连接
- **不要泄露 Session ID**，任何获得它的人都可以控制你的远程服务器
- **不提供 Session 列表功能**（防止枚举攻击），所以无法找回丢失的 Session ID

## 工具清单

### start_manager

启动后台 Session Manager 进程。必须在执行任何 SSH 操作前启动。

**参数：**
无

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "message": "Manager started",
  "pid": 12345
}
```

---

### stop_manager

停止后台 Session Manager 进程。

**参数：**
无

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "message": "Manager stopped"
}
```

---

### connect

连接到远程服务器，返回 session_id。**必须保存返回的 session_id，这是访问该连接的唯一凭证。**

**参数：**
- `host`: 主机地址（必需）- IP 地址或主机名
- `username`: 用户名（必需）
- `port`: 端口号（可选，默认 22）
- `password`: 密码（可选，交互式输入更安全）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "session_id": "sess_c7f8a9b2e4d6f1a3b5c7d9e8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9"
}
```

**安全提示：**
- 连接成功后立即保存 session_id
- 不要在公开场合显示完整 session_id（可显示前8位用于识别）

---

### disconnect

断开与远程服务器的连接。

**参数：**
- `session`: Session ID（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "message": "Disconnected from session"
}
```

---

### delete

删除 Session 及其所有历史记录。

**参数：**
- `session`: Session ID（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "message": "Session deleted"
}
```

---

### exec

在远程服务器上异步执行命令，返回 task_id。

**参数：**
- `session`: Session ID（必需）
- `command`: 要执行的命令（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "task_id": "task_abc123",
  "message": "Command submitted"
}
```

**注意：** 命令是异步执行的，需要使用 `history` 或 `output` 获取执行结果。

---

### sudo

使用 sudo 权限执行命令。支持 PTY (伪终端) 自动处理密码提示。

**参数：**
- `session`: Session ID（必需）
- `command`: 要执行的命令（必需）
- `password_file`: 密码文件路径（可选，推荐）

**script_path:** `scripts/ssh_client.js`

**密码传递方式（按优先级）：**

1. **密码文件** `--password-file FILE` - 最安全，适合脚本
2. **环境变量** `SUDO_PASSWORD` - 适合 CI/CD 环境
3. **交互式输入** - 终端中隐藏输入，适合手动使用

**返回示例：**
```json
{
  "success": true,
  "task_id": "task_xyz789",
  "message": "Sudo command submitted"
}
```

**安全特性：**
- 密码文件权限检查（过于开放会警告）
- 命令文件权限 `0600`
- 命令执行后清除内存中的密码
- 输出消息中屏蔽密码显示
- **不要使用 `--password` 命令行参数**（已废弃，会暴露密码）

---

### history

获取命令历史记录列表，包含 task_id 和执行状态。

**参数：**
- `session`: Session ID（必需）
- `limit`: 返回记录数量（可选，默认 20）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "commands": [
    {
      "id": "msg_xxx",
      "task_id": "task_001",
      "command": "df -h",
      "timestamp": "2024-01-15T10:30:00Z",
      "status": "completed",
      "exit_code": 0,
      "has_output": true,
      "has_error": false
    }
  ]
}
```

---

### output

获取特定任务的详细输出结果。

**参数：**
- `task`: Task ID（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "task_id": "task_001",
  "command": "df -h",
  "status": "completed",
  "exit_code": 0,
  "output": "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   50G   50G  50% /",
  "stderr": ""
}
```

---

### task_status

获取任务执行状态摘要。

**参数：**
- `task`: Task ID（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "task_id": "task_001",
  "status": "completed",
  "exit_code": 0
}
```

---

### tasks

列出所有任务。

**参数：**
- `session`: Session ID（可选，不提供则列出所有）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "tasks": [
    {
      "id": "task_001",
      "command": "ls -la",
      "status": "completed",
      "exit_code": 0
    }
  ]
}
```

---

### read

读取消息记录，支持多种过滤条件。

**参数：**
- `session`: Session ID（必需）
- `since`: 起始时间戳（可选）
- `until`: 结束时间戳（可选）
- `type`: 消息类型过滤（可选）- command, output, error, complete, system
- `task`: 按 task_id 过滤（可选）
- `unread_only`: 仅未读消息（可选）
- `mark_read`: 标记为已读（可选）
- `limit`: 返回数量限制（可选）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg_xxx",
      "type": "output",
      "content": "Hello World",
      "timestamp": "2024-01-15T10:30:00Z",
      "read": false
    }
  ]
}
```

---

### search

搜索消息内容。

**参数：**
- `session`: Session ID（必需）
- `query`: 搜索关键词（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "results": [
    {
      "id": "msg_xxx",
      "type": "output",
      "content": "error: connection failed",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### stats

获取 Session 统计信息。

**参数：**
- `session`: Session ID（必需）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "stats": {
    "total_messages": 100,
    "unread": 5,
    "commands": 10,
    "errors": 2
  }
}
```

---

### mark_read

标记消息为已读。

**参数：**
- `session`: Session ID（必需）
- `message`: 消息 ID（可选，不提供则标记所有）

**script_path:** `scripts/ssh_client.js`

**返回示例：**
```json
{
  "success": true,
  "marked_count": 5
}
```

---

## 典型工作流程

```
1. start_manager → 启动后台管理进程
2. connect → 建立 SSH 连接，保存返回的 session_id
3. exec/sudo → 执行命令，获取 task_id
4. history → 查看命令执行状态
5. output → 获取命令详细输出
6. disconnect → 断开连接
```

## LLM 职责清单

- [ ] **连接后立即保存 session_id** 到对话上下文或本地存储
- [ ] **每次操作前确认 session_id 可用**
- [ ] **如果 session_id 丢失**，告知用户需要重新连接
- [ ] **不要在公开场合显示完整 session_id**（可显示前8位用于识别）

## 存储位置

- SQLite 数据库: `./data/ssh.db`
- PID 文件: `./data/manager.pid`
- 命令目录: `./data/commands/`

## 系统要求

- Node.js 18+
- 首次使用前运行 `npm install`

---

*最后更新: 2026-03-12 - 按 skill-manager 标准格式重写*

✌Bazinga！