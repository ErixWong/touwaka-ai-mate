# Builtin Tools - 内置工具集

## 描述

系统内置的文件操作工具集，提供完整的文件读写、搜索、管理和网络请求能力。

## 何时使用

- 需要读取或写入文件
- 需要搜索文件内容
- 需要管理文件（复制、移动、删除）
- 需要执行脚本
- 需要发送 HTTP 请求

## 工具清单

### 读取类

#### read_lines
按行读取文件内容（默认100行）。

**参数**：
- `path` (string, 必须): 文件路径
- `start` (number, 可选): 起始行（0-based），默认 0
- `count` (number, 可选): 读取行数，默认 100

**示例**：
```json
{ "path": "skills/my-skill/config.json", "start": 0, "count": 50 }
```

#### read_bytes
按字节读取文件内容（默认50KB）。

**参数**：
- `path` (string, 必须): 文件路径
- `start` (number, 可选): 起始字节，默认 0
- `count` (number, 可选): 读取字节数，默认 50000

#### list_files
列出目录内容。

**参数**：
- `path` (string, 必须): 目录路径
- `recursive` (boolean, 可选): 是否递归列出，默认 false
- `pattern` (string, 可选): 文件过滤模式，如 "*.js"

### 写入类

#### write_file
写入文件（覆盖）。

**参数**：
- `path` (string, 必须): 文件路径
- `content` (string, 必须): 文件内容

#### append_file
追加内容到文件。

**参数**：
- `path` (string, 必须): 文件路径
- `content` (string, 必须): 追加内容

### 编辑类

#### replace_in_file
精确替换文件内容。

**参数**：
- `path` (string, 必须): 文件路径
- `search` (string, 必须): 搜索文本
- `replace` (string, 必须): 替换文本
- `replaceAll` (boolean, 可选): 是否替换全部，默认 false

#### insert_at_line
在指定行插入内容。

**参数**：
- `path` (string, 必须): 文件路径
- `line` (number, 必须): 在第几行后插入
- `content` (string, 必须): 插入内容

#### delete_lines
删除指定行。

**参数**：
- `path` (string, 必须): 文件路径
- `start` (number, 必须): 起始行
- `count` (number, 可选): 删除行数，默认 1

### 搜索类

#### search_in_file
在文件中搜索（带上下文）。

**参数**：
- `path` (string, 必须): 搜索路径
- `pattern` (string, 必须): 搜索模式（正则）
- `filePattern` (string, 可选): 文件过滤，如 "*.js"
- `contextLines` (number, 可选): 上下文行数，默认 2

#### grep
跨文件正则搜索。

**参数**：
- `path` (string, 必须): 搜索路径
- `pattern` (string, 必须): 正则模式
- `filePattern` (string, 可选): 文件过滤
- `ignoreCase` (boolean, 可选): 忽略大小写，默认 false

### 管理类

#### copy_file
复制文件。

**参数**：
- `source` (string, 必须): 源文件路径
- `dest` (string, 必须): 目标路径

#### move_file
移动文件。

**参数**：
- `source` (string, 必须): 源文件路径
- `dest` (string, 必须): 目标路径

#### delete_file
删除文件。

**参数**：
- `path` (string, 必须): 文件路径

#### create_dir
创建目录。

**参数**：
- `path` (string, 必须): 目录路径

### 压缩类

#### zip
创建 ZIP 压缩包。

**参数**：
- `source` (string, 必须): 源文件或目录
- `dest` (string, 必须): 目标 ZIP 路径
- `recursive` (boolean, 可选): 递归压缩，默认 true

#### unzip
解压 ZIP 文件。

**参数**：
- `source` (string, 必须): ZIP 文件路径
- `dest` (string, 必须): 解压目标目录
- `overwrite` (boolean, 可选): 覆盖已存在文件，默认 false

### 执行类

#### execute
执行脚本命令。

**参数**：
- `command` (string, 必须): 命令或脚本路径
- `args` (array, 可选): 命令参数
- `timeout` (number, 可选): 超时（毫秒），默认 30000
- `cwd` (string, 可选): 工作目录

### 网络类

#### http_get
发送 HTTP GET 请求。

**参数**：
- `url` (string, 必须): 请求 URL
- `headers` (object, 可选): 请求头
- `timeout` (number, 可选): 超时（毫秒），默认 10000

#### http_post
发送 HTTP POST 请求。

**参数**：
- `url` (string, 必须): 请求 URL
- `body` (any, 可选): 请求体
- `headers` (object, 可选): 请求头
- `timeout` (number, 可选): 超时（毫秒），默认 10000

## 安全措施

1. **路径限制**：所有文件操作限制在 `skills` 目录内
2. **大小限制**：读取默认 50KB，防止上下文爆炸
3. **超时控制**：执行和网络请求有超时限制
4. **危险命令过滤**：禁止 `rm -rf /` 等危险操作

## 注意事项

1. 文件路径相对于 skills 目录
2. 大文件应分批读取
3. 网络请求需要处理超时和错误
4. 执行脚本需谨慎，避免危险命令
