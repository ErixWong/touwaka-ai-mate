---
name: ssh
description: "SSH 远程服务器管理。用于连接远程服务器、执行命令、SFTP 文件传输。支持会话管理、自动重连、历史记录存储。当用户需要 SSH 连接、远程执行命令、传输文件时触发。使用 JSON 文件存储，无原生依赖。"
argument-hint: "[connect|exec|sudo|sftp_list|sftp_download|sftp_upload|disconnect] --session ID"
user-invocable: false
allowed-tools: []
---

# SSH - 远程服务器管理

基于会话的 SSH 客户端，支持同步命令执行和 SFTP 文件传输。使用 JSON 文件存储，无需原生依赖。

## ⚠️ 重要安全说明

**Session ID 是访问凭证，必须妥善保存！**

- Session ID 采用 **Capability-based Security** 机制：**知道 Session ID = 拥有该 Session 的完全控制权**
- **LLM 必须将 Session ID 保存在本地**（如对话上下文、本地文件等）
- **丢失 Session ID = 丢失访问权限**，必须重新发起连接
- **不要泄露 Session ID**，任何获得它的人都可以控制你的远程服务器
- **不提供 Session 列表功能**（防止枚举攻击），所以无法找回丢失的 Session ID

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

**安全提示：**
- 连接成功后立即保存 session_id
- 不要在公开场合显示完整 session_id（可显示前8位用于识别）

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

## LLM 职责清单

- [ ] **连接后立即保存 session_id** 到对话上下文或本地存储
- [ ] **每次操作前确认 session_id 可用**
- [ ] **如果 session_id 丢失**，告知用户需要重新连接
- [ ] **不要在公开场合显示完整 session_id**（可显示前8位用于识别）

## 存储位置

使用 JSON 文件存储，无原生依赖：

- 会话索引: `./data/sessions.json`
- 会话数据: `./data/sessions/sess_xxx.json`
- 归档文件: `./data/sessions/sess_xxx.1.json`（自动归档，每文件最大 100KB）

### 归档策略

- 主文件自动循环：保留最近 50 条命令记录
- 归档文件：追加所有消息，超过 100KB 时创建新文件
- 支持跨归档文件搜索

## 依赖

- Node.js 18+
- 首次使用前在技能目录运行 `npm install`
- ssh2 包（纯 JavaScript，无原生依赖）

---

*最后更新: 2026-03-23 - 改用 JSON 文件存储，移除 SQLite 依赖*

✌Bazinga！
