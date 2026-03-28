# Function Calling 最佳实践：Tools Parameter 与 System Prompt

> 本文档基于 OpenAI 官方文档和行业最佳实践，分析 `tools` 参数与 System Prompt 的关系，指导如何正确设计技能相关的 System Prompt。

## 关键问题：LLM 如何建立 tool_name 与技能场景的关联？

### 问题分析

当 `tools` 参数只包含工具定义时：

```json
{
  "name": "kb-search__search",
  "description": "在指定知识库中进行语义搜索",
  "parameters": { ... }
}
```

**LLM 只能看到**：
- 工具名称：`kb-search__search`
- 工具描述：功能说明
- 参数定义

**LLM 看不到**：
- 这个工具属于哪个"技能"
- 什么场景下应该使用这个技能
- 技能的整体功能和定位

### 推荐方案：System Prompt 解释命名空间

本项目的工具命名规则是 `skill_mark__tool_name`，其中 `skill_mark` 是技能的语义标识。**当 LLM 遇到某种场景需要调用技能时，可以根据技能的 mark 在 tools 数组中寻找对应的工具。**

这需要在 System Prompt 中添加：
1. **命名空间格式解释** - 告诉 LLM 如何解析 tool_name
2. **技能 mark 与场景映射** - 告诉 LLM 什么场景使用什么 mark

#### 推荐的 System Prompt 格式

```markdown
## 技能使用指南

### 工具命名规范

工具名称格式为 `skill_mark__tool_name`，其中：
- `skill_mark` 是技能的语义标识（如 `kb-search`）
- `tool_name` 是具体工具名称（如 `search`）
- `__` 是命名空间分隔符

### 可用技能

| 技能标识 | 技能名称 | 使用场景 | 典型工具 |
|---------|---------|---------|---------|
| `kb-search` | 知识库搜索 | 查询知识库内容、搜索专业知识 | `kb-search__search`, `kb-search__global_search` |
| `docx` | Word 文档处理 | 创建或编辑 .docx 文件 | `docx__create`, `docx__read` |
| `pdf` | PDF 处理 | 读取或转换 PDF 文件 | `pdf__read`, `pdf__to_images` |
| `file-operations` | 文件操作 | 文件系统操作、文件信息查询 | `file-operations__fs_info`, `file-operations__read_file` |

### 使用建议

1. **识别场景** → 确定需要哪个技能（如：用户要搜索知识库 → `kb-search`）
2. **查找工具** → 在 tools 数组中找到以 `kb-search__` 开头的工具
3. **选择工具** → 根据工具描述选择最合适的工具（如 `kb-search__search`）
4. **调用工具** → 按参数要求构造调用

### 注意事项

- 如果信息不足，先询问用户再调用工具
- 文件操作前必须先用 `file-operations__fs_info` 检查文件类型
- 技能工具的详细参数说明在各自的工具描述中
```

#### 为什么这个方案更符合实际情况

1. **利用命名空间语义**：`skill_mark` 已经体现在 tool_name 中，LLM 可以直接根据 mark 定位工具
2. **避免信息冗余**：不在 System Prompt 中重复工具描述，只在 tools 参数中保留
3. **清晰的场景映射**：LLM 知道什么场景用什么 mark，然后在 tools 中查找
4. **灵活扩展**：新增技能只需在映射表中添加一行，不影响工具定义

### 工作流程示意

```
用户请求："帮我搜索一下关于 API 设计的知识"
         ↓
LLM 分析场景：需要搜索知识库
         ↓
System Prompt 映射：知识库搜索 → skill_mark = "kb-search"
         ↓
LLM 在 tools 中查找：找到 `kb-search__search`, `kb-search__global_search` 等
         ↓
LLM 选择工具：根据工具描述选择 `kb-search__search`
         ↓
LLM 构造调用：kb-search__search({ kb_id: "...", query: "API 设计" })
```

### 其他方案对比

#### 方案 A：Tool Description 显式说明

在工具描述中添加技能信息：

```json
{
  "name": "kb-search__search",
  "description": "【知识库搜索技能】在指定知识库中进行语义搜索。当用户需要查询专业知识时使用。"
}
```

