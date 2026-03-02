# Code Review: 技能路径逻辑修复

## 审查范围

| 文件 | 行数 | 说明 |
|------|------|------|
| `lib/skill-loader.js` | 675 | 技能加载器 |
| `lib/skill-runner.js` | 243 | 技能执行子进程 |
| `data/skills/skill-manager/index.js` | 654 | 技能管理技能 |

---

## 1. lib/skill-loader.js

### ✅ 优点

1. **路径逻辑已简化**（第 482-495 行）
   ```javascript
   // 技能目录 = dataBasePath + source_path
   if (sourcePath) {
     if (path.isAbsolute(sourcePath)) {
       skillPath = sourcePath;
     } else {
       skillPath = path.join(dataBasePath, sourcePath);
     }
   } else {
     // 兼容旧数据
     skillPath = path.join(this.skillsBasePath, skillId);
   }
   ```

2. **环境变量注入清晰**（第 500 行）
   - `SKILL_PATH` 环境变量正确传递给子进程

### ⚠️ 潜在问题

1. **第 136 行 - 跨平台路径比较**
   ```javascript
   const isAllowed = fullPath.startsWith(allowedPath + path.sep) || fullPath === allowedPath;
   ```
   - **问题**：在 Windows 上 `path.sep` 是 `\`，Linux 上是 `/`
   - **影响**：如果路径规范化后混用斜杠，可能导致安全检查失效
   - **建议**：使用 `path.normalize()` 后再比较，或统一使用 `/`

2. **第 493-495 行 - 兼容逻辑可能产生歧义**
   ```javascript
   } else {
     // 没有 source_path，使用 skillId 作为目录名（兼容旧数据）
     skillPath = path.join(this.skillsBasePath, skillId);
   }
   ```
   - **问题**：如果 `skillId` 本身包含 `skills/` 前缀，会重复
   - **建议**：添加检查，如果 `skillId` 以 `skills/` 开头则直接拼接 `dataBasePath`

---

## 2. lib/skill-runner.js

### ✅ 优点

1. **优先使用 SKILL_PATH**（第 100-107 行）
   ```javascript
   let skillPath = process.env.SKILL_PATH;
   if (!skillPath) {
     const dataBasePath = process.env.DATA_BASE_PATH || '/shared';
     skillPath = path.join(dataBasePath, 'skills', skillId);
   }
   ```
   - 回退逻辑清晰

### ⚠️ 潜在问题

1. **第 106 行 - 回退逻辑假设 skillId 是目录名**
   ```javascript
   skillPath = path.join(dataBasePath, 'skills', skillId);
   ```
   - **问题**：如果 `skillId` 是 `skills/file-operations`，会变成 `dataBasePath/skills/skills/file-operations`
   - **建议**：检查 `skillId` 是否已包含 `skills/` 前缀

---

## 3. data/skills/skill-manager/index.js

### ✅ 优点

1. **路径验证函数清晰**（第 123-159 行）
   - 正确处理绝对路径和相对路径
   - 安全检查防止路径遍历攻击

2. **参数说明已更新**（第 200-203 行）
   ```javascript
   description: '技能目录相对于 dataBasePath 的路径。例如：skills/searxng（注意：包含 skills/ 前缀）'
   ```

3. **relativePath 计算正确**（第 156 行）
   ```javascript
   const relativePath = path.relative(dataBasePath, fullPath);
   ```

### ⚠️ 潜在问题

1. **第 136 行 - 同样的跨平台路径比较问题**
   ```javascript
   const isAllowed = fullPath.startsWith(allowedPath + path.sep) || fullPath === allowedPath;
   ```

2. **第 621 行 - 命令行入口判断可能不够健壮**
   ```javascript
   if (typeof process.argv !== 'undefined' && process.argv[1] && process.argv[1].endsWith('index.js')) {
   ```
   - **问题**：如果文件名不是 `index.js`，命令行入口不会执行
   - **建议**：使用 `__filename` 或 `import.meta.url` 进行更精确的判断

---

## 4. 整体架构评估

### ✅ 正面评价

1. **路径规则统一**：`dataBasePath + source_path` 逻辑清晰
2. **安全隔离**：技能在子进程中执行，有模块白名单
3. **环境变量注入**：敏感配置通过环境变量传递，不硬编码

### ⚠️ 需要关注

1. **跨平台兼容性**：Windows/Linux 路径分隔符问题
2. **向后兼容**：旧数据可能没有 `source_path` 或格式不一致
3. **错误处理**：路径不存在时的错误信息可以更详细

---

## 5. 建议的改进

### 高优先级

1. **统一路径比较逻辑**
   ```javascript
   // 建议的跨平台安全比较
   const normalizedFullPath = path.normalize(fullPath).replace(/\\/g, '/');
   const normalizedAllowedPath = path.normalize(allowedPath).replace(/\\/g, '/');
   const isAllowed = normalizedFullPath.startsWith(normalizedAllowedPath + '/');
   ```

2. **skill-runner.js 回退逻辑改进**
   ```javascript
   if (!skillPath) {
     const dataBasePath = process.env.DATA_BASE_PATH || '/shared';
     // 检查 skillId 是否已包含 skills/ 前缀
     if (skillId.startsWith('skills/')) {
       skillPath = path.join(dataBasePath, skillId);
     } else {
       skillPath = path.join(dataBasePath, 'skills', skillId);
     }
   }
   ```

### 低优先级

1. 添加更多单元测试覆盖路径边界情况
2. 日志中输出完整的路径计算过程，便于调试

---

## 6. 结论

**审查结果：✅ 通过（有改进建议）**

当前修复解决了核心问题（路径重复拼接），代码逻辑清晰。建议在后续迭代中处理跨平台兼容性问题。

| 评估项 | 状态 |
|--------|------|
| 功能正确性 | ✅ |
| 安全性 | ✅ |
| 可维护性 | ✅ |
| 跨平台兼容 | ⚠️ 需改进 |
| 错误处理 | ✅ |
