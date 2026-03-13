# Task 001: 工具命名格式变更

## 目标

修改传给 LLM 的 tools 数组中工具名称的格式，以更好地适配 LLM 的理解。

### 变更内容

| 项目 | 旧格式 | 新格式 |
|------|--------|--------|
| 格式 | `{skill_id后6位}_{tool_name}` | `{tool_name}__{skill_id后4位}` |
| 示例 | `8h9i0_zip` | `zip__8h90` |
| 分隔符 | `_` (单下划线) | `__` (双下划线) |

### 变更原因

1. 将 `tool_name` 放在前面，让 LLM 更容易理解工具的功能
2. 使用双下划线 `__` 作为分隔符，避免与 tool_name 中可能存在的下划线混淆
3. skill_id 缩短为后4位，进一步减少 token 消耗

## 影响范围

- `lib/skill-loader.js` - 2处修改
  - `convertToolToOpenAIFormat()` 方法 (第212-215行)
  - `parseToolsFromMarkdown()` 方法 (第703-705行)

## 状态

- [x] 分析代码位置
- [ ] 实施修改
- [ ] 验证测试
- [ ] 提交 PR