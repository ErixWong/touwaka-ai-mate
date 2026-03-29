---
name: ssh
description: "SSH 远程服务器管理。用于连接远程服务器、执行命令、SFTP 文件传输。支持会话管理、自动重连、历史记录存储。当用户需要 SSH 连接、远程执行命令、传输文件时触发。"
is_resident: 1
argument-hint: "[session|exec|sudo|sftp] --session ID"
user-invocable: false
allowed-tools: []
---

# SSH - 远程服务器管理

基于会话的 SSH 客户端，支持同步命令执行和 SFTP 文件传输。

## 核心工具（4 个）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `ssh_session` | 会话管理（连接/断开） | `operation`, `host`, `username`, `session_id` |
| `ssh_exec` | 执行命令（同步） | `session_id`, `command` |
| `ssh_sudo` | sudo 执行 | `session_id`, `command`, `password` |
| `ssh_sftp` | SFTP 文件传输 | `session_id`, `operation`, `remote_path`, `local_path` |

## 工具详情

### ssh_session

会话管理（连接/断开）。

**参数：**
- `operation` (string, required): 操作类型 - `connect` | `disconnect`
- `host` (string, optional): 主机地址（IP 或主机名）- connect 操作需要
- `username` (string, optional): SSH 用户名 - connect 操作需要
- `port` (number, optional): SSH 端口，默认 22 - connect 操作需要
- `password` (string, optional): 密码认证 - connect 操作需要
- `private_key` (string, optional): 私钥文件路径（支持 `~` 展开）- connect 操作需要
- `passphrase` (string, optional): 加密私钥的密码 - connect 操作需要
- `session_id` (string, optional): 会话 ID - disconnect 操作需要

**返回（connect 操作）：**
```json
{ "success": true, "operation": "connect", "session_id": "sess_abc123..." }
```

**返回（disconnect 操作）：**
```json
{ "success": true, "operation": "disconnect", "message": "Disconnected" }
```

### ssh_exec

在远程服务器上执行命令（同步阻塞，直接返回输出）。

**参数：**
- `session_id` (string, required): 会话 ID
- `command` (string, required): 要执行的命令
- `timeout` (number, optional): 超时时间（毫秒），默认 60000

**返回：**
```json
{
  "success": true,
  "exit_code": 0,
  "stdout": "命令输出...",
  "stderr": ""
}
```

### ssh_sudo

使用 sudo 权限执行命令。

**参数：**
- `session_id` (string, required): 会话 ID
- `command` (string, required): 要执行的命令（不含 sudo 前缀）
- `password` (string, required): sudo 密码
- `timeout` (number, optional): 超时时间（毫秒），默认 120000

**安全特性：**
- 密码在输出中被掩码（替换为 `********`）
- 支持自动密码提示检测

### ssh_sftp

SFTP 文件传输（支持 list/download/upload 操作）。

**参数：**
- `session_id` (string, required): 会话 ID
- `operation` (string, required): 操作类型 - `list` | `download` | `upload`
- `remote_path` (string, optional): 远程文件路径
- `local_path` (string, optional): 本地文件路径
- `path` (string, optional): 远程目录路径（用于 list 操作）

**返回（list 操作）：**
```json
{
  "success": true,
  "operation": "list",
  "path": "/home/user",
  "entries": [
    { "filename": "example.txt", "type": "file", "size": 1234, "mode": "0644" }
  ]
}
```

**返回（download/upload 操作）：**
```json
{
  "success": true,
  "operation": "download",
  "remote_path": "/remote/file.txt",
  "local_path": "/local/file.txt",
  "bytes_transferred": 1234
}
```

## 典型工作流程

```
1. ssh_session (connect) → 保存返回的 session_id
2. ssh_exec → 执行命令，直接获取输出（同步）
3. ssh_sudo → 执行需要提权的命令
4. ssh_sftp → 文件传输（operation: list|download|upload）
5. ssh_session (disconnect) → 关闭连接
```

## 安全说明

**Session ID 是能力令牌，请像密码一样对待！**

- 知道 Session ID = 拥有该连接的完全控制权
- LLM 必须在对话上下文中保存 Session ID
- 丢失 Session ID = 丢失访问权限（出于安全考虑无会话列表功能）
- 不要在公开场合暴露完整 Session ID（仅显示前 8 个字符用于识别）

## 存储

使用 JSON 文件存储，无需数据库依赖：

```
data/
├── sessions.json           # 会话索引
└── sessions/
    ├── sess_xxx.json       # 主文件（最近 50 条命令）
    ├── sess_xxx.1.json     # 归档文件 #1（~100KB）
    └── sess_xxx.2.json     # 归档文件 #2
```

**安全特性：**
- 密码不会保存到磁盘（仅私钥认证会话可恢复）
- 归档文件自动管理，每个文件最大 100KB
- 主文件自动循环，保留最近 50 条命令

## 依赖

- Node.js 18+
- ssh2 包（项目已安装）
