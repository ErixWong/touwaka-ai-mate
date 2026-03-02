# Code Review: 技能工具入口脚本字段

> 提交: `4302596` - feat: add script_path field to skill_tools table
> 审查日期: 2026-03-02

## 📋 变更概览

| 文件 | 变更 | 说明 |
|------|------|------|
| `data/skills/skill-manager/index.js` | +9/-4 | 添加 script_path 参数支持 |
| `docs/core/TODO.md` | +1 | 添加任务条目 |
| `lib/skill-loader.js` | +13/-8 | 读取和传递 script_path |
| `lib/skill-runner.js` | +10/-6 | 从环境变量加载脚本 |
| `lib/tool-manager.js` | +4/-3 | 传递 scriptPath 到执行器 |
| `scripts/init-database.js` | +2/-1 | 添加数据库字段 |

## ✅ 优点

1. **向后兼容**：所有地方都使用 `'index.js'` 作为默认值，不影响现有技能
2. **安全设计**：`SCRIPT_PATH` 加入 `RESERVED_ENV_VARS`，防止被用户参数覆盖
3. **清晰的日志**：添加了 scriptPath 到日志输出，便于调试
4. **完整的数据流**：从数据库 → skill-loader → tool-manager → skill-runner 全链路传递

## ❌ 问题

### 🟡 建议改进

#### 1. 迁移脚本未纳入提交
**位置**: `scripts/migrations/20260302-add-script-path.sql`
**问题**: 迁移脚本创建了但未提交到 git
**建议**: 将迁移脚本加入版本控制

#### 2. ~~缺少 script_path 路径安全验证~~ ✅ 已修复
**位置**: [`lib/skill-runner.js:98`](lib/skill-runner.js:98)
**问题**: 没有验证 script_path 是否包含路径遍历攻击（如 `../../../etc/passwd`）
**状态**: 已添加 `validateScriptPath()` 函数进行安全检查

#### 3. ~~缺少文件扩展名白名单~~ ✅ 已修复
**位置**: [`lib/skill-runner.js:95`](lib/skill-runner.js:95)
**问题**: 当前可以执行任意文件，不仅限于脚本
**状态**: 已添加 `ALLOWED_SCRIPT_EXTENSIONS` 白名单

#### 4. skill-manager 的 script_path 参数非必填
**位置**: [`data/skills/skill-manager/index.js:232`](data/skills/skill-manager/index.js:232)
**问题**: `script_path` 不在 `required` 数组中，这是正确的（有默认值），但描述可以更清晰
**建议**: 在描述中明确说明默认值

## 📊 总结

| 类别 | 数量 |
|------|------|
| 🔴 严重问题 | 0 |
| 🟡 建议改进 | 4 (3 已修复) |

## 🔧 修复清单

- [x] 提交迁移脚本到 git
- [x] 添加 script_path 路径安全验证
- [x] 添加文件扩展名白名单
- [ ] 更新参数描述说明默认值（低优先级）

## 📝 后续工作

1. **多语言支持**：扩展 `ALLOWED_EXTENSIONS` 支持 `.py`, `.sh`
2. **执行器选择**：根据扩展名选择 node/python/bash 执行器
3. **沙箱隔离**：Python 脚本需要额外的沙箱机制

---

*审查人: Maria 🌸*