**问题**：
- 每个工具都要重复技能信息，造成 token 浪费
- 技能信息分散在多个工具描述中，不易维护

#### 方案 B：依赖命名空间推断

让 LLM 自行理解 `kb-search__search` 的含义。

**问题**：
- 依赖 LLM 的推理能力，不够可靠
- 缺少明确的场景映射指导

---

## 核心发现：Tools Parameter 自动注入机制

根据 OpenAI 官方文档：

> "Under the hood, functions are injected into the system message in a syntax the model has been trained on. This means callable function definitions count against the model's context limit and are billed as input tokens."

**关键理解**：

当你通过 `tools` 参数传递工具定义时，OpenAI API 会**自动将这些信息注入到系统消息中**，使用模型训练过的特定语法。这意味着：

1. 工具名称（`name`）会被注入
2. 工具描述（`description`）会被注入
3. 参数定义（`parameters`）会被注入
4. 这些信息计入 context limit 并作为 input tokens 计费

## 常见误区：信息冗余

### 错误做法

在 System Prompt 中重复工具信息：

```markdown
## 你的可用技能

- **知识库搜索**: 搜索知识库内容
  - `kb-search__search`: 搜索知识库，参数：query（必需）
  - `kb-search__insert`: 插入知识条目，参数：content（必需）

当你需要使用这些技能时，系统会自动调用相应的工具。
```

**问题**：

- 工具名称已在 `tools` 参数中定义，重复注入浪费 tokens
- 工具描述已在 `tools[].description` 中，重复可能导致信息不一致
- 参数定义已在 `tools[].parameters` 中，无需在 System Prompt 中重复

### 正确做法

System Prompt 应该包含**无法在 tools 参数中表达的信息**：

```markdown
## 技能使用指南

你拥有多个技能来帮助完成任务。工具名称格式为 `skill_mark__tool_name`：
- `skill_mark` 表示技能标识（如 `kb-search` 表示知识库搜索）
- `tool_name` 表示具体工具名称

**使用建议**：
- 需要搜索知识库时，使用 `kb-search` 技能
- 需要处理文档时，优先使用 `docx` 或 `pdf` 技能
- 不确定文件类型时，先用 `file-operations` 的 `fs_info` 工具获取文件信息

**注意事项**：
- 技能工具需要明确的参数，如果信息不足请询问用户
- 文件操作前必须确认文件路径和类型
```

## System Prompt 应该放什么？

根据 OpenAI 最佳实践：

> "Use the system prompt to describe **when (and when not) to use each function**."

### 应该包含的内容

| 内容类型 | 说明 | 示例 |
|---------|------|------|
| **使用时机指导** | 何时使用某个技能/工具 | "需要搜索知识库时，使用 kb-search 技能" |
| **约束条件** | 何时不应该使用某个工具 | "不要在用户未确认时执行删除操作" |
| **高层上下文** | 工具的组织结构、命名空间含义 | "工具名称格式为 skill_mark__tool_name" |
| **特殊指令** | 无法在 tool description 中表达的信息 | "文件操作前必须先用 fs_info 检查文件类型" |
| **错误处理指导** | 工具失败时如何处理 | "如果工具调用失败，向用户解释并建议替代方案" |

### 不应该包含的内容

| 内容类型 | 原因 | 正确位置 |
|---------|------|---------|
| **工具名称列表** | 已在 tools 参数中 | `tools[].name` |
| **工具描述** | 已在 tools 参数中 | `tools[].description` |
| **参数定义** | 已在 tools 参数中 | `tools[].parameters` |
| **参数类型** | 已在 tools 参数中 | `tools[].parameters.properties` |
| **必需参数列表** | 已在 tools 参数中 | `tools[].parameters.required` |

## Tool Description 最佳实践

既然工具描述会在 `tools` 参数中自动注入，写好 `description` 字段至关重要。

### Description 应该包含

根据 OpenAI 文档：

> "Explicitly describe the purpose of the function and each parameter (and its format), and what the output represents."

