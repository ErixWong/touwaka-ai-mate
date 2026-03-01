# Code Review: 2026-03-01 待提交代码

> 审查时间：2026-03-01
> 审查范围：未提交的代码变更

## 变更概览

| 文件 | 状态 | 变更类型 |
|------|------|----------|
| `docs/core/TODO.md` | modified | 文档更新 |
| `lib/skill-loader.js` | modified | 字段名修复 + 工具命名重构 |
| `lib/tool-manager.js` | modified | 移除 builtin 引用，统一技能执行 |
| `tools/builtin/` | **deleted** | 整个目录删除 |
| `scripts/migrate-skills.js` | deleted | 废弃删除 |
| `scripts/init-core-skills.js` | renamed | 从 sync-builtin-skills.js 重命名 |
| `data/skills/skill-manager/` | new | 新增技能管理技能 |

---

## 重要设计决策

### skill-manager 从内置工具迁移为普通技能

**背景**：
- `list_all_skills` 等工具的设计初衷是让 LLM 能够"按需加载"技能
- 但实际上 LLM 无法动态修改自己的 `tools` 数组（OpenAI API 限制）
- 这些工具只能返回文本信息，无法让 LLM "获得"新工具

**决策**：
1. 将 `skill-manager` 从 `tools/builtin/` 迁移到 `data/skills/skill-manager/`
2. 移除 `list_all_skills`、`get_skill_detail`（纯信息查询，前端 UI 已覆盖）
3. 保留 `register_skill`、`delete_skill`、`assign_skill_to_expert`、`toggle_skill`（管理操作）

**新技能结构**：
```
data/skills/skill-manager/
├── SKILL.md          # 技能描述
└── index.js          # 实现 register_skill, delete_skill, assign_skill_to_expert, toggle_skill
```

**使用流程**：
1. 技能专家通过 `list_files` 和 `read_lines` 浏览技能目录
2. 读取 SKILL.md 理解技能结构和工具定义
3. 使用 `register_skill` 将技能注册到数据库
4. 使用 `assign_skill_to_expert` 将技能分配给专家

---

## 详细审查

### 1. lib/skill-loader.js

#### ✅ 优点

1. **字段名修复正确**：`usage` → `parameters` 修复了数据库字段与代码的一致性问题
2. **参数解析逻辑更健壮**：新增了对多种 JSON Schema 格式的支持：
   - 完整的 `{ type: 'object', properties: {...} }` 格式
   - 嵌套在 `parameters` 字段中的格式
   - 只有 `properties` 字段的简化格式
3. **错误日志改进**：添加了具体的错误信息输出

#### ⚠️ 问题

1. **工具命名变更可能破坏现有功能**：

   ```javascript
   // 旧代码
   name: toolId,  // 使用 skill_tools.id 作为 LLM 调用的 tool_name
   
   // 新代码  
   name: toolFunctionName,  // 使用 skillId_toolName 格式，LLM 可读
   ```
   
   这个变更会影响：
   - 现有的工具调用逻辑是否兼容？
   - `tool-manager.js` 中的 `executeSkillTool` 是否能正确解析新的工具名格式？
   
   **建议**：确认 `tool-manager.js` 中的工具查找逻辑已同步更新。

2. **潜在的空指针问题**：
   
   ```javascript
   if (Object.keys(parameters.properties || {}).length === 0 && toolRow.description) {
   ```
   这里加了 `|| {}` 保护，但前面的解析逻辑中 `parameters` 初始化后没有类似保护：
   ```javascript
   let parameters = { type: 'object', properties: {}, required: [] };
   ```
   这是安全的，但建议保持一致性。

---

### 2. lib/tool-manager.js

#### 变更内容

```javascript
// 新增：从工具函数名解析 skillId 和 toolName
const toolFunctionName = tool.function.name;
const parts = toolFunctionName.split('_');
const skillId = parts[0];
const toolName = parts.slice(1).join('_');
```

#### ⚠️ 问题

1. **工具名解析逻辑脆弱**：
   
   如果工具名本身包含下划线（如 `read_file_content`），解析会出错：
   - `file-operations_read_file_content` 
   - `skillId = "file-operations"` ✅
   - `toolName = "read_file_content"` ✅
   
   这个逻辑是正确的，但建议添加边界检查：
   
   ```javascript
   if (parts.length < 2) {
     logger.error(`[ToolManager] Invalid tool function name format: ${toolFunctionName}`);
     return { success: false, error: 'Invalid tool name format' };
   }
   ```

