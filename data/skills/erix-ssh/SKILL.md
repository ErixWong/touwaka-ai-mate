---
name: ssh
description: SSH remote server management with synchronous command execution. Use when you need to connect to remote servers via SSH, execute commands, and get results. Features session-based Connection management, automatic reconnection, and message history stored in SQLite.
argument-hint: "[connect|exec|sudo|output|history|disconnect] --session ID"
user-invocable: false
allowed-tools: []
---

# SSH Remote Server Management

Session-based SSH client with synchronous execution and SQLite storage.

## Design Architecture

```
[Main Program] --stdin--> [session_manager.js (Resident)]
              <--stdout--+
              <--events--+

session_manager.js:
- is_resident: 1 (auto-started by main program)
- stdin: receives JSON commands
- stdout: sends JSON responses
- stderr: logs (does not interfere with communication)
```

## Security Note

**Session ID is a capability token - treat it like a password!**

- Knowing the Session ID = Full control over that connection
- LLM must save Session ID in conversation context
- Lost Session ID = Lost access (no session list feature for security)
- Never expose full Session ID in public (show first 8 chars only for identification)

## Tools

### ssh_connect

Connect to a remote SSH server and return a Session ID.

**is_resident:** 0 (calls resident process)
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `host` (required): Host address (IP or hostname)
- `username` (required): SSH username
- `port` (optional): SSH port, default 22
- `password` (optional): Password for authentication
- `private_key` (optional): Path to private key file (supports `~` expansion)
- `passphrase` (optional): Passphrase for encrypted private key

**Returns:**
```json
{
  "success": true,
  "session_id": "sess_abc123..."
}
```

---

### ssh_disconnect

Disconnect from an SSH server.

**is_resident:** 0
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `session_id` (required): Session ID to disconnect

**Returns:**
```json
{
  "success": true,
  "message": "Disconnected"
}
```

---

### ssh_exec

Execute a command on the remote server. Blocks until command completes.

**is_resident:** 0
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `session_id` (required): Session ID
- `command` (required): Command to execute
- `timeout` (optional): Timeout in milliseconds, default 60000

**Returns:**
```json
{
  "success": true,
  "task_id": "task_xxx",
  "exit_code": 0,
  "stdout": "command output...",
  "stderr": ""
}
```

**Note:** This is a synchronous call - the tool will not return until the command completes or times out.

---

### ssh_sudo

Execute a command with sudo privileges.

**is_resident:** 0
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `session_id` (required): Session ID
- `command` (required): Command to execute (without `sudo` prefix)
- `password` (required): Sudo password
- `timeout` (optional): Timeout in milliseconds, default 120000

**Returns:**
```json
{
  "success": true,
  "task_id": "task_xxx",
  "exit_code": 0,
  "stdout": "output (password masked)...",
  "stderr": ""
}
```

**Security Features:**
- Password is masked in output (replaced with `********`)
- Supports automatic password prompt detection

---

### ssh_output

Get output for a previously executed task (useful if you have task_id from history).

**is_resident:** 0
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `task_id` (required): Task ID to retrieve output for

**Returns:**
```json
{
  "success": true,
  "task_id": "task_xxx",
  "status": "completed",
  "exit_code": 0,
  "stdout": "...",
  "stderr": ""
}
```

---

### ssh_history

Get command execution history for a session.

**is_resident:** 0
**script_path:** `scripts/ssh_client.js`

**Parameters:**
- `session_id` (required): Session ID
- `limit` (optional): Max number of records, default 20

**Returns:**
```json
{
  "success": true,
  "commands": [
    {
      "id": "msg_xxx",
      "task_id": "task_001",
      "command": "ls -la",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Resident Process

### ssh_manager (internal)

The resident process that manages SSH connections. **Do not call directly.**

**is_resident:** 1
**script_path:** `scripts/session_manager.js`

This process is automatically started by the main program. It:
- Listens on stdin for JSON commands
- Responds on stdout with JSON results
- Logs to stderr
- Manages persistent SSH connections
- Sends `{ "type": "ready" }` when started

---

## Typical Workflow

```
1. ssh_connect → Save the returned session_id
2. ssh_exec → Execute commands, get output directly (synchronous)
3. ssh_exec → Execute more commands...
4. ssh_sudo → Execute commands requiring elevated privileges
5. ssh_disconnect → Close the connection
```

## Protocol (for Resident Communication)

Commands sent to the resident process on stdin:

```json
{
  "id": "req_123",
  "action": "connect",
  "host": "server.example.com",
  "username": "admin"
}
```

Responses sent on stdout:

```json
{
  "id": "req_123",
  "success": true,
  "session_id": "sess_..."
}
```

Events (unsolicited notifications):

```json
{
  "type": "event",
  "event": "disconnect",
  "session_id": "sess_..."
}
```

## Storage

- SQLite database: `./data/ssh.db`
- Contains sessions, messages, and task history

## Requirements

- Node.js 18+
- Run `npm install` in skill directory before first use
- ssh2 package

---
*Updated: 2026-03-13 - Refactored to resident process with stdin/stdout protocol*