1. **功能目的** - 这个工具做什么
2. **使用场景** - 什么时候应该使用
3. **输出含义** - 返回结果代表什么
4. **示例** - 参数格式示例（可选）

### 示例：好的 Description

```json
{
  "name": "kb-search__search",
  "description": "搜索知识库内容。当用户询问专业知识、历史记录、或需要查找特定信息时使用。返回匹配的知识条目列表，每个条目包含标题、内容和相关度分数。示例：搜索 'API 设计' 相关内容。"
}
```

### 示例：不好的 Description

```json
{
  "name": "kb-search__search",
  "description": "搜索知识库"  // 太简短，缺少使用场景和输出说明
}
```

## 参数描述最佳实践

### Parameter Description 应该包含

根据 OpenAI 文档：

> "Parameter descriptions should include: What the parameter represents, Expected format with examples, Constraints or valid ranges, How to infer the value from context"

### 示例：好的 Parameter Description

```json
{
  "parameters": {
    "properties": {
      "query": {
        "type": "string",
        "description": "搜索关键词或问题。支持自然语言查询，如 '如何设计 RESTful API' 或 '用户认证流程'"
      },
      "limit": {
        "type": "integer",
        "description": "返回结果数量限制，默认 10。范围：1-100",
        "default": 10
      }
    }
  }
}
```

## 命名空间设计

### 使用命名空间组织工具

OpenAI 文档推荐：

> "Use namespaces to group related tools by domain, such as `crm`, `billing`, or `shipping`. Namespaces help organize similar tools and are especially useful when the model must choose between tools that serve different systems or purposes."

### 本项目的命名空间设计

采用 `skill_mark__tool_name` 格式：

- `kb-search__search` - 知识库搜索技能的搜索工具
- `kb-search__insert` - 知识库搜索技能的插入工具
- `file-operations__fs_info` - 文件操作技能的文件信息工具
- `docx__create` - DOCX 技能的创建文档工具

**优势**：

1. 清晰的技能归属 - 模型可以快速识别工具所属技能
2. 避免命名冲突 - 不同技能可以有同名工具
3. 语义化标识 - `mark` 字段是稳定的语义标识，跨环境一致

## Token 优化策略

### 问题：大量工具导致 Token 超限

OpenAI 文档指出：

> "If you run into token limits, we suggest limiting the number of functions loaded up front, shortening descriptions where possible, or using tool search so deferred tools are loaded only when needed."

### 优化策略

1. **限制初始加载的工具数量** - 建议少于 20 个
2. **精简描述** - 移除冗余信息，保留关键内容
3. **使用 Tool Search** - 延迟加载不常用的工具（GPT-5.4+ 支持）
4. **移除 System Prompt 中的重复信息** - 避免工具信息被注入两次

## 实践检查清单

### 设计 System Prompt 时检查

- [ ] 是否重复了工具名称？（应在 tools 参数中）
- [ ] 是否重复了工具描述？（应在 tools[].description 中）
- [ ] 是否重复了参数定义？（应在 tools[].parameters 中）
- [ ] 是否包含了使用时机指导？（应保留）
- [ ] 是否包含了约束条件？（应保留）
- [ ] 是否解释了命名空间含义？（应保留）
- [ ] 是否包含了特殊业务逻辑指令？（应保留）

### 设计 Tool Description 时检查

- [ ] 是否说明了功能目的？
- [ ] 是否说明了使用场景？
- [ ] 是否说明了输出含义？
- [ ] 是否提供了参数格式示例？
- [ ] 是否说明了约束条件？

## 参考资料

1. [OpenAI Function Calling Guide](https://developers.openai.com/api/docs/guides/function-calling/) - 官方文档
2. [Function Calling Best Practices](https://groundy.com/articles/function-calling-best-practices-llms-that-actually-use-apis/) - 行业最佳实践
3. [Prompt Engineering Guide - Function Calling](https://www.promptingguide.ai/applications/function_calling) - 提示工程指南

## 相关 Issue

- Issue #417: 技能工具名称统一方案 - 引入 `mark` 字段实现稳定的命名空间

---

*文档创建日期：2026-03-28*
*最后更新：2026-03-28*