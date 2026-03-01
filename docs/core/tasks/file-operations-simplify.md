# File Operations 技能精简方案

> 状态：⏳ 待开始
> 优先级：中
> 创建日期：2026-03-01

---

## 背景

当前 `file-operations` 技能有 14 个工具，占核心技能工具总数的 78%。工具数量过多会增加：
- LLM 的选择成本
- 工具定义的 token 消耗
- 维护复杂度

---

## 当前工具清单（14 个）

| 工具 | 功能 |
|------|------|
| `read_lines` | 按行读取文件 |
| `read_bytes` | 按字节读取文件 |
| `list_files` | 列出目录 |
| `write_file` | 写入文件（覆盖） |
| `append_file` | 追加内容 |
| `replace_in_file` | 替换文本 |
| `insert_at_line` | 插入内容到指定行 |
| `delete_lines` | 删除指定行 |
| `search_in_file` | 单文件搜索 |
| `grep` | 多文件搜索 |
| `copy_file` | 复制文件 |
| `move_file` | 移动文件 |
| `delete_file` | 删除文件/目录 |
| `create_dir` | 创建目录 |

---

## 精简方案

### 可以合并的工具

| 现有工具 | 建议合并为 | 理由 |
|----------|------------|------|
| `read_lines` + `read_bytes` | `read_file` | 都是读文件，用 `mode` 参数区分 |
| `write_file` + `append_file` | `write_file` | 用 `mode: "write" \| "append"` 区分 |
| `copy_file` + `move_file` | `transfer_file` | 底层逻辑相似，用 `operation` 参数 |
| `search_in_file` + `grep` | `search` | 单文件只是多文件的特例 |
| `delete_lines` + `delete_file` | `delete` | 统一删除操作 |

### 精简后的工具清单（9 个）

| 工具 | 功能 | 参数 |
|------|------|------|
| `read_file` | 读取文件 | `path`, `mode: "lines" \| "bytes"`, `from`, `count` |
| `write_file` | 写入文件 | `path`, `content`, `mode: "write" \| "append"` |
| `search` | 搜索文本 | `path`, `pattern`, `file_pattern?`, `context_lines?` |
| `replace` | 替换文本 | `path`, `search`, `replace`, `replace_all?` |
| `insert` | 插入内容 | `path`, `line`, `content` |
| `delete` | 删除 | `path`, `type?: "file" \| "lines"`, `from?`, `to?` |
| `list` | 列出目录 | `path`, `recursive?`, `pattern?` |
| `transfer` | 复制/移动 | `source`, `dest`, `operation: "copy" \| "move"` |
| `create_dir` | 创建目录 | `path` |

**从 14 个 → 9 个**（减少 36%）

---

## 实施步骤

1. **更新 `data/skills/file-operations/index.js`**
   - 合并相关函数
   - 保持向后兼容（旧工具名作为别名）

2. **更新 `data/skills/file-operations/SKILL.md`**
   - 更新工具描述

3. **更新 `scripts/init-core-skills.js`**
   - 更新工具定义

4. **测试**
   - 确保新旧工具名都能正常工作
   - 测试合并后的参数组合

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 不理解合并后的参数 | 中 | 提供清晰的参数描述和示例 |
| 现有对话中的工具调用失败 | 低 | 保持旧工具名作为别名 |
| 参数组合复杂度增加 | 低 | 使用 JSON Schema 枚举限制 |

---

## 参考

- [skill-md-standard.md](../guides/skill-md-standard.md) - SKILL.md 标准格式
- [init-core-skills.js](../../scripts/init-core-skills.js) - 核心技能定义
