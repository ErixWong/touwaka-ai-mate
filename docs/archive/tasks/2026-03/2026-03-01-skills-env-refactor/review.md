# 代码审计报告 - 2026-03-01

> 审计人：Maria 🌸  
> 审计对象：未提交的 `skills/` 目录

---

## 审计概要

Git 状态显示存在未跟踪的 `skills/` 目录，包含三个技能模块：
- `compression/` - ZIP 压缩/解压
- `file-operations/` - 文件操作
- `http-client/` - HTTP 客户端

---

## 🔴 严重问题

### 1. 目录重复

`skills/` 目录与 `data/skills/` **内容完全相同**，疑似误操作产生的副本。

**建议**：删除 `skills/` 目录，避免混淆。

### 2. 命令注入风险 - compression/index.js

**位置**：第 90、96、143、147 行

```javascript
// 第 90 行 - Windows PowerShell
const cmd = `powershell -Command "Compress-Archive -Path '${resolvedSource}' -DestinationPath '${resolvedDest}' ...`;

// 第 96 行 - Unix zip
const cmd = `cd "${destDir}" && zip -${compression_level} -r "${path.basename(resolvedDest)}" "${sourceName}"`;
```

**问题**：直接将路径拼接到 shell 命令中，如果路径包含特殊字符（如 `'; rm -rf /`）可能导致命令注入。

**建议修复**：
```javascript
// 使用 execFileSync 或对路径进行转义
const { execFileSync } = require('child_process');

// Windows 示例
execFileSync('powershell', ['-Command', 'Compress-Archive', ...], { timeout: 60000 });
```

---

## 🟡 中等问题

### 3. 未使用的导入 - compression/index.js

**位置**：第 12 行

```javascript
const zlib = require('zlib');  // 从未使用
```

**建议**：删除此行。

### 4. 变量重复声明 - compression/index.js

**位置**：第 94 行

```javascript
// 第 75 行已声明 destDir
const destDir = path.dirname(resolvedDest);

// 第 94 行在 if 块内再次声明，覆盖了外层变量
const destDir = path.dirname(resolvedDest);
```

**问题**：虽然 JavaScript 的块级作用域使其不会报错，但容易引起混淆。

**建议**：重命名内层变量或复用外层变量。

---

## 🟢 代码质量良好的部分

### file-operations/index.js
- ✅ 路径安全检查到位（`isPathAllowed`、`resolvePath`）
- ✅ 文件大小限制合理（50MB）
- ✅ 错误处理完善
- ✅ 支持 snake_case 和 camelCase 两种工具名格式

### http-client/index.js
- ✅ 超时控制（10秒默认）
- ✅ 响应大小限制（1MB）
- ✅ 正确处理 JSON 和文本响应
- ✅ 错误处理完善

---

## 审计结论

| 模块 | 风险等级 | 是否可提交 |
|------|----------|-----------|
| compression | 🟡 中等 | 需修复命令注入问题 |
| file-operations | 🟢 低 | ✅ 可提交 |
| http-client | 🟢 低 | ✅ 可提交 |

**修复状态**：

| 问题 | 状态 |
|------|------|
| 删除重复的 `skills/` 目录 | ✅ 已删除 |
| 修复命令注入风险 | ✅ 已使用 `execFileSync` |
| 清理未使用的 zlib 导入 | ✅ 已删除 |

---

*审计完成时间：2026-03-01 13:01 (UTC+8)*
*修复完成时间：2026-03-01 13:10 (UTC+8)*

---

# 代码审计报告 - 2026-03-01 (第二次)

> 审计人：Code Review Bot  
> 审计对象：未提交的代码变更（环境变量重构）

---

## 审计概要

Git 状态显示 3 个文件有未提交的修改：

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `data/skills/file-operations/index.js` | 修改 | 环境变量统一 |
| `lib/skill-loader.js` | 修改 | SKILL_PATH → DATA_BASE_PATH |
| `lib/skill-runner.js` | 修改 | 环境变量 + 沙箱增强 |

**变更目的**：统一环境变量命名，使用 `DATA_BASE_PATH` 替代 `SKILL_PATH`

---

## 🟢 代码质量良好的部分

### 1. 环境变量统一化设计

**优点**：
- ✅ 统一使用 `DATA_BASE_PATH` 作为基础路径，技能路径推导为 `DATA_BASE_PATH/skills/{skillId}`
- ✅ 减少配置复杂度，只需设置一个环境变量
- ✅ 各文件修改一致，协同良好

### 2. skill-runner.js 沙箱增强

**新增 `process.cwd()` 支持**：

```javascript
process: {
  env: safeEnv,
  cwd: () => '/app',  // Docker 环境下的标准工作目录
},
```

**优点**：
- ✅ 为技能代码提供更完整的 `process` 对象模拟
- ✅ 返回固定安全路径，避免暴露真实文件系统信息
- ✅ 符合 Docker 容器标准工作目录约定

### 3. file-operations/index.js 路径处理

```javascript
// 统一使用 DATA_BASE_PATH，技能路径为 DATA_BASE_PATH/skills
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const ALLOWED_BASE_PATHS = [
  DATA_BASE_PATH,
  path.join(DATA_BASE_PATH, 'skills'),
];
```

**优点**：
- ✅ 使用单一变量 `DATA_BASE_PATH` 避免路径不一致
- ✅ 保留了合理的默认值

