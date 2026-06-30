# Skill 调试技巧指南

本文档提供技能（Skill）开发和调试的完整指南。✌Bazinga！

---

## 1. 快速入门

### 两种调试模式

| 模式 | 脚本 | 用途 | 特点 |
|------|------|------|------|
| **dev** | `run-skill-dev.js` | 本地快速调试 | VM 沙箱、 admin 权限、快速反馈 |
| **real** | `run-skill-real.js` | 生产环境验证 | 真实 skill-runner、权限验证、路径安全 |

### 基本命令

```bash
# Dev 模式 - 快速验证技能逻辑
node tests/skill-runtime/run-skill-dev.js <skill> <tool> [参数]

# Real 模式 - 验证真实运行时行为
node tests/skill-runtime/run-skill-real.js <skill> <tool> [参数]

# 集成测试 - 专项验证
node tests/skill-runtime/run-skill-integration.js [测试用例]
```

---

## 2. Dev 模式详解

### 适用场景
- 快速验证技能代码逻辑
- 调试技能实现问题
- 单元测试和功能测试
- 开发期间快速反馈

### 特点
- ✅ 自动注入管理员权限（`IS_ADMIN=true`）
- ✅ 相对路径解析到 cwd，不验证沙箱边界
- ✅ 使用 VM 沙箱隔离
- ✅ 快速反馈循环
- ⚠️ 不验证沙箱路径安全边界
- ⚠️ ��测试真实的用户权限

### 示例

```bash
# 测试 excel_read
node tests/skill-runtime/run-skill-dev.js xlsx excel_read --path=test.xlsx

# 测试 excel_write
node tests/skill-runtime/run-skill-dev.js xlsx excel_write --path=output.xlsx --data='[["A","B"],["1","2"]]'

# 测试带公式的单元格
node tests/skill-runtime/run-skill-dev.js xlsx excel_write --path=formula.xlsx --sheet=Sheet1 --cell=A1 --formula='=1+2'

# 查看可用工具
node tests/skill-runtime/run-skill-dev.js xlsx help
```

---

## 3. Real 模式详解

### 适用场景
- 验证沙箱路径安全
- 测试真实的用户权限
- 端到端集成测试
- 生产环境发布前的最终验证

### 特点
- ✅ 使用真实的 skill-runner 执行
- ✅ 验证沙箱路径边界（拒绝 `../` 和绝对路径）
- ✅ 测试真实的权限验证
- ✅ 更接近生产环境行为
- ⚠️ 需要正确配置环境变量

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATA_BASE_PATH` | 数据基础路径 | `./data` |
| `SKILL_PATH` | 技能目录路径 | `data/skills/<skill>` |
| `WORKING_DIRECTORY` | 工作目录 | `data/work/<USER_ID>/temp` |
| `USER_ID` | 用户ID | `test-user` |
| `IS_ADMIN` | 是否管理员 | `false` |

### 示例

```bash
# 验证路径安全 - 绝对路径应被拒绝
node tests/skill-runtime/run-skill-real.js xlsx excel_read --path=/etc/passwd

# 验证路径安全 - 路径遍历应被拒绝
node tests/skill-runtime/run-skill-real.js xlsx excel_read --path=../secret.txt

# 测试非管理员权限
IS_ADMIN=false node tests/skill-runtime/run-skill-real.js xlsx excel_write --path=output.xlsx --data='[["test"]]'
```

---

## 4. 集成测试详解

### 测试用例

```bash
# 运行所有测试
node tests/skill-runtime/run-skill-integration.js all