2. **SQL 查询使用 `name` 而非 `id`**：
   
   ```javascript
   const [toolRows] = await db.execute(
     'SELECT * FROM skill_tools WHERE skill_id = ? AND name = ?',
     [skillId, toolName]
   );
   ```
   
   这个变更与 `skill-loader.js` 的命名重构一致，是正确的。

---

### 3. data/skills/skill-manager/ (新技能)

#### ✅ 优点

1. **职责分离清晰**：技能专家通过文件系统读取，通过 skill-manager 写入数据库
2. **工具精简**：只保留必要的管理工具
3. **与现有技能结构一致**：使用标准的 SKILL.md + index.js 结构

#### 工具清单

| 工具 | 用途 |
|------|------|
| `register_skill` | 注册/更新技能（传入 tools 数组） |
| `delete_skill` | 删除技能 |
| `assign_skill_to_expert` | 分配给专家 |
| `unassign_skill_from_expert` | 取消分配 |
| `toggle_skill` | 启用/禁用 |

---

### 4. scripts/init-core-skills.js (重命名)

#### ✅ 优点

1. **代码结构清晰**：硬编码的内置技能定义易于维护
2. **错误处理完善**：包含 try-catch 和数据库连接清理
3. **支持 dry-run 模式**：便于预览变更
4. **统计信息完整**：显示插入/更新/工具数量
5. **已添加 skill-manager 技能定义**

---

### 5. scripts/migrate-skills.js (删除)

#### ✅ 正确决策

删除是正确的，因为：
1. 该脚本尝试解析 SKILL.md，功能与新的 LLM 驱动流程冲突
2. 新的 `init-core-skills.js` 更简单可靠
3. 用户自定义技能通过 `register_skill` 工具注册

---

## 整体评估

### 架构变更总结

```
旧流程：
  SKILL.md → migrate-skills.js 解析 → 数据库

新流程：
  核心技能：init-core-skills.js 硬编码 → 数据库
  用户技能：SKILL.md → LLM 读取理解 → register_skill(tools) → 数据库
```

这个架构变更合理，优点：
- 所有技能统一管理，无特殊例外
- 用户技能由 LLM 理解，更灵活
- skill-manager 作为普通技能，可被任何专家使用

### 风险点

| 风险 | 严重程度 | 状态 |
|------|----------|------|
| ~~tools/builtin/index.js 仍引用旧 skill-manager~~ | ~~🔴 高~~ | ✅ 已解决（删除整个目录） |
| 工具命名格式变更可能破坏现有调用 | 🟡 中 | 需要测试验证 |
| skill-loader 和 tool-manager 命名逻辑耦合 | 🟡 中 | 添加单元测试 |
| init-core-skills 与实际 SKILL.md 不同步 | 🟡 中 | 考虑从文件读取或添加同步检查 |

---

## ✅ 迁移已完成

### 已执行操作

1. **删除 `tools/builtin/` 目录**
   - 移除了 `index.js`、`skill-manager.js`、`skill.md`
   - 所有功能已迁移到 `data/skills/` 中的普通技能

2. **更新 `lib/tool-manager.js`**
   - 移除 `loadBuiltinSkill()` 方法
   - 移除 `executeBuiltinTool()` 方法
   - 移除 `builtinSkill` 属性
   - 移除 `isBuiltin` 相关逻辑
   - 所有技能统一通过 `skillLoader.executeSkillTool()` 执行

3. **更新 `docs/core/TODO.md`**
   - 移除"内置技能精简方案"（已完成）
   - 添加"skill-runner 多语言支持"任务

### 新增任务

**skill-runner 多语言支持**（见 `docs/core/TODO.md`）
- 扩展 `lib/skill-runner.js` 支持 Python、Shell 等脚本
- 集成 firejail/sandboxie 沙箱隔离
- 统一 stdin/stdout JSON 通信协议

---

## 结论

**总体评价**：🟢 可以合并

代码变更方向正确，架构设计合理。主要变更：
1. ✅ 完全移除 `tools/builtin/` 目录
2. ✅ 所有技能统一通过 `skill-runner` 执行
3. ✅ `skill-manager` 作为普通技能运行

**后续操作**：
1. 运行 `node scripts/init-core-skills.js` 初始化/修复核心技能
2. 手动测试技能注册和工具调用流程
3. 开始 skill-runner 多语言支持开发
