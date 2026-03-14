# User Code Executor

在安全沙箱中执行用户自定义代码。

## 功能

- 执行用户提供的 JavaScript 代码
- 执行用户提供的 Python 代码
- 从工作目录加载脚本文件

## 安全限制

- **执行超时**: JavaScript 30秒 / Python 5分钟
- **内存限制**: 128MB
- **文件访问**: 仅限用户工作目录
- **模块访问**: 白名单控制

## 工具

### execute_javascript

在 VM 沙箱中执行 JavaScript 代码。

参数：
- `code` (string, optional): 要执行的 JavaScript 代码
- `script_path` (string, optional): 脚本文件路径（相对于用户工作目录）

示例：
```javascript
// 执行内联代码
execute_javascript({ code: "return 1 + 1" })

// 执行脚本文件
execute_javascript({ script_path: "scripts/my-script.js" })
```

### execute_python

在受限环境中执行 Python 代码。

参数：
- `code` (string, optional): 要执行的 Python 代码
- `script_path` (string, optional): 脚本文件路径（相对于用户工作目录）

示例：
```python
# 执行内联代码
execute_python({ code: "print('Hello')" })

# 执行脚本文件  
execute_python({ script_path: "scripts/my-script.py" })
```

## 返回值

```json
{
  "success": true,
  "result": "<执行结果>",
  "stdout": "<标准输出>",
  "stderr": "<标准错误>"
}
```

## 错误处理

- 超时错误：代码执行超过时间限制
- 内存错误：内存使用超过限制
- 权限错误：访问不允许的路径或模块
- 语法错误：代码语法错误
- 运行时错误：执行过程中的错误