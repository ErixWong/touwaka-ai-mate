# 技能开发指南

> 本文档提供技能开发的通用方法论，适用于任何技能的开发、测试和调试。

## 目录

1. [开发流程](#开发流程)
2. [测试方法](#测试方法)
3. [调试技巧](#调试技巧)
4. [问题排查流程](#问题排查流程)
5. [最佳实践](#最佳实践)

---

## 开发流程

### 1. 需求分析

- 明确技能的核心功能
- 确定输入/输出格式
- 列出需要使用的第三方库

### 2. 技术调研

**何时需要上网搜索**：

| 情况 | 搜索关键词示例 |
|---|---|
| 不熟悉的库用法 | `xlsx library write formula cell` |
| API 不明确 | `hyperformula buildFromSheets example` |
| 遇到错误信息 | `HyperFormula buildEmpty is not a function` |
| 需要最佳实践 | `exceljs best practices performance` |
| 版本兼容问题 | `hyperformula node 18 compatibility` |

**推荐资源**：

- 官方文档（最权威）
- GitHub Issues（常见问题解决方案）
- Stack Overflow（具体问题）
- npm 包页面（版本和依赖信息）

### 3. 代码实现

```
data/skills/{skill-name}/
├── index.js      # 主入口，必须导出 execute 函数
├── SKILL.md      # 技能说明文档
└── package.json  # 可选，独立依赖
```

**实现要点**：

1. 入口函数签名：`async function execute(toolName, params, context)`
2. 参数验证：检查必填参数，提供默认值
3. 错误处理：使用 try-catch，返回有意义的错误信息
4. 路径安全：使用 `resolvePath()` 验证路径权限

### 4. 测试验证

- 编写测试脚本
- 使用 `run-skill.js` 执行技能
- 验证输出结果

---

## 测试方法

### 使用测试脚本

项目提供了 `tests/run-skill.js` 用于直接执行技能：

```bash
# 基本用法
node tests/run-skill.js <skill-name> <tool-name> [params...]

# 示例
node tests/run-skill.js xlsx excel_read --path=test.xlsx --scope=workbook
node tests/run-skill.js kb-search search --kb_id=xxx --query=测试
```

### 编写测试脚本

在 `tests/` 目录下创建测试脚本：

```javascript
// tests/test-my-skill.js
const path = require('path');

// 设置环境变量
process.env.IS_ADMIN = 'true';
process.env.DATA_BASE_PATH = path.join(__dirname, '..', 'data');

// 加载技能
const skill = require('../data/skills/my-skill/index.js');

async function test() {
  try {
    // 测试用例 1
    const result1 = await skill.execute('tool_name', {
      param1: 'value1',
      param2: 'value2'
    });
    console.log('测试 1 结果:', JSON.stringify(result1, null, 2));

    // 测试用例 2 - 错误情况
    const result2 = await skill.execute('tool_name', {
      // 缺少必填参数
    });
    console.log('测试 2 结果:', result2);
    
  } catch (error) {
    console.error('测试失败:', error.message);
    console.error('堆栈:', error.stack);
  }
}

test();
```

### 测试检查清单

- [ ] 正常输入返回预期结果
- [ ] 缺少必填参数时返回明确错误
- [ ] 边界情况处理（空值、超长输入等）
- [ ] 错误情况有清晰的错误信息
- [ ] 文件操作不影响其他数据

---

## 调试技巧

### 1. 日志输出

```javascript
// 在技能代码中添加调试日志
console.log('[DEBUG] 输入参数:', JSON.stringify(params, null, 2));
console.log('[DEBUG] 中间结果:', intermediateResult);
```

### 2. 单元测试

```javascript
// 测试单个函数
function testColumnConversion() {
  const cases = [
    { input: 'A', expected: 1 },
    { input: 'Z', expected: 26 },
    { input: 'AA', expected: 27 },
    { input: 'AB', expected: 28 },
  ];
  
  for (const { input, expected } of cases) {
    const result = columnLetterToNumber(input);
    if (result !== expected) {
      console.error(`失败: ${input} -> ${result}, 期望 ${expected}`);
    } else {
      console.log(`通过: ${input} -> ${result}`);
    }
  }
}
```

### 3. 错误追踪

```javascript
// 捕获完整错误信息
try {
  // 可能出错的代码
} catch (error) {
  console.error('错误类型:', error.name);
  console.error('错误信息:', error.message);
  console.error('错误堆栈:', error.stack);
  
  // 如果是库的错误，检查库的版本
  console.error('库版本:', require('some-library/package.json').version);
}
```

### 4. 数据检查

```javascript
// 检查数据结构
console.log('数据类型:', typeof data);
console.log('是否数组:', Array.isArray(data));
console.log('对象键:', Object.keys(data));
console.log('JSON:', JSON.stringify(data, null, 2));
```

---

## 问题排查流程

### 流程图

```
遇到问题
    │
    ▼
┌─────────────────┐
│ 1. 复现问题     │ ← 确定最小复现步骤
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 定位错误     │ ← 查看错误信息、堆栈
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. 分析原因     │ ← 是参数问题？库问题？逻辑问题？
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────┐
│已知问题│ │未知问题│
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
┌───────┐ ┌───────────────┐
│直接修复│ │搜索解决方案   │
└───────┘ └───────┬───────┘
                  │
         ┌────────┼────────┐
         │        │        │
         ▼        ▼        ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │官方文档│ │GitHub  │ │Stack   │
    │        │ │Issues  │ │Overflow│
    └────────┘ └────────┘ └────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ 4. 实现解决方案 │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ 5. 验证修复     │ ← 测试原问题 + 边界情况
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ 6. 记录经验     │ ← 更新文档
         └─────────────────┘
```

### 常见问题类型

| 问题类型 | 排查方法 | 示例 |
|---|---|---|
| 参数错误 | 检查参数类型、必填项 | `Path not allowed` |
| 库使用错误 | 查阅官方文档、示例 | `buildEmpty is not a function` |
| 数据格式错误 | 打印数据结构检查 | `Cannot read property 'x' of undefined` |
| 异步问题 | 检查 await、Promise | `Promise { <pending> }` |
| 版本兼容 | 检查 package.json 版本 | 旧版 API 不可用 |

### 搜索策略

**搜索优先级**：

1. **官方文档** - 最权威，优先查看
2. **GitHub Issues** - 查找已知问题和解决方案
3. **Stack Overflow** - 具体编程问题
4. **博客文章** - 最佳实践和教程

**搜索技巧**：

```bash
# 精确匹配错误信息
"HyperFormula buildEmpty is not a function"

# 限定网站
site:github.com hyperformula issue

# 组合关键词
xlsx library formula cell write javascript

# 限定时间（解决版本问题）
hyperformula node 18 after:2023-01-01
```

---

## 最佳实践

### 1. 代码规范

```javascript
// ✅ 好的实践
async function excelRead(params) {
  // 参数解构 + 默认值
  const { path: filePath, scope = 'workbook', sheet } = params;
  
  // 参数验证
  if (!filePath) {
    throw new Error('File path is required');
  }
  
  // 清晰的错误信息
  try {
    // ...
  } catch (error) {
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
}

// ❌ 避免的做法
async function excelRead(params) {
  // 没有参数验证
  const buffer = readExcelFile(params.path); // 可能 undefined
  // ...
}
```

### 2. 错误处理

```javascript
// 提供有意义的错误信息
if (!workbook.SheetNames.includes(sheetName)) {
  throw new Error(
    `Sheet "${sheetName}" not found. ` +
    `Available sheets: ${workbook.SheetNames.join(', ')}`
  );
}
```

### 3. 文档编写

```markdown
# SKILL.md 模板

---
name: skill-name
description: "简短描述技能功能和触发条件"
---

## 工具列表

| 工具 | 说明 | 关键参数 |
|---|---|---|
| tool_1 | 功能描述 | param1, param2 |

## 使用示例

\`\`\`javascript
// 示例代码
\`\`\`

## 注意事项

- 限制说明
- 依赖要求
```

### 4. 测试覆盖

```javascript
// 测试用例设计
const testCases = [
  // 正常情况
  { name: '正常输入', params: { ... }, expected: { ... } },
  
  // 边界情况
  { name: '空输入', params: {}, expectedError: 'xxx is required' },
  { name: '超长输入', params: { path: 'a'.repeat(1000) }, expectedError: '...' },
  
  // 错误情况
  { name: '无效路径', params: { path: '/invalid/path' }, expectedError: 'Path not allowed' },
];
```

### 5. 版本管理

```javascript
// 检查依赖版本
const packageJson = require('some-library/package.json');
console.log('版本:', packageJson.version);

// 处理版本差异
if (packageJson.version.startsWith('1.')) {
  // 旧版 API
} else {
  // 新版 API
}
```

---

## 快速参考

### 常用命令

```bash
# 执行技能测试
node tests/run-skill.js <skill> <tool> --param=value

# 运行自定义测试脚本
node tests/test-my-skill.js

# 检查依赖版本
npm list <package-name>

# 查看技能日志
# 在技能代码中添加 console.log，然后运行测试
```

### 文件路径

| 文件 | 用途 |
|---|---|
| `data/skills/{name}/index.js` | 技能主代码 |
| `data/skills/{name}/SKILL.md` | 技能文档 |
| `tests/run-skill.js` | 技能执行脚本 |
| `tests/skill-admin.js` | 技能管理脚本 |
| `tests/db-query.js` | 数据库查询脚本 |

### 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `IS_ADMIN` | 是否管理员模式 | `false` |
| `DATA_BASE_PATH` | 数据根目录 | `./data` |
| `USER_ID` | 当前用户 ID | `default` |
| `WORKING_DIRECTORY` | 工作目录 | `work/{USER_ID}` |

---

## 附录：问题排查案例

### 案例 1：库导入问题

**问题**：`HyperFormula.buildEmpty is not a function`

**排查过程**：
1. 打印导入结果：`console.log(require('hyperformula'))`
2. 发现导出格式：`{ HyperFormula: class, ... }`
3. 修改导入代码：`const { HyperFormula } = require('hyperformula')`

**经验**：ES Module 和 CommonJS 导出格式可能不同，需要检查实际导出结构。

### 案例 2：参数格式问题

**问题**：列宽设置只支持单字母列名

**排查过程**：
1. 测试 `A` 列：成功
2. 测试 `AA` 列：失败
3. 检查代码：`charCodeAt(0)` 只取第一个字符
4. 搜索解决方案：Excel 列名转换算法
5. 实现多字母支持

**经验**：边界测试很重要，不要只测试简单情况。

### 案例 3：文件格式问题

**问题**：Excel 打开文件报 XML 错误

**排查过程**：
1. 查看 Excel 修复日志
2. 定位到 `/xl/worksheets/sheet1.xml`
3. 检查单元格数据：发现 `null` 值
4. 修改代码：使用 `0` 替代 `null`
5. 删除 `.w` 属性避免样式冲突

**经验**：生成的文件需要用目标软件验证，不能只看代码逻辑。

---

*文档创建：2026-03-22*
*最后更新：2026-03-22*