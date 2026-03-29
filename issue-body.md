# refactor: 重命名 file-operations 技能为 fs

## 问题描述
`file-operations` 技能名称过长（15 字符），且不够精确（包含目录操作）。

## 解决方案
- 重命名技能目录：`file-operations` → `fs`
- 更新工具命名：`file-operations__xxx` → `fs__xxx`
- 将技能使用提示从代码硬编码移到 SKILL.md description 字段

## 变更内容
- `data/skills/file-operations/` → `data/skills/fs/`
- `data/skills/fs/SKILL.md` - 更新 name 和 description
- `data/skills/fs/index.js` - 更新模块注释和调试标识
- `lib/context-manager.js` - 移除硬编码检测
- `lib/context-organizer/base-organizer.js` - 移除硬编码检测
- `README.md`, `docs/` - 更新文档引用

## 优势
1. 更短更简洁：`fs` (2 字符) vs `file-operations` (15 字符)
2. 更准确：`fs` 代表 "file system"，涵盖文件和目录操作
3. 更优雅：技能提示通过 description 自动注入，无需硬编码
4. 易于维护：新增或修改技能提示只需编辑 SKILL.md
