---
name: ssh
description: "SSH 远程服务器管理。用于连接远程服务器、执行命令、SFTP 文件传输。支持会话管理、自动重连、历史记录存储。当用户需要 SSH 连接、远程执行命令、传输文件时触发。"
argument-hint: "[connect|exec|sudo|sftp_list|sftp_download|sftp_upload|disconnect] --session ID"
user-invocable: false
allowed-tools: []
---

# SSH - 远程服务器管理

基于会话的 SSH 客户端，支持同步命令执行和 SFTP 文件传输。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `ssh_connect` | 连接服务器 | `host`, `username`, `password`/`private_key` |
| `ssh_disconnect` | 断开连接 | `session_id` |
| `ssh_exec` | 执行命令 | `session_id`, `command` |
| `ssh_sudo` | sudo 执行 | `session_id`, `command`, `password` |
| `ssh_output` | 获取任务输出 | `task_id` |
| `ssh_history` | 获取历史记录 | `session_id` |
| `sftp_list` | 列出远程目录 | `session_id`, `path` |
| `sftp_download` | 下载文件 | `session_id`, `remote_path`, `local_path` |
| `sftp_upload` | 上传文件 | `session_id`, `local_path`, `remote_path` |

## SSH 工具

### ssh_connect

连接到远程 SSH 服务器，返回 Session ID。

**参数：**
- `host` (string, required): 主机地址（IP 或主机名）
- `username` (string, required): SSH 用户名
- `port` (number, optional): SSH 端口，默认 22
- `password` (string, optional): 密码认证
- `private_key` (string, optional): 私钥文件路径（支持 `~` 展开）
- `passphrase` (string, optional): 加密私钥的密码

**返回：**
```json
{ "success": true, "session_id": "sess_abc123..." }
```

### ssh_disconnect

断开 SSH 连接。

**参数：**
- `session_id` (string, required): 会话 ID

### ssh_exec

在远程服务器上执行命令（同步阻塞）。

**参数：**
- `session_id` (string, required): 会话 ID
- `command` (string, required): 要执行的命令
- `timeout` (number, optional): 超时时间（毫秒），默认 60000

**返回：**
```json
{
  "success": true,
  "task_id": "task_xxx",
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

### ssh_output

获取已执行任务的输出（用于历史任务）。

**参数：**
- `task_id` (string, required): 任务 ID

### ssh_history

获取会话的命令执行历史。

**参数：**
- `session_id` (string, required): 会话 ID
- `limit` (number, optional): 最大记录数，默认 20

## SFTP 工具

### sftp_list

列出远程目录内容。

**参数：**
- `session_id` (string, required): 会话 ID
- `path` (string, required): 远程目录路径

**返回：**
```json
{
  "success": true,
  "path": "/home/user",
  "entries": [
    { "filename": "example.txt", "type": "file", "size": 1234, "mode": "0644" }
  ]
}
```

### sftp_download

从远程服务器下载文件。

**参数：**
- `session_id` (string, required): 会话 ID
- `remote_path` (string, required): 远程文件路径
- `local_path` (string, required): 本地保存路径

### sftp_upload

上传文件到远程服务器。

**参数：**
- `session_id` (string, required): 会话 ID
- `local_path` (string, required): 本地文件路径
- `remote_path` (string, required): 远程保存路径

## 典型工作流程

```
1. ssh_connect → 保存返回的 session_id
2. ssh_exec → 执行命令，直接获取输出（同步）
3. ssh_sudo → 执行需要提权的命令
4. sftp_list/sftp_download/sftp_upload → 文件传输
5. ssh_disconnect → 关闭连接
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
