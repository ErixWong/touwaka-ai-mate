## 关联 Issue

Closes #278

## 变更内容

添加技能目录面板产品设计分析文档。

### 核心设计

1. **面板布局**：左右并排（3:1 比例），目录树 75% + 技能信息 25%
2. **状态管理**：新增 `skillDirectoryStore`，管理 `currentWorkingSkill`
3. **路径限制**：`currentWorkingSkill.path` 作为文件操作的允许根目录
4. **顶部标记**：显示 `🛠️ {技能名称}`，仅展示不交互
5. **分屏比例**：新增 3:1 选项

### 文件变更

- `docs/design/skill-directory-panel-analysis.md` - 产品设计分析文档
- `issue-body-skill-directory.md` - Issue 描述文件

## 实施阶段

- [ ] Phase 1：新增 SkillsDirectory Tab 和基础布局
- [ ] Phase 2：实现 skillDirectoryStore 和状态管理
- [ ] Phase 3：实现目录树和技能信息展示
- [ ] Phase 4：实现工作目录设置和路径限制
- [ ] Phase 5：实现顶部标记和 URL 路由