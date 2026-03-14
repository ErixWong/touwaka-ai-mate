---
name: user-code-executor
description: 在安全沙箱中执行用户自定义代码（JavaScript/Python），支持内联代码和脚本文件执行。
argument-hint: "[execute_javascript|execute_python] --code='...' or --script_path='...'"
user-invocable: true
allowed-tools: []
---

# User Code Executor

在安全沙箱中执行用户自定义代码。

## 功能

- 执行用户提供的 JavaScript 代码（VM 沙箱）
- 执行用户提供的 Python 代码（受限环境）
- 从工作目录加载脚本文件

## 安全限制

- **执行超时**: JavaScript 30秒 / Python 5分钟
- **内存限制**: 128MB
- **文件访问**: 仅限用户工作目录
- **模块访问**: 白名单控制

## 配置要求

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `WORKING_DIRECTORY` | 用户工作目录（相对 DATA_BASE_PATH） | 可选 |
| `DATA_BASE_PATH` | 数据基础路径 | ✅ |
| `VM_TIMEOUT` | JS 执行超时（毫秒） | 可选 |
| `PYTHON_TIMEOUT` | Python 执行超时（毫秒） | 可选 |

## 工具清单

### execute_javascript

在 VM 沙箱中执行 JavaScript 代码。

**描述**: 执行用户提供的 JavaScript 代码，支持内联代码或加载脚本文件。

**参数:**
- `code` (string, optional): 要执行的 JavaScript 代码（与 script_path 二选一）
- `script_path` (string, optional): 脚本文件路径，相对于用户工作目录（与 code 二选一）

**script_path**: `index.js`

**返回示例:**
```json
{
  "success": true,
  "result": 2,
  "stdout": "",
  "stderr": "",
  "duration": 1,
  "source": "inline"
}
```

### execute_python

在受限环境中执行 Python 代码。

**描述**: 执行用户提供的 Python 代码，支持内联代码或加载脚本文件。

**参数:**
- `code` (string, optional): 要执行的 Python 代码（与 script_path 二选一）
- `script_path` (string, optional): 脚本文件路径，相对于用户工作目录（与 code 二选一）

**script_path**: `index.js`

**返回示例:**
```json
{
  "success": true,
  "result": null,
  "stdout": "Hello",
  "stderr": "",
  "duration": 100,
  "source": "inline"
}
```

## 使用示例

### 执行内联 JavaScript

```
execute_javascript({
  code: "const x = 10; x * 2;"
})
// 返回: { success: true, result: 20 }
```

### 执行脚本文件

```
execute_javascript({
  script_path: "scripts/my-script.js"
})
// 从用户工作目录加载 scripts/my-script.js 并执行
```

### 执行 Python 代码

```
execute_python({
  code: "print('Hello from Python!')"
})
// 返回: { success: true, stdout: "Hello from Python!" }
```

## 错误处理

| 错误类型 | 说明 |
|----------|------|
| 超时错误 | 代码执行超过时间限制 |
| 内存错误 | 内存使用超过限制 |
| 权限错误 | 访问不允许的路径或模块 |
| 语法错误 | 代码语法错误 |
| 运行时错误 | 执行过程中的错误 |

## 注意事项

- 此技能需要 `vm` 和 `child_process` 模块支持
- Python 执行需要系统安装 Python 3
- 文件访问限制在用户工作目录内
- 不允许相对路径导入（`./` 或 `../`）