# 运行单个测试
node tests/skill-runtime/run-skill-integration.js path-security    # 路径越界安全
node tests/skill-runtime/run-skill-integration.js non-admin         # 非管理员权限
node tests/skill-runtime/run-skill-integration.js runner-env        # Runner 环境变量
node tests/skill-runtime/run-skill-integration.js multi-entry       # 多入口测试
```

### 路径安全测试覆盖

| 测试 | 预期行为 |
|------|----------|
| 绝对路径 `/etc/passwd` | ❌ 拒绝 |
| 路径遍历 `../secret.txt` | ❌ 拒绝 |
| 复杂遍历 `subdir/../../etc/passwd` | ❌ 拒绝 |
| 正常相对路径 `test.xlsx` | ✅ 允许 |
| 子目录路径 `subdir/test.xlsx` | ✅ 允许 |

---

## 5. 调试技巧

### 5.1 使用 VM 沙箱直接测试

```javascript
import { createDevSandbox } from './vm-sandbox.js';

const sandbox = createDevSandbox();
const skillModule = sandbox.loadSkill('xlsx');

// 直接调用工具
const result = await skillModule.execute('excel_read', { 
  path: 'test.xlsx',
  scope: 'sheet'
});

console.log(result);
```

### 5.2 调试技能参数

```bash
# 传递复杂参数（JSON 格式）
node tests/skill-runtime/run-skill-dev.js xlsx excel_write \
  --path=test.xlsx \
  --data='[["Name","Age"],["Alice",25],["Bob",30]]' \
  --sheets='[{"name":"Users","headers":["Name","Age"]}]'

# 传递布尔值
node tests/skill-runtime/run-skill-dev.js xlsx excel_read --path=test.xlsx --includeData=true
```

### 5.3 查看技能可用工具

```bash
# 方法1：运行技能并查看输出
node tests/skill-runtime/run-skill-dev.js xlsx help

# 方法2：查看技能源码
cat data/skills/xlsx/index.js | grep "getTools"
```

### 5.4 调试路径问题

```bash
# 使用绝对路径测试 resolvePath
node -e "
const path = require('path');
function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute path not allowed');
  }
  const normalizedPath = path.normalize(relativePath);
  const pathParts = normalizedPath.split(path.sep);
  for (const part of pathParts) {
    if (part === '..') {
      throw new Error('Path traversal not allowed');
    }
  }
  return normalizedPath;
}

// 测试用例
console.log(resolvePath('test.xlsx'));      // OK
console.log(resolvePath('../test.xlsx'));   // Error
console.log(resolvePath('/etc/passwd'));    // Error
"
```

---

## 6. 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `SKILL_PATH not set` | real 模式未设置环境变量 | 检查 `run-skill-real.js` 环境变量设置 |
| `Absolute path not allowed` | 使用了绝对路径 | 使用相对路径 |
| `Path traversal not allowed` | 路径包含 `../` | 使用安全的相对路径 |
| `Module not found` | 模块未安装 | 运行 `npm install` |
| `Skill not found` | 技能目录不存在 | 检查 `data/skills/<skill>/index.js` 是否存在 |

### 调试模式选择

```
问题现象                      -> 推荐模式
─────────────────────────────────────────
技能逻辑错误                  -> dev (快��定位)
路径安全验证失败              -> real (真实沙箱)
权限控制异常                  -> real (真实权限)
公式计算结果错误              -> dev (断点调试)
端到端流程不通                -> integration (完整测试)
```

---

## 7. 临时文件策略

测试过程中生成的临时文件应写入临时目录，**禁止直接写入 `data/` 根目录**。

### 推荐临时目录

| 平台 | 路径 |
|------|------|
| Unix | `/tmp/touwaka-tests/` |
| Windows | `%TEMP%\touwaka-tests\` |

### 自动清理

测试脚本应在执行完成后自动清理临时文件：

```javascript
// 示例：测试结束后清理
async function cleanup() {
  const tempDir = path.join(os.tmpdir(), 'touwaka-tests');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
}
```

---

## 8. 相关文档

- [VM 沙箱实现](./vm-sandbox.js)
- [开发调试脚本](./run-skill-dev.js)
- [生产验证脚本](./run-skill-real.js)
- [集成测试脚本](./run-skill-integration.js)
- [skill-runner 源码](../../lib/skill-runner.js)
- [skill-loader 源码](../../lib/skill-loader.js)