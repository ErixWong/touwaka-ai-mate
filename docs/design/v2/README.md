## Touwaka Mate v2 设计总览

**版本：** v2  
**目标：** 在 v1 能力的基础上，引入任务层（Task Layer）与右侧多功能面板，使系统更适合「复杂任务拆解 + 长周期协作」。

---

## 功能蓝图

- **Task Layer：**  
  - 以 Task 为中心组织对话与文件，提供 Task → Topics → Messages 的分层结构。  
  - 引入五阶段生命周期（NEW / ANALYSIS / PROCESS / REVIEW / DONE），并配套物理目录与数据库设计。  
  - 通过 Reflective Mind、解决方案库（Solution Library）、任务队列与优先级调度，保证执行过程「有约束、有节奏」。

- **右侧多功能面板（Right Panel）：**  
  - 固定在对话视图右侧，可展开/收起。  
  - 采用 Tab 形式组织 Topics / Docs / Files / Debug 等模块。  
  - 统一使用通用分页协议与分页组件，支持权限控制（如 Debug 仅管理员可见）。

---

## 文档索引

- **Task Layer 设计**
  - `task-layer-design.md`：Task 核心概念、生命周期、约束机制、目录结构、容器隔离、解决方案库、任务队列、涉密评估等完整设计。

- **右侧面板设计**
  - `right-panel-design.md`：Right Panel 总体交互、组件结构、通用分页协议与组件、Topics/Docs/Debug/Files 各 Tab 的前端与后端需求。

> 约定：后续如新增 v2 设计（例如权限体系、技能加载 v2 等），都优先放在本目录，并在本 README 中补充索引和状态说明。

---

## 状态标记约定

- **草稿：** 方案探索中，可能随时推翻重写  
- **已采纳：** 设计已通过评审，允许按文档实现  
- **已实现：** 主要功能已按设计落地，文档可作为事实依据  
- **已废弃：** 仅保留历史参考，不再作为实现依据

当前状态（人工维护）：  
- `task-layer-design.md`：**已采纳，部分内容待实现**  
- `right-panel-design.md`：**已采纳，按 TODO 推进中**

---

## 使用建议

- 讨论「如何组织任务、多阶段交付、容器/队列/安全策略」时，优先阅读 `task-layer-design.md`。  
- 讨论「前端布局、右侧 Panel、分页、Topics/Docs/Files/Debug UI 与 API」时，优先阅读 `right-panel-design.md`。  
- 如设计有变更，请务必同步更新本 README 的「文档索引」与「当前状态」，保持 v2 设计的单一总入口。

