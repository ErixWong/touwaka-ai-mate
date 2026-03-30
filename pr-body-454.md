## 变更摘要

精简 skill-manager 技能的工具数量，从 7 个减少到 5 个。

## 变更内容

### 工具重命名

| 原工具名 | 新工具名 | 功能 |
|---------|---------|------|
| `list_skills` | `list` | 列出所有技能 |
| `list_skill_details` | `details` | 获取技能详情 |
| `register_skill` | `register` | 注册/更新技能 |
| `delete_skill` | `delete` | 删除技能 |
| `toggle_skill` | `toggle` | 启用/禁用技能 |

### 移除的工具

- `assign_skill` - 分配技能给专家
- `unassign_skill` - 取消技能分配

### 修改的文件

1. `data/skills/skill-manager/index.js` - 更新工具函数和 execute 中的 tools 映射
2. `data/skills/skill-manager/SKILL.md` - 更新工具清单文档

## 原因

LLM 的 tools 注入格式为 `skills.mark + '__' + tools.name`，技能标识+工具名称的方式过于啰嗦。精简工具数量可以简化调用方式。

## 测试

- [x] 代码加载测试通过
- [x] 语法检查通过

Closes #454
