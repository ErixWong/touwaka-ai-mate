# erix-ssh 技能改造记录

## 已完成

### 2026-03-23: SQLite → JSON 存储改造

**目标：** 将数据存储从 SQLite 改为 JSON 文件，移除原生依赖。

**变更：**
- [x] 创建 `scripts/db-json.js` - JSON 文件存储模块
- [x] 修改 `scripts/session_manager.js` - 使用 db-json 替代 db
- [x] 删除 `scripts/db.js` - 移除 SQLite 存储
- [x] 更新 `SKILL.md` - 反映新的存储方式

**存储结构：**
```
data/
├── sessions.json           # 会话索引
└── sessions/
    ├── sess_xxx.json       # 主文件（最近 50 条命令）
    ├── sess_xxx.1.json     # 归档 #1（~100KB）
    └── sess_xxx.2.json     # 归档 #2
```

**优势：**
- 无原生依赖（better-sqlite3 需要编译）
- 更易于调试（JSON 文件可直接查看）
- 自动归档机制，防止单文件过大
- 支持跨归档搜索

---

## 历史任务（已完成）

### 驻留程序改造

- [x] 1. 读取现有代码完整内容
- [x] 2. 改造 session_manager.js 为 stdin 事件驱动模式
  - [x] 2.1 添加 stdin/stdout JSON Lines 通信协议
  - [x] 2.2 移除 start/stop/status 命令行参数
  - [x] 2.3 添加 { type: 'ready' } 就绪信号
  - [x] 2.4 将日志输出改为 stderr
  - [x] 2.5 保留核心 SSH 会话管理功能
- [x] 3. 改造 SKILL.md
  - [x] 3.1 更新工具定义，精简为 4-5 个核心工具
  - [x] 3.2 为驻留工具添加 is_resident: 1 标记
- [x] 4. 验证改造结果
