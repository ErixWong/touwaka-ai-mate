# File Operations 技能精简方案

> 状态：✅ 第一阶段完成
> 优先级：中
> 创建日期：2026-03-01
> 更新日期：2026-03-01

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

## 精简方案（分阶段实施）

### 第一阶段：无争议合并（3 组）

| 现有工具 | 合并为 | 理由 | 状态 |
|----------|--------|------|------|
| `read_lines` + `read_bytes` | `read_file` | 都是读文件，用 `mode` 参数区分 | ✅ |
| `write_file` + `append_file` | `write_file` | 用 `mode: "write" \| "append"` 区分 | ✅ |
| `copy_file` + `move_file` | `transfer` | 底层逻辑相似，用 `operation` 参数 | ✅ |

### 第二阶段：待评估合并（2 组）

| 现有工具 | 合并为 | 评估 | 状态 |
|----------|--------|------|------|
| `search_in_file` + `grep` | `search` | ⚠️ 单文件搜索带上下文，多文件不带，合并后参数复杂 | 🔍 待定 |
| `delete_lines` + `delete_file` | `delete` | ⚠️ 删除文件和删除行语义差异大，LLM 可能混淆 | 🔍 待定 |

### 保留独立的工具（5 个）

| 工具 | 理由 |
|------|------|
| `replace_in_file` | 独立且高频使用 |
| `insert_at_line` | 精确插入是独特操作 |
| `list_files` | 目录列表是独立功能 |
| `create_dir` | 创建目录是独立功能 |
| `delete_lines` | 与 delete_file 语义差异大，建议保留 |

---

## 精简后的工具清单（11 个）

| 工具 | 功能 | 参数 |
|------|------|------|
| `read_file` | 读取文件 | `path`, `mode: "lines" \| "bytes"`, `from`, `count` |
| `write_file` | 写入文件 | `path`, `content`, `mode: "write" \| "append"` |
| `transfer` | 复制/移动 | `source`, `dest`, `operation: "copy" \| "move"` |
| `search_in_file` | 单文件搜索 | `path`, `pattern`, `context_lines?` |
| `grep` | 多文件搜索 | `path`, `pattern`, `file_pattern?` |
| `replace_in_file` | 替换文本 | `path`, `search`, `replace`, `replace_all?` |
| `insert_at_line` | 插入内容 | `path`, `line`, `content` |
| `delete_lines` | 删除指定行 | `path`, `from`, `to` |
| `delete_file` | 删除文件/目录 | `path` |
| `list_files` | 列出目录 | `path`, `recursive?`, `pattern?` |
| `create_dir` | 创建目录 | `path` |

**从 14 个 → 11 个**（减少 21%）

---

## 实施步骤

### 第一阶段（当前）

1. **更新 `data/skills/file-operations/index.js`**
   - 合并 `read_lines` + `read_bytes` → `read_file`
   - 合并 `write_file` + `append_file` → `write_file`
   - 合并 `copy_file` + `move_file` → `transfer`
   - 保持向后兼容（旧工具名作为别名）

2. **更新 `data/skills/file-operations/SKILL.md`**
   - 更新工具描述

3. **更新 `scripts/init-core-skills.js`**
   - 更新工具定义

4. **测试**
   - 确保新旧工具名都能正常工作
   - 测试合并后的参数组合

### 第二阶段（待评估）

- 观察第一阶段效果
- 评估是否继续合并 search 和 delete 相关工具

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 不理解合并后的参数 | 中 | 提供清晰的参数描述和示例 |
| 现有对话中的工具调用失败 | 低 | 保持旧工具名作为别名 |
| 参数组合复杂度增加 | 低 | 使用 JSON Schema 枚举限制 |
| 过度合并导致语义不清 | 高 | 分阶段实施，保留有争议的工具 |

---

## 参考

- [skill-md-standard.md](../guides/skill-md-standard.md) - SKILL.md 标准格式
- [init-core-skills.js](../../scripts/init-core-skills.js) - 核心技能定义
