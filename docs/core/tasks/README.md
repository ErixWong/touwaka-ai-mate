# 任务文档目录

> 本目录存放所有**进行中**的任务文档，完成的任务会归档到 `docs/archive/tasks/`

---

## 📁 目录结构

```
docs/core/tasks/
├── README.md                           # 本文件（模板说明）
├── 2026-03-01-expert-refresh/          # 任务目录（日期-任务简述）
│   ├── README.md                       # 任务概述 + 需求分析
│   ├── design.md                       # 设计文档（可选）
│   └── review.md                       # Code Review 记录
├── 2026-02-28-right-panel/
│   └── ...
└── expert-avatar.md                    # 旧格式任务文档（待迁移）
```

---

## 🚀 创建新任务

### 1. 创建任务目录

```bash
# 命名格式：YYYY-MM-DD-任务简述
mkdir docs/core/tasks/2026-03-01-expert-refresh
```

### 2. 创建 README.md

```markdown
# {任务名称}

> 创建日期: {YYYY-MM-DD}
> 状态: 进行中
> 分支: {branch-name}

## 📋 需求概述

### 背景
<!-- 为什么需要这个功能/修改？ -->

### 目标
<!-- 要达成什么效果？ -->

## 🎯 验收标准

- [ ] 功能实现
- [ ] 测试通过
- [ ] Code Review 通过

## 📝 开发笔记

<!-- 开发过程中的重要决策、遇到的问题等 -->

## 🔗 相关链接

- 设计文档: [design.md](./design.md)（如有）
- Code Review: [review.md](./review.md)
```

### 3. 创建 review.md（Code Review 时）

```markdown
# Code Review: {任务名称}

> 提交: `{commit-hash}` - {commit-message}
> 审查日期: {YYYY-MM-DD}

## 📋 变更概览

| 文件 | 变更 |
|------|------|
| `path/to/file` | +X / -Y |

## ✅ 优点

1. **{优点}**: 描述

## ❌ 问题

### 🔴 严重问题

#### 1. {问题标题}
**位置**: [`file:line`](path/to/file:line)
**修复方案**: ...

### 🟡 建议改进

#### 2. {改进标题}
**建议**: ...

## 📊 总结

| 类别 | 数量 |
|------|------|
| 🔴 严重问题 | X |
| 🟡 建议改进 | X |

## 🔧 修复清单

- [ ] {修复项}
```

---

## 📦 归档流程

任务完成后：

1. **从 TODO.md 剪切**任务条目到 `docs/archive/todo-archive-YYYY-MM.md`
2. **移动任务目录**到 `docs/archive/tasks/YYYY-MM/`

```bash
# 示例：归档 2026-03-01 完成的任务
mv docs/core/tasks/2026-03-01-expert-refresh docs/archive/tasks/2026-03/
```

---

## ⚠️ 注意事项

1. **命名规范**：目录名使用 `YYYY-MM-DD-任务简述` 格式，全部小写，用连字符分隔
2. **及时归档**：完成的任务应及时归档，保持 tasks 目录整洁
3. **关联 TODO**：每个任务目录应对应 TODO.md 中的一个任务条目

---

*最后更新: 2026-03-01*
