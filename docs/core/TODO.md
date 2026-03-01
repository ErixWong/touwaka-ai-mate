# 项目待办事项

> 最后更新：2026-03-01

---

## 待开始

| 任务 | 状态 | 优先级 |
|------|------|--------|
| [用户隔离架构升级](../design/v2/user-isolation.md) | ⏳ 待开始 | 高 |
| [skill-runner 多语言支持](#skill-runner-多语言支持) | ⏳ 待开始 | 高 |
| [反思心智模板配置化](../archive/tasks/2026-02/2026-02-24-reflective-mind-template/README.md) | ⏳ 待开始 | 中 |
| [运行时参数配置界面](../archive/tasks/2026-02/2026-02-24-runtime-config/README.md) | ⏳ 待开始 | 中 |
| [组织架构配置界面](../design/v2/org-architecture.md) | ⏳ 待开始 | 中 |
| [技能对话式导入](../archive/tasks/2026-02/2026-02-24-skill-import-dialog/README.md) | ⏳ 待开始 | 高 |
| [Topic 状态管理机制](#topic-状态管理机制) | ⏳ 待开始 | 中 |
| [Tools 表执行路径字段](#tools-表执行路径字段) | ⏳ 待开始 | 中 |
| [对话窗口停止按钮](#对话窗口停止按钮) | ⏳ 待开始 | 中 |
| [QQ/Zoom 消息通道](#qqzoom-消息通道) | ⏳ 待开始 | 中 |

### Topic 状态管理机制

当前问题：所有 Topic 的状态都是"进行中"，缺乏状态流转机制。

**改进方向**：
- 定义 Topic 状态枚举（active/archived/closed 等）
- 设计状态转换规则（何时自动归档、何时关闭）
- 前端展示不同状态的 Topic
- 考虑基于时间/消息数的自动状态转换

### Tools 表执行路径字段

当前问题：`skills` 表有 `south_path` 字段，但 `skill_tools` 表没有相应的执行文件路径字段，导致 skill 系统只认 `index.js`。

**改进方向**：
- `skill_tools` 表增加 `entry_file` 字段（默认 `index.js`）
- 支持指定其他入口文件（如 `main.py`、`run.sh`）
- 与 skill-runner 多语言支持配合使用

### 对话窗口停止按钮

当前问题：对话窗口没有停止按钮，用户无法中断 LLM 的流式输出。

**改进方向**：
- 在输入框旁边添加停止按钮（流式输出时显示）
- 点击后中断 SSE 连接，停止当前生成
- 保留已生成的内容，标记消息状态为"已停止"
- 后端需要支持取消正在进行的 LLM 请求

### QQ/Zoom 消息通道

将 Touwaka Mate 对接到 QQ 和 Zoom 平台，让用户可以通过这些平台与专家对话。

**QQ 对接方案**：
- 使用 [go-cqhttp](https://github.com/Mrs4s/go-cqhttp) 或 [OneBot](https://onebot.dev/) 协议
- 支持私聊和群聊（群聊需要 @ 机器人）
- 用户身份映射（QQ 号 → user_id）

**Zoom 对接方案**：
- 使用 Zoom Bot SDK 或 Webhook
- 支持频道消息和私聊
- 会议中@机器人触发专家

**技术要点**：
1. 统一消息通道抽象层（MessageChannel Interface）
2. 各平台适配器实现（QQAdapter, ZoomAdapter）
3. WebSocket 连接到主服务
4. 消息格式转换（平台消息 ↔ Expert 消息）
5. 流式响应分段发送（各平台有消息长度限制）
6. 权限控制（谁能使用哪些专家）

### skill-runner 多语言支持

扩展 `lib/skill-runner.js` 支持多种脚本语言和可执行文件：

**目标**：
- 支持 Python、Shell、Bash 等脚本语言
- 支持编译型可执行文件
- 使用沙箱（firejail 或类似实现）隔离执行

**实现要点**：
1. 检测技能目录中的入口文件类型（index.js, index.py, main.sh 等）
2. 根据文件类型选择执行器（node, python, bash 等）
3. 集成 firejail/sandboxie 进行沙箱隔离
4. 统一 stdin/stdout JSON 通信协议

**参考文档**：
- [sandbox-architecture.md](../design/v2/sandbox-architecture.md)
- [sandbox-executor.md](../guides/sandbox-executor.md)

---

## 进行中

| 任务 | 状态 | 优先级 |
|------|------|--------|
| [技能参数配置界面](tasks/2026-03-01-skill-parameters-config/README.md) | 🔄 进行中（80%） | 高 |
| [技能对话式导入](tasks/skill-import-dialog.md) | 🔄 进行中 | 高 |
| [Health Check 与 SSE 心跳优化](tasks/2026-03-01-health-check-optimization/README.md) | 🔄 进行中 | 中 |
| [对话窗口右侧多功能 Panel](tasks/right-panel.md) | ✅ 基础功能已完成 | 中 |
| [工具调用可视化面板 + SearXNG 搜索技能](tasks/tool-visualization.md) | 🔄 进行中（20%） | 中 |
| [核心架构升级：两层角色+沙箱池+专家编排](../design/v2/org-architecture.md) | 🔄 文档设计中 | 高 |

---

## 已完成（待归档）

| 任务 | 完成日期 | 备注 |
|------|----------|------|
| Topic Updated Event 修复 | 2026-03-01 | 前端监听 topic_updated SSE 事件 |
| 移除 tools/builtin 目录 | 2026-03-01 | 所有工具迁移为普通技能 |
| register_skill 工具参数修复 | 2026-03-01 | 增加 tools 参数，由 LLM 传入工具定义 |
| skill-loader.js 字段名修复 | 2026-03-01 | usage → parameters |
| migrate-skills.js 废弃 | 2026-03-01 | 改用 LLM 解析 SKILL.md |
| 右侧面板基础功能 | 2026-02-22 | Topics/Debug Tab 已完成，归档于 [tasks/2026-02-22-right-panel](../archive/tasks/2026-02/2026-02-22-right-panel/README.md) |

---

*状态图标：🔄 进行中 | ⏳ 待开始 | ✅ 已完成 | ❌ 已取消*

*已完成任务归档在：[2026-02](../archive/todo-archive-2026-02.md) | [2026-03](../archive/todo-archive-2026-03.md)*
