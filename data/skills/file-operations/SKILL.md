---
name: file-operations
description: "文件系统操作。用于读取、写入、搜索、管理文件。当需要在数据目录中操作文件时触发。"
argument-hint: "[read|write|grep|info|action] [path]"
user-invocable: true
---

# File Operations - 文件系统操作

完整的文件系统操作，用于读取、写入、搜索和管理文件。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `fs_info` | 获取文件/目录信息 | `path`, `include_content_preview`, `hash` |
| `read_file` | 读取文件 | `path`, `mode`, `from`, `lines` |
| `list_files` | 列出目录内容 | `path`, `recursive` |
| `fs_grep` | 搜索文本 | `pattern`, `path`, `use_regex` |
| `write_file` | 写入文件 | `path`, `content`, `mode` |
| `replace_in_file` | 替换文本 | `path`, `old`, `new` |
| `edit_lines` | 编辑行 | `path`, `operation`, `line`, `content` |
| `fs_action` | 文件操作 | `operation`, `source`, `destination`, `path` |

## 文件信息

### fs_info

获取文件或目录的详细元数据。**建议在其他操作前先调用**。

**参数：**
- `path` (string, required): 文件或目录路径
- `include_content_preview` (boolean, optional): 包含内容预览（默认: false）
- `hash` (string, optional): 计算文件哈希 - `"md5"`, `"sha256"`, `"sha1"`

**返回：**
- `exists`, `type`, `size`, `sizeHuman`
- `created`, `modified`, `accessed`
- `isReadOnly`, `pathInfo`, `mimeType`, `isTextFile`
- `directoryInfo` (目录), `contentPreview` (文件)

## 读取文件

### read_file

读取文件内容，支持多种模式。

**参数：**
- `path` (string, required): 文件路径
- `mode` (string, optional): 读取模式 - `"lines"` (默认), `"bytes"`, 或 `"data_url"`
- `from` (number, optional): 起始行（lines 模式，默认: 1）
- `lines` (number, optional): 行数（lines 模式，默认: 100）
- `offset` (number, optional): 起始字节（bytes 模式，默认: 0）
- `bytes` (number, optional): 字节数（bytes 模式，默认: 50000）

**读取模式：**
| 模式 | 说明 | 用途 |
|------|------|------|
| `lines` | 按行读取（默认） | 读取文本文件 |
| `bytes` | 按字节读取 | 读取二进制文件片段 |
| `data_url` | 转换为 Data URL | **多模态 LLM 调用** |

**data_url 模式（用于多模态）：**

让多模态专家能够"看到"图片文件内容。

> ⚠️ **重要**：此功能仅对多模态模型有效！如果专家使用的是纯文本模型，图片数据将被忽略。

**何时使用：**
- 用户要求"看图片"、"分析图片"、"识别图片内容"
- 用户上传了图片文件并要求分析
- 需要将图片内容发送给多模态 LLM 进行处理

**使用方法：**
1. 调用 `read_file(path="tasks/screenshot.png", mode="data_url")`
2. 系统自动将图片 Data URL 转换为多模态格式发送给模型
3. 多模态模型即可"看到"图片内容

**完整示例：**
```
# 用户：请帮我分析这张截图

# 专家调用工具：
read_file(path="tasks/screenshot.png", mode="data_url")

# 工具返回：
{
  success: true,
  data: {
    dataUrl: "data:image/png;base64,iVBORw0KGgo...",
    mimeType: "image/png"
  }
}

# 系统自动处理：
# ToolManager.formatToolResultsForLLM() 检测到 dataUrl
# 自动添加 Markdown 图片语法到工具结果中
# LLMClient.processMultimodalMessages() 转换为多模态格式
# 多模态模型接收到图片并可以"看到"内容

# 专家回复：
根据截图内容，我可以看到这是一个...
```

**工作原理（自动处理）：**
1. `read_file(mode="data_url")` 返回 base64 编码的 Data URL
2. `ToolManager.formatToolResultsForLLM()` 检测到工具结果中的 `dataUrl`
3. 自动在工具结果中添加 Markdown 图片语法：`![工具读取的图片](data:image/png;base64,...)`
4. `LLMClient.processMultimodalMessages()` 检测到 Markdown 图片语法
5. 自动转换为 OpenAI 多模态格式：`{ type: "image_url", image_url: { url: "data:..." } }`
6. 多模态模型接收并"看到"图片

> ✅ **新特性**：系统现在会自动处理图片 Data URL，专家无需手动添加 Markdown 语法！

**支持的文件类型：**
- 图片：png, jpg, jpeg, gif, webp, svg, bmp, ico
- 文档：pdf（部分多模态模型支持）
- 音视频：mp3, wav, mp4, webm（部分模型支持）

**限制：**
- 最大文件大小：10MB（data_url 模式）
- 仅多模态模型（model_type="multimodal"）能处理图片

### list_files

列出目录内容。

**参数：**
- `path` (string, required): 目录路径
- `recursive` (boolean, optional): 递归列出（默认: false）

## 搜索

### fs_grep

跨文件搜索文本。

**参数：**
- `pattern` (string, required): 搜索模式
- `path` (string, optional): 文件或目录路径（默认: 当前）
- `file_pattern` (string, optional): 文件模式过滤（默认: "*"）
- `use_regex` (boolean, optional): 使用正则模式（默认: false）
- `ignore_case` (boolean, optional): 忽略大小写（默认: true）

**搜索模式：**
| 模式 | 说明 | 示例 |
|------|------|------|
| 字面量（默认） | 简单字符串匹配 | `pattern: "TODO"` |
| 正则 | 完整正则支持 | `pattern: "TODO\\d+"` |

## 写入文件

### write_file

写入内容到文件。

**参数：**
- `path` (string, required): 文件路径
- `content` (string, required): 写入内容
- `mode` (string, optional): 写入模式 - `"write"` (默认) 或 `"append"`

### replace_in_file

替换文件中的文本。

**参数：**
- `path` (string, required): 文件路径
- `old` (string, required): 要替换的文本
- `new` (string, required): 替换后的文本

### edit_lines

编辑文件行。

**参数：**
- `path` (string, required): 文件路径
- `operation` (string, optional): 操作类型 - `"insert"` (默认) 或 `"delete"`
- `line` (number, required): 行号（从1开始）
- `end_line` (number, optional): 结束行（delete 操作）
- `content` (string, required for insert): 插入内容

## 文件操作

### fs_action

统一的文件系统操作。

**参数：**
- `operation` (string, optional): 操作类型 - `"copy"` (默认), `"move"`, `"delete"`, `"create_dir"`
- `source` (string, required for copy/move): 源路径
- `destination` (string, required for copy/move): 目标路径
- `path` (string, required for delete/create_dir): 路径

| 操作 | 说明 | 必需参数 |
|------|------|----------|
| `copy` | 复制文件 | `source`, `destination` |
| `move` | 移动文件 | `source`, `destination` |
| `delete` | 删除文件或目录 | `path` |
| `create_dir` | 创建目录 | `path` |

## 最佳实践

1. **先调用 `fs_info`** 检查文件是否存在、类型、大小
2. **使用 `include_content_preview`** 快速了解文件结构
3. **处理大文件时** 检查 `size`，使用 `from`/`lines` 分块读取
4. **内容替换** 使用 `replace_in_file`，行操作使用 `edit_lines`
