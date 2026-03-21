## 需求描述

在专家对话页面的右侧面板添加"技能目录"TabPage，用于管理技能目录和限制文件操作路径。

## 背景

当前文件操作技能和代码执行技能的防逃逸工作比较繁琐，需要：
- 在 SKILL.md 中定义规则
- 后端代码实现校验
- 每次添加新技能或修改规则都需要修改代码

## 解决方案

参考 Tasks 的成功模式，添加技能目录面板：

### 面板布局

- 左右并排布局（3:1 比例）
- 左侧：技能目录树（75%）
- 右侧：技能信息（25%）

### 核心功能

1. **目录树浏览**：显示 `data/skills/` 下的所有技能目录
2. **技能信息展示**：名称、描述、工具列表、注册状态
3. **工作目录设置**：设置 `currentWorkingSkill`，限制文件操作路径
4. **顶部标记**：对话窗口顶部显示 `🛠️ {技能名称}`

### 技术实现

1. 新增 `skillDirectoryStore`，管理 `currentWorkingSkill`
2. 扩展分屏比例，新增 3:1 选项
3. URL 路由：`/chat/:expertId?skill=xxx`
4. 互斥关系：任务模式和技能模式不能同时激活

## 详细设计

见 [`docs/design/skill-directory-panel-analysis.md`](docs/design/skill-directory-panel-analysis.md)

## 实施阶段

- [ ] Phase 1：新增 SkillsDirectory Tab 和基础布局
- [ ] Phase 2：实现 skillDirectoryStore 和状态管理
- [ ] Phase 3：实现目录树和技能信息展示
- [ ] Phase 4：实现工作目录设置和路径限制
- [ ] Phase 5：实现顶部标记和 URL 路由