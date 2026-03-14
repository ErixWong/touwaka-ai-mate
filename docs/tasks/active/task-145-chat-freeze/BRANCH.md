# Git 分支映射

## 分支信息

- **Issue**: #145
- **分支名**: `fix/145-chat-freeze`
- **类型**: fix
- **来源**: master

## 创建命令

```bash
git checkout master
git pull origin master
git checkout -b fix/145-chat-freeze
```

## 提交规范

格式: `#145: fix 描述`

## 合并方式

Squash merge 到 master，使用 PR。

## PR 关联

PR 描述中添加: `Closes #145`