---

## 🟡 需要注意的问题

### 1. skill-loader.js 文件编码问题 ⚠️

**问题**：文件开头包含 BOM (Byte Order Mark)

```diff
-/**
+﻿/**
```

**影响**：
- 可能导致某些 Shell 脚本或工具解析异常
- 与其他文件的编码风格不一致

**建议**：移除 BOM，使用纯 UTF-8 编码（无 BOM）

**修复方法**：
```bash
# 使用 PowerShell 移除 BOM
$content = Get-Content lib/skill-loader.js -Raw
[System.IO.File]::WriteAllText("lib/skill-loader.js", $content.TrimStart([char]0xFEFF), [System.Text.UTF8Encoding]::new($false))
```

### 2. skill-loader.js 注释未更新

**位置**：第 497 行

```javascript
DATA_BASE_PATH: this.skillsBasePath,      // 3. 技能代码路径（使用 source_path）
```

**问题**：注释提到 `source_path`，但实际传递的是 `skillsBasePath`

**建议**：更新注释为：
```javascript
DATA_BASE_PATH: this.skillsBasePath,      // 3. 数据基础路径（技能目录为 DATA_BASE_PATH/skills）
```

### 3. 环境变量语义变更影响

**变更前**：`SKILL_PATH` 直接指向技能目录
**变更后**：`DATA_BASE_PATH` 指向数据根目录，技能目录需拼接 `/skills`

**潜在影响**：
- 已部署的环境需要更新环境变量配置
- Docker 部署需要更新环境变量

**建议**：
1. 更新 `.env.example` 文档
2. 更新部署文档
3. 考虑向后兼容：同时支持 `SKILL_PATH`（已弃用）和 `DATA_BASE_PATH`

### 4. skill-runner.js 默认值不一致

**skill-runner.js**:
```javascript
const dataBasePath = process.env.DATA_BASE_PATH || '/shared';
```

**skill-loader.js**:
```javascript
const dataBasePath = process.env.DATA_BASE_PATH
  ? (path.isAbsolute(process.env.DATA_BASE_PATH) 
      ? process.env.DATA_BASE_PATH 
      : path.join(process.cwd(), process.env.DATA_BASE_PATH))
  : path.join(process.cwd(), 'data');
```

**问题**：默认值不一致
- `skill-runner.js` 默认 `/shared`（Docker 生产路径）
- `skill-loader.js` 默认 `process.cwd()/data`（开发路径）

**分析**：这可能是设计意图：
- `skill-runner.js` 运行在 Docker 容器中，默认 `/shared` 合理
- `skill-loader.js` 运行在主进程，默认开发路径合理

**建议**：添加注释说明两者的运行环境差异

---

## 🔍 代码审查详细分析

### file-operations/index.js 变更

```diff
+// 统一使用 DATA_BASE_PATH，技能路径为 DATA_BASE_PATH/skills
+const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
 const ALLOWED_BASE_PATHS = [
-  process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data'),
-  process.env.SKILL_PATH || path.join(process.cwd(), 'data', 'skills'),
+  DATA_BASE_PATH,
+  path.join(DATA_BASE_PATH, 'skills'),
 ];
```

**评价**：✅ 良好改进
- 消除了冗余的环境变量
- 逻辑更清晰
- 添加了注释说明意图

### skill-runner.js 变更

**变更 1：路径构建**

```diff
-function loadSkill(skillId) {
-  const skillPath = process.env.SKILL_PATH || path.join('/shared/skills', skillId);
+function loadSkill(skillId) {
+  // 统一使用 DATA_BASE_PATH/skills 作为技能目录
+  const dataBasePath = process.env.DATA_BASE_PATH || '/shared';
+  const skillPath = path.join(dataBasePath, 'skills', skillId);
```

**评价**：✅ 良好改进
- 与 `skill-loader.js` 保持一致的路径结构

**变更 2：沙箱增强**

```diff
-    // 提供受限的 process 对象（只暴露 env）
+    // 提供受限的 process 对象（只暴露 env 和 cwd）
+    // cwd() 返回安全的固定路径，用于 Docker 环境
     process: {
       env: safeEnv,
+      cwd: () => '/app',  // Docker 环境下的标准工作目录
     },
```

**评价**：✅ 良好改进
- 增强沙箱完整性
- 防止技能代码获取真实工作目录信息

---

## 审计结论

| 文件 | 风险等级 | 是否可提交 |
|------|----------|-----------|
| `data/skills/file-operations/index.js` | 🟢 低 | ✅ 可提交 |
| `lib/skill-loader.js` | 🟡 中 | ⚠️ 需修复 BOM |
| `lib/skill-runner.js` | 🟢 低 | ✅ 可提交 |

### 建议的后续操作

1. **必须修复**：移除 `lib/skill-loader.js` 的 BOM
2. **建议修复**：更新 `lib/skill-loader.js` 第 497 行的注释
3. **建议更新**：更新 `.env.example` 和部署文档
4. **可选优化**：添加向后兼容支持（同时检查 `SKILL_PATH` 和 `DATA_BASE_PATH`）

---

## 修复脚本

```bash
# 移除 BOM（PowerShell）
$content = Get-Content lib/skill-loader.js -Raw -Encoding UTF8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("lib/skill-loader.js", $content, $utf8NoBom)
```

---

*审计完成时间：2026-03-01 13:49 (UTC+8)*
