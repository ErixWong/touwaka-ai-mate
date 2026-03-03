# 项目待办事项

> 最后更新：2026-03-02

---

## 待开始

| 任务 | 状态 | 优先级 |
|------|------|--------|
| [知识库系统设计](tasks/2026-03-03-knowledge-base/README.md) | ⏳ 待开始 | 高 |
| [运行时配置统一管理](tasks/2026-03-02-runtime-configuration/README.md) | ⏳ 待开始 | 高 |
| [组织架构配置界面](../design/v2/org-architecture.md) | ⏳ 待开始 | 中 |
| [Topic 状态管理机制](#topic-状态管理机制) | ⏳ 待开始 | 中 |
| [对话窗口优化](#对话窗口优化) | ⏳ 待开始 | 高 |
| [QQ/Zoom 消息通道](#qqzoom-消息通道) | ⏳ 待开始 | 中 |

### Topic 状态管理机制

当前问题：所有 Topic 的状态都是"进行中"，缺乏状态流转机制。

**改进方向**：
- 定义 Topic 状态枚举（active/archived/closed 等）
- 设计状态转换规则（何时自动归档、何时关闭）
- 前端展示不同状态的 Topic
- 考虑基于时间/消息数的自动状态转换

### 对话窗口优化

整合对话窗口的多项优化需求，提升用户体验。

**包含功能**：

1. **停止按钮**
   - 在输入框旁边添加停止按钮（流式输出时显示）
   - 点击后中断 SSE 连接，停止当前生成
   - 保留已生成的内容，标记消息状态为"已停止"
   - 后端需要支持取消正在进行的 LLM 请求

2. **消息分页加载**
   - 首次只加载最新 N 条消息（如 20 条）
   - 滚动到顶部时自动加载更多（无限滚动）
   - 后端 API 支持分页参数（`limit`, `before_id`）
   - 前端实现虚拟滚动优化长列表渲染
   - 新消息实时推送不受分页影响

**实现要点**：
1. `GET /api/topics/:id/messages` 增加 `limit` 和 `before_id` 参数
2. 前端使用 `IntersectionObserver` 检测滚动到顶部
3. 考虑使用 `vue-virtual-scroller` 优化大量消息渲染
4. SSE 连接支持客户端主动断开

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

---

## 进行中

| 任务 | 状态 | 优先级 |
|------|------|--------|
| [Task 工作空间管理](tasks/2026-03-02-task-workspace/README.md) | 🔄 进行中（30%） | 高 |
| [技能参数配置界面](tasks/2026-03-01-skill-parameters-config/README.md) | 🔄 进行中（80%） | 高 |
| [Health Check 与 SSE 心跳优化](tasks/2026-03-01-health-check-optimization/README.md) | 🔄 进行中 | 中 |
| [对话窗口右侧多功能 Panel](tasks/right-panel.md) | ✅ 基础功能已完成 | 中 |
| [工具调用可视化面板 + SearXNG 搜索技能](tasks/tool-visualization.md) | 🔄 进行中（20%） | 中 |

---

## 已完成（待归档）

| 任务 | 完成日期 | 备注 |
|------|----------|------|
| Skill Manager 查询工具优化 | 2026-03-02 | 新增 list_skills、list_skill_details，移除 assign/unassign |
| 沙箱架构实现（本地开发环境） | 2026-03-02 | Node.js vm + Python subprocess 轻量级沙箱 |
| Python 技能支持 | 2026-03-02 | skill-runner 支持 Python，PDF 技能实现 |
| 技能对话式导入 | 2026-03-02 | 通过对话导入技能 |
| Topic Updated Event 修复 | 2026-03-01 | 前端监听 topic_updated SSE 事件 |
| 移除 tools/builtin 目录 | 2026-03-01 | 所有工具迁移为普通技能 |
| register_skill 工具参数修复 | 2026-03-01 | 增加 tools 参数，由 LLM 传入工具定义 |
| skill-loader.js 字段名修复 | 2026-03-01 | usage → parameters |
| migrate-skills.js 废弃 | 2026-03-01 | 改用 LLM 解析 SKILL.md |
| 右侧面板基础功能 | 2026-02-22 | Topics/Debug Tab 已完成，归档于 [tasks/2026-02-22-right-panel](../archive/tasks/2026-02/2026-02-22-right-panel/README.md) |

---

*状态图标：🔄 进行中 | ⏳ 待开始 | ✅ 已完成 | ❌ 已取消*

*已完成任务归档在：[2026-02](../archive/todo-archive-2026-02.md) | [2026-03](../archive/todo-archive-2026-03.md)*
