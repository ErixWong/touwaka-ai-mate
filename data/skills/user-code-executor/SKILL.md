---
name: user-code-executor
description: 在安全沙箱中执行用户自定义 JavaScript 代码，支持内联代码和脚本文件执行。
argument-hint: "execute_javascript --code='...' or --script_path='...'"
user-invocable: true
allowed-tools: []
---

# User Code Executor

在安全沙箱中执行用户自定义 JavaScript 代码。

> **安全架构**: 
> - 用户代码直接在 `skill-runner` 的 VM 沙箱中执行
> - 不需要技能代码文件（`index.js`）
> - 使用严格模式，无法通过原型链逃逸

## 功能

- 执行用户提供的 JavaScript 代码
- 从工作目录加载脚本文件
- 支持异步代码（async/await）

## 安全限制

### 执行环境

用户代码在隔离的 VM 沙箱中执行，**不提供以下全局对象**：

- ❌ `require` - 无法加载模块
- ❌ `process` - 无法访问环境变量
- ❌ `module`/`exports` - 不需要导出
- ❌ `this` - 不指向全局对象

### 可用全局对象

- ✅ `console` - 自定义 console（输出到日志）
- ✅ `Buffer` - Buffer 类
- ✅ `URL`/`URLSearchParams` - URL 处理
- ✅ `setTimeout`/`clearTimeout` - 定时器
- ✅ `setInterval`/`clearInterval` - 定时器

### 路径限制

- **内联代码**: 无文件访问能力
- **脚本文件**: 只能访问用户工作目录内的文件

### 超时限制

- **JavaScript 执行**: 默认 30 秒（可通过系统设置调整）

## 配置要求

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `WORKING_DIRECTORY` | 用户工作目录（相对 DATA_BASE_PATH） | 可选 |
| `DATA_BASE_PATH` | 数据基础路径 | ✅ |
| `VM_TIMEOUT` | JS 执行超时（毫秒） | 可选 |

## 工具清单

### execute_javascript

在 VM 沙箱中执行 JavaScript 代码。

**描述**: 执行用户提供的 JavaScript 代码，支持内联代码或加载脚本文件。

**参数:**
- `code` (string, optional): 要执行的 JavaScript 代码（与 script_path 二选一）
- `script_path` (string, optional): 脚本文件路径，相对于用户工作目录（与 code 二选一）

**返回示例:**
```json
{
  "success": true,
  "result": 20,
  "stdout": "",
  "stderr": "",
  "duration": 1,
  "source": "inline"
}
```

## 使用示例

### 执行内联 JavaScript

```javascript
execute_javascript({
  code: "const x = 10; return x * 2;"
})
// 返回: { success: true, result: 20 }
```

### 执行异步代码

```javascript
execute_javascript({
  code: "const result = await Promise.resolve(42); return result;"
})
// 返回: { success: true, result: 42 }
```

### 执行脚本文件

```javascript
execute_javascript({
  script_path: "scripts/my-script.js"
})
// 从用户工作目录加载 scripts/my-script.js 并执行
```

## 错误处理

| 错误类型 | 说明 |
|----------|------|
| 超时错误 | 代码执行超过时间限制 |
| 权限错误 | 访问不允许的路径或模块 |
| 语法错误 | 代码语法错误 |
| 运行时错误 | 执行过程中的错误 |

## 安全说明

### 为什么不提供 require？

`require` 可以加载任意模块，包括 `fs`、`child_process` 等危险模块，可能导致：
- 读取敏感文件
- 执行系统命令
- 访问环境变量

### 为什么不提供 process？

`process` 包含敏感信息：
- 环境变量（可能包含密钥）
- 进程信息
- 文件系统路径

### 为什么使用严格模式？

严格模式下，`this` 为 `undefined`，无法通过原型链访问全局对象：
```javascript
// 非严格模式下可能的逃逸方式
this.constructor.constructor('return process')()

// 严格模式下 this 为 undefined，无法逃逸
```

## 注意事项

- 用户代码无法访问任何 Node.js 模块
- 文件访问限制在用户工作目录内
- 不允许相对路径导入（`./` 或 `../`）
- Python 代码执行请使用 `.py` 技能文件

## 技术实现

此技能不需要 `index.js` 文件，用户代码直接在 `skill-runner.js` 的 VM 沙箱中执行：

```
主进程 → skill-loader → fork skill-runner → vm.runInContext(用户代码)
```

这种方式避免了在 VM 中使用 `new Function()` 的逃逸风险。
