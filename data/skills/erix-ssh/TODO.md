# erix-ssh 驻留程序改造计划

## 目标
将 session_manager.js 改造为符合系统驻留程序设计原则的实现

## 任务清单

- [x] 1. 读取现有代码完整内容
- [x] 2. 改造 session_manager.js 为 stdin 事件驱动模式
  - [x] 2.1 添加 stdin/stdout JSON Lines 通信协议
  - [x] 2.2 移除 start/stop/status 命令行参数
  - [x] 2.3 添加 { type: 'ready' } 就绪信号
  - [x] 2.4 将日志输出改为 stderr
  - [x] 2.5 保留核心 SSH 会话管理功能
- [x] 3. 改造 SKILL.md
  - [x] 3.1 更新工具定义，精简为 4 个核心工具
  - [x] 3.2 为驻留工具添加 is_resident: 1 标记
  - [x] 3.3 合并 connect/disconnect 为 ssh_session 工具
- [x] 4. 将 SQLite 存储改为 JSON 文件存储
  - [x] 4.1 创建 db-json.js 模块
  - [x] 4.2 实现自动归档机制（100KB/文件，保留最近 50 条命令）
  - [x] 4.3 更新 session_manager.js 使用新存储模块
  - [x] 4.4 删除旧的 db.js SQLite 模块
- [x] 5. 验证改造结果
- [x] 6. 添加 handleSession 函数支持统一 session 管理

## 设计原则参考
- 参考 remote-llm 的实现模式
- stdin 输入命令，stdout 输出响应
- stderr 用于日志

## 存储结构

```
data/
├── sessions.json           # 会话索引
└── sessions/
    ├── sess_xxx.json       # 主文件（最近 50 条命令）
    ├── sess_xxx.1.json     # 归档文件 #1（~100KB）
    └── sess_xxx.2.json     # 归档文件 #2
```

## 安全特性
- 密码不会保存到磁盘
- 仅私钥认证会话可恢复
- sudo 密码在输出中自动掩码

## 核心工具（4 个）

| 工具 | 说明 |
|------|------|
| `ssh_session` | 会话管理（connect/disconnect） |
| `ssh_exec` | 执行命令（同步） |
| `ssh_sudo` | sudo 执行 |
| `ssh_sftp` | SFTP 文件传输（list/download/upload） |
