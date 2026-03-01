# 内置工具迁移到 tools 目录

## 背景

当前内置技能存放在 `data/skills/builtin/` 目录下，与用户安装的 skills 混在一起，容易造成混淆和管理困难。

## 目标

将内置工具迁移到项目根目录的 `tools/` 目录下，实现：
- 内置工具与安装的技能分离
- 更清晰的目录结构
- 便于容器化部署时区分系统工具和用户技能

## 变更清单

### 1. 目录变更
- [ ] 创建 `tools/builtin/` 目录
- [ ] 移动 `data/skills/builtin/index.js` → `tools/builtin/index.js`
- [ ] 移动 `data/skills/builtin/skill.md` → `tools/builtin/skill.md`
- [ ] 删除 `data/skills/builtin/` 目录

### 2. 代码变更
- [ ] 修改 `lib/tool-manager.js` 中的内置技能路径
- [ ] 检查其他引用该路径的文件

### 3. 文档更新
- [ ] 更新相关文档中的路径说明

## 影响范围

- `lib/tool-manager.js` - 内置技能加载路径
- `data/skills/builtin/` - 源目录（将被删除）
- `tools/builtin/` - 目标目录（新建）

## 状态

⏳ 待开始

## 创建日期

2026-02-24
