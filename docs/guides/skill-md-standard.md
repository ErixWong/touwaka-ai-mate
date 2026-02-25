# SKILL.md 结构标准

> 基于 [anthropics/skills](https://github.com/anthropics/skills) 官方仓库的 skill-creator 指南整理

## 概述

Skills 是模块化、自包含的包，通过提供专业知识、工作流程和工具来扩展 Claude 的能力。可以将它们视为特定领域或任务的"入门指南"——它们将 Claude 从通用代理转变为配备了程序性知识的专业代理。

## 目录结构

```
skill-name/
├── SKILL.md              (必需)
│   ├── YAML frontmatter  (必需)
│   │   ├── name          (必需)
│   │   ├── description   (必需)
│   │   └── compatibility (可选，很少需要)
│   └── Markdown body     (必需)
└── Bundled Resources     (可选)
    ├── scripts/          - 可执行代码 (Python/Bash 等)
    ├── references/       - 按需加载到上下文中的文档
    └── assets/           - 输出中使用的文件 (模板、图标、字体等)
```

## SKILL.md 文件结构详解

### 整体结构

SKILL.md 文件由两部分组成：

```
---
[YAML frontmatter 内容]
---

[Markdown body 内容]
```

### 1. YAML Frontmatter（必需）

**位置**：文件开头，用 `---` 包围

**格式**：标准 YAML 格式

**作用**：包含技能的元数据，其中 `name` 和 `description` 是 Claude 决定何时触发技能的主要依据

**加载时机**：始终在上下文中（约 100 字）

```yaml
---
name: skill-name
description: 技能描述，这是主要的触发机制
license: 可选，许可证信息
compatibility: 可选，环境要求
---
```

**重要说明**：
- 只有 `name` 和 `description` 会被 Claude 读取来决定何时触发技能
- 所有"何时使用"的信息都应该放在 `description` 中，而不是 body 中
- body 只有在技能触发后才会加载，所以 body 中的"使用场景"说明是无效的

### 2. Markdown Body（必需）

**位置**：frontmatter 之后，直到文件结束

**格式**：标准 Markdown 格式

**作用**：包含使用技能和捆绑资源的说明、工作流程指导

**加载时机**：技能触发时加载（建议 <5k 字，<500 行）

**推荐结构**：

```markdown
# 技能名称

简短介绍（1-2 句话）

## Quick Start / 快速开始

最基本的用法示例

## Tools / 工具

### tool-name
工具描述和参数说明

## Advanced Features / 高级功能

- **功能1**: See [reference1.md](references/reference1.md)
- **功能2**: See [reference2.md](references/reference2.md)

## Configuration / 配置

必要的配置说明
```

### 渐进式加载系统

技能使用三级加载系统来有效管理上下文：

| 级别 | 内容 | 加载时机 | 大小限制 | 说明 |
|------|------|----------|----------|------|
| 1 | Frontmatter (name + description) | 始终加载 | ~100 字 | 用于触发决策 |
| 2 | SKILL.md body | 技能触发时 | <5k 字，<500 行 | 核心工作流程 |
| 3 | 捆绑资源 (scripts/references/assets) | Claude 按需决定 | 无限制 | 详细参考和工具 |

## YAML Frontmatter 字段

### 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能名称，用于标识 |
| `description` | string | 技能描述，**这是主要的触发机制**，帮助 Claude 理解何时使用该技能 |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `license` | string | 许可证信息，如 "Complete terms in LICENSE.txt" |
| `compatibility` | object | 环境要求（目标产品、系统包等），大多数技能不需要 |

### 官方规范说明

> **重要**：根据官方 skill-creator 指南，**不要在 frontmatter 中包含除 `name` 和 `description` 之外的其他字段**。
> 
> 只有 `name` 和 `description` 会被 Claude 读取来决定何时触发技能。其他字段（如 `license`、`compatibility`）虽然允许存在，但对触发机制没有影响。

### Frontmatter 示例

```yaml
---
name: pdf
description: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. When Claude needs to fill in a PDF form or programmatically process, generate, or analyze PDF documents at scale.
license: Proprietary. LICENSE.txt has complete terms
---
```

```yaml
---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations.
license: Complete terms in LICENSE.txt
---
```

### Description 编写指南

`description` 是技能的主要触发机制，编写时应：

1. **包含技能功能** - 描述技能做什么
2. **包含触发场景** - 具体说明何时应该使用该技能
3. **将所有"何时使用"信息放在这里** - 而不是放在 body 中，因为 body 只有在技能触发后才会加载

**好的 description 示例**：
```
Comprehensive document creation, editing, and analysis with support for tracked changes, comments, formatting preservation, and text extraction. Use when Claude needs to work with professional documents (.docx files) for: (1) Creating new documents, (2) Modifying or editing content, (3) Working with tracked changes, (4) Adding comments, or any other document tasks
```

## Markdown Body

Body 包含使用技能及其捆绑资源的说明。只有在技能触发后才会加载到上下文中。

### Body 编写原则

1. **简洁至上** - 上下文窗口是公共资源，技能与其他内容共享上下文
2. **默认假设 Claude 已经很聪明** - 只添加 Claude 没有的上下文
3. **挑战每条信息** - "Claude 真的需要这个解释吗？"、"这段话值得它的 token 成本吗？"
4. **优先使用简洁示例而非冗长解释**
5. **使用祈使句/不定式形式** - 如 "Extract text" 而不是 "Extracts text"

### 设置适当的自由度

匹配任务的具体程度和可变性：

- **高自由度**（基于文本的指令）：当多种方法有效、决策取决于上下文时使用
- **中等自由度**（伪代码或带参数的脚本）：当存在首选模式、某些变化可接受时使用
- **低自由度**（特定脚本、少量参数）：当操作脆弱易出错、一致性关键时使用

### 工作流程模式

#### 顺序工作流程

对于复杂任务，将操作分解为清晰的顺序步骤：

```markdown
Filling a PDF form involves these steps:

1. Analyze the form (run analyze_form.py)
2. Create field mapping (edit fields.json)
3. Validate mapping (run validate_fields.py)
4. Fill the form (run fill_form.py)
5. Verify output (run verify_output.py)
```

#### 条件工作流程

对于有分支逻辑的任务，指导 Claude 通过决策点：

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below

2. Creation workflow: [steps]
3. Editing workflow: [steps]
```

### 输出模式

#### 模板模式

为输出格式提供模板，匹配严格程度与需求：

**严格要求的模板**（如 API 响应或数据格式）：
```markdown
## Report structure

ALWAYS use this exact template structure:

# [Analysis Title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
```

**灵活指导的模板**（当适应性有用时）：
```markdown
## Report structure

Here is a sensible default format, but use your best judgment:

# [Analysis Title]

## Executive summary
[Overview]

## Key findings
[Adapt sections based on what you discover]

Adjust sections as needed for the specific analysis type.
```

#### 示例模式

对于输出质量依赖于看到示例的技能，提供输入/输出对：

```markdown
## Commit message format

Generate commit messages following these examples:

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware

**Example 2:**
Input: Fixed bug where dates displayed incorrectly in reports
Output:
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation

Follow this style: type(scope): brief description, then detailed explanation.
```

## 捆绑资源 (Bundled Resources)

### scripts/ - 可执行代码

用于需要确定性可靠性或被重复重写的任务。

- **何时包含**：当相同的代码被重复重写或需要确定性可靠性时
- **示例**：`scripts/rotate_pdf.py` 用于 PDF 旋转任务
- **好处**：节省 token、确定性、可在不加载到上下文的情况下执行

### references/ - 参考文档

用于在执行过程中按需加载到上下文中的文档。

- **何时包含**：用于 Claude 在工作时应参考的文档
- **示例**：
  - `references/finance.md` - 财务模式
  - `references/api_docs.md` - API 规范
  - `references/policies.md` - 公司政策
- **用例**：数据库模式、API 文档、领域知识、公司政策、详细工作流程指南
- **最佳实践**：如果文件很大（>10k 字），在 SKILL.md 中包含 grep 搜索模式

### assets/ - 输出资源

用于在 Claude 产生的输出中使用的文件。

- **何时包含**：当技能需要在最终输出中使用的文件时
- **示例**：
  - `assets/logo.png` - 品牌资产
  - `assets/slides.pptx` - PowerPoint 模板
  - `assets/frontend-template/` - HTML/React 样板
- **用例**：模板、图像、图标、样板代码、字体、示例文档

## 渐进式披露设计原则

技能使用三级加载系统来有效管理上下文：

| 级别 | 内容 | 加载时机 | 大小限制 |
|------|------|----------|----------|
| 1 | 元数据 (name + description) | 始终在上下文中 | ~100 字 |
| 2 | SKILL.md body | 技能触发时 | <5k 字 |
| 3 | 捆绑资源 | Claude 按需决定 | 无限制 |

### 渐进式披露模式

**模式 1：高级指南 + 引用**
```markdown
# PDF Processing
## Quick start
Extract text with pdfplumber:
[code example]

## Advanced features
- **Form filling**: See [FORMS.md](FORMS.md) for complete guide
- **API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
- **Examples**: See [EXAMPLES.md](EXAMPLES.md) for common patterns
```

**模式 2：按领域组织**
```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
    ├── finance.md (revenue, billing metrics)
    ├── sales.md (opportunities, pipeline)
    ├── product.md (API usage, features)
    └── marketing.md (campaigns, attribution)
```

**模式 3：条件详情**
```markdown
# DOCX Processing
## Creating documents
Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents
For simple edits, modify the XML directly.
**For tracked changes**: See [REDLINING.md](REDLINING.md)
**For OOXML details**: See [OOXML.md](OOXML.md)
```

## 不应包含的内容

技能应只包含直接支持其功能的必要文件。**不要**创建以下额外文档：

- README.md
- INSTALLATION_GUIDE.md
- QUICK_REFERENCE.md
- CHANGELOG.md
- 等等

技能应只包含 AI 代理完成手头工作所需的信息。不应包含关于创建过程的辅助上下文、设置和测试程序、面向用户的文档等。创建额外的文档文件只会增加混乱。

## 技能创建流程

技能创建涉及以下步骤：

1. **理解技能的具体用例** - 明确技能将如何被使用
2. **规划可复用的技能内容** - 确定 scripts、references、assets
3. **初始化技能** - 创建目录结构
4. **编辑技能** - 实现资源并编写 SKILL.md
5. **打包技能** - 验证并打包为 .skill 文件
6. **迭代** - 基于实际使用进行改进

按顺序遵循这些步骤，只有在有明确理由不适用时才跳过。

### Step 1: 理解技能的具体用例

只有当技能的使用模式已经清楚理解时才跳过此步骤。

要创建有效的技能，需要清楚理解技能将如何被使用的具体示例。这种理解可以来自直接的用户示例或经过用户反馈验证的生成示例。

例如，在构建 image-editor 技能时，相关问题包括：

- "image-editor 技能应该支持什么功能？编辑、旋转，还有其他吗？"
- "你能给出一些这个技能如何被使用的例子吗？"
- "用户会说什么来触发这个技能？"

为了避免让用户不知所措，避免在一条消息中问太多问题。从最重要的问题开始，根据需要进行后续提问。

### Step 2: 规划可复用的技能内容

要将具体示例转化为有效的技能，分析每个示例：

1. 考虑如何从头开始执行该示例
2. 确定在重复执行这些工作流程时，哪些 scripts、references 和 assets 会有帮助

**示例分析**：

- 构建 `pdf-editor` 技能：旋转 PDF 每次都需要重写相同的代码 → `scripts/rotate_pdf.py` 会有帮助
- 构建 `frontend-webapp-builder` 技能：编写前端 webapp 每次都需要相同的样板 HTML/React → `assets/hello-world/` 模板会有帮助
- 构建 `big-query` 技能：查询 BigQuery 每次都需要重新发现表模式和关系 → `references/schema.md` 会有帮助

### Step 3: 初始化技能

只有当正在开发的技能已经存在，需要迭代或打包时，才跳过此步骤。

从头创建新技能时，应使用初始化脚本生成模板技能目录，自动包含技能所需的一切。

### Step 4: 编辑技能

编辑技能时，记住技能是为另一个 Claude 实例使用而创建的。包含对 Claude 有益且非显而易见的信息。

**从可复用内容开始**：首先实现 `scripts/`、`references/` 和 `assets/` 文件。

**测试脚本**：添加的脚本必须通过实际运行来测试，确保没有错误且输出符合预期。

**更新 SKILL.md**：
- 使用祈使句/不定式形式
- 在 frontmatter 中只包含 `name` 和 `description` 字段
- 不要在 frontmatter 中包含其他字段

### Step 5: 打包技能

技能开发完成后，需要打包为可分发的 .skill 文件。打包过程会自动验证技能以确保满足所有要求：

1. **验证**：
   - YAML frontmatter 格式和必需字段
   - 技能命名约定和目录结构
   - 描述完整性和质量
   - 文件组织和资源引用

2. **打包**：如果验证通过，创建以技能命名的 .skill 文件（如 `my-skill.skill`），包含所有文件并保持正确的目录结构。.skill 文件是带有 .skill 扩展名的 zip 文件。

如果验证失败，脚本将报告错误并退出而不创建包。

### Step 6: 迭代

测试技能后，用户可能会请求改进。

**迭代工作流程**：
1. 在真实任务上使用技能
2. 注意困难或低效之处
3. 确定 SKILL.md 或捆绑资源应如何更新
4. 实施更改并再次测试

## 完整示例

### 示例 1：PDF 技能

```yaml
---
name: pdf
description: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. When Claude needs to fill in a PDF form or programmatically process, generate, or analyze PDF documents at scale.
license: Proprietary. LICENSE.txt has complete terms
---
```

### 示例 2：SearXNG 搜索技能

```yaml
---
name: searxng
description: Search the web using your local SearXNG instance. Use when you need to search for current information, news, or any content that requires web search capabilities.
argument-hint: "[query]"
allowed-tools:
  - Bash(curl *)
---
```

## 与本项目集成的字段

在本项目 (Touwaka Mate) 中，我们还支持以下扩展字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `argument-hint` | string | 参数提示，显示给用户 |
| `disable-model-invocation` | boolean | 是否禁用模型调用 |
| `user-invocable` | boolean | 是否可由用户直接调用 |
| `allowed-tools` | string[] | 允许使用的工具列表 |

这些字段在解析 SKILL.md 时会被提取并存储到数据库中。

## 解析器实现规范

本节定义解析器（`lib/skill-analyzer.js`）应遵循的规范。

### Frontmatter 解析规则

#### 1. 边界识别

```
文件开头必须是 ---
以单独一行的 --- 结束 frontmatter
```

正则表达式：`/^---\s*\n([\s\S]*?)\n---/`

#### 2. 字段名规范

- **只支持英文字段名**，不支持中文字段名
- 字段名使用小写字母和连字符（kebab-case），如 `argument-hint`
- 解析器不区分字段名中的下划线和连字符（可选实现）

#### 3. 数据类型解析

| YAML 格式 | 解析为 | 示例 |
|-----------|--------|------|
| `key: value` | string | `name: pdf` |
| `key: "value"` | string | `name: "pdf"` |
| `key: 'value'` | string | `name: 'pdf'` |
| `key: true/false` | boolean | `disable-model-invocation: true` |
| `key: 123` | number | `timeout: 30` |
| `key: [a, b]` | string[] | `allowed-tools: [Bash, curl]` |
| `key:\n  - a\n  - b` | string[] | 多行数组 |
| `key: \|` | string (multiline) | 多行文本，保留换行 |
| `key: >` | string (multiline) | 多行文本，换行转空格 |

#### 4. 字段映射

解析后的字段应映射到以下内部属性：

| YAML 字段 | 内部属性 | 默认值 |
|-----------|----------|--------|
| `name` | `name` | `''` |
| `description` | `description` | `''` |
| `license` | `license` | `''` |
| `argument-hint` | `argument_hint` | `''` |
| `disable-model-invocation` | `disable_model_invocation` | `false` |
| `user-invocable` | `user_invocable` | `true` |
| `allowed-tools` | `allowed_tools` | `[]` |

### Body 解析规则

#### 1. 标题解析

- 如果 frontmatter 中没有 `name`，从第一个 `# ` 标题提取名称
- 如果 frontmatter 中有 `name`，忽略 `# ` 标题

#### 2. 工具部分解析

触发条件（任一）：
- `## Tools`
- `## 工具`
- `## Commands`
- `## 命令`

工具定义格式：
```markdown
### tool-name
工具描述

**Parameters:**
- `param1` (type, required): 描述
- `param2` (type, optional): 描述
```

#### 3. 代码块处理

- 代码块（\`\`\`）内的内容应被跳过，不解析为结构化内容
- 跟踪代码块状态，正确处理嵌套

### 错误处理

| 情况 | 处理方式 |
|------|----------|
| 缺少 frontmatter | 返回默认值，继续解析 body |
| frontmatter 格式错误 | 尝试部分解析，记录警告 |
| 未知字段 | 忽略，不报错 |
| 类型转换失败 | 保留原始字符串 |
| 文件为空 | 返回所有字段的默认值 |

### 完整解析示例

输入：
```yaml
---
name: searxng
description: |
  Search the web using your local SearXNG instance.
  Use when you need current information.
argument-hint: "[query]"
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Bash(curl *)
  - WebFetch
---

# SearXNG Search

Search the web using SearXNG.

## Tools

### web_search

Search the web.

**Parameters:**
- `query` (string, required): Search query
- `n` (number, optional): Number of results
```

输出：
```javascript
{
  name: 'searxng',
  description: 'Search the web using your local SearXNG instance.\nUse when you need current information.',
  argument_hint: '[query]',
  disable_model_invocation: false,
  user_invocable: true,
  allowed_tools: ['Bash(curl *)', 'WebFetch'],
  tools: [
    {
      name: 'web_search',
      description: 'Search the web.',
      type: 'http',
      usage: ''
    }
  ]
}
```

## 参考资源

- [anthropics/skills GitHub 仓库](https://github.com/anthropics/skills)
- [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
