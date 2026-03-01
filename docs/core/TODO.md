# 项目待办事项

> 最后更新：2026-03-01

---

## 待开始

| 任务 | 状态 | 优先级 |
|------|------|--------|
| [用户隔离架构升级](../design/v2/user-isolation.md) | ⏳ 待开始 | 高 |
| [skill-runner 多语言支持](#skill-runner-多语言支持) | ⏳ 待开始 | 高 |
| [反思心智模板配置化](tasks/reflective-mind-template.md) | ⏳ 待开始 | 中 |
| [运行时参数配置界面](tasks/runtime-config.md) | ⏳ 待开始 | 中 |
| [组织架构配置界面](../design/v2/org-architecture.md) | ⏳ 待开始 | 中 |

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
| [技能对话式导入](tasks/skill-import-dialog.md) | 🔄 进行中 | 高 |
| [Health Check 与 SSE 心跳优化](tasks/2026-03-01-health-check-optimization/README.md) | 🔄 进行中 | 中 |
| [对话窗口右侧多功能 Panel](tasks/right-panel.md) | ✅ 基础功能已完成 | 中 |
| [工具调用可视化面板 + SearXNG 搜索技能](tasks/tool-visualization.md) | 🔄 进行中（20%） | 中 |
| [核心架构升级：两层角色+沙箱池+专家编排](../design/v2/org-architecture.md) | 🔄 文档设计中 | 高 |

---

---

*状态图标：🔄 进行中 | ⏳ 待开始 | ✅ 已完成 | ❌ 已取消*

*已完成任务归档在：[2026-02](../archive/todo-archive-2026-02.md) | [2026-03](../archive/todo-archive-2026-03.md)*
