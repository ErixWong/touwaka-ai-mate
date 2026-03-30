## 背景

当前 skill-manager 技能提供了 7 个工具：
- `list_skills` / `list_skill_details`
- `register_skill`
- `delete_skill`
- `toggle_skill`
- `assign_skill` / `unassign_skill`

根据之前的优化决策，LLM 的 tools 注入格式为 `skills.mark + '__' + tools.name`，这种技能标识+工具名称的方式过于啰嗦。因此需要精简工具数量，只保留最核心的 5 个工具。

## 需求

将 skill-manager 技能的工具精简为以下 5 个：

| 工具名 | 功能 | 对应原工具 |
|--------|------|-----------|
| `list` | 列出所有技能 | `list_skills` |
| `details` | 获取技能详情 | `list_skill_details` |
| `register` | 注册/更新技能 | `register_skill` |
| `delete` | 删除技能 | `delete_skill` |
| `toggle` | 启用/禁用技能 | `toggle_skill` |

**移除的工具：**
- `assign_skill` → 移除
- `unassign_skill` → 移除

## 修改范围

1. **index.js**: 更新 tools 对象，移除 assign/unassign，重命名工具
2. **SKILL.md**: 更新工具清单文档
3. **IMPORT_GUIDE.md**: 如有引用需要同步更新

## 验收标准

- [ ] 工具数量从 7 个减少到 5 个
- [ ] 工具名称简化为：list, details, register, delete, toggle
- [ ] SKILL.md 文档同步更新
- [ ] 代码测试通过
