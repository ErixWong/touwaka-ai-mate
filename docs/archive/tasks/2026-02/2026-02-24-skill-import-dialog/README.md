# 技能对话式导入

## 概述

将技能导入从"LLM 分析导入"改为"对话式导入"，让 AI 成为技能管理的主角。

## 设计文档

- [设计文档](../../design/v2/skill-import-dialog-design.md)
- [工具设计](../../design/v2/skill-management-tools-design.md)

## 任务清单

### Phase 1: 基础界面 (1-2 天)

- [ ] 创建 `SkillsStudioView.vue` 视图组件
- [ ] 创建 `ModelSelector.vue` 组件
- [ ] 创建 `SkillListPanel.vue` 组件
- [ ] 添加路由配置 `/skills-studio`

### Phase 2: 后端集成 (1 天)

- [ ] 创建 skill-importer Expert（数据库初始化）
- [ ] 实现 `register_skill` 内置工具
- [ ] 确保工具调用正常工作

### Phase 3: 优化体验 (1 天)

- [ ] 添加快捷指令（/import, /create, /list）
- [ ] 技能详情侧边栏
- [ ] 操作历史记录

## 技术要点

### 复用现有组件

| 组件 | 来源 |
|------|------|
| ChatWindow | 已有 |
| ModelStore | 已有 |
| SkillStore | 已有 |
| Splitpanes | 已有 |

### 新建组件

| 组件 | 说明 |
|------|------|
| SkillsStudioView | 技能工作室主视图 |
| ModelSelector | 模型下拉选择器 |
| SkillListPanel | 右侧技能列表面板 |

### 核心流程

```
用户输入 → skill-importer Expert → 工具调用 → 技能注册
```

## 相关文件

- `frontend/src/views/SkillsStudioView.vue` (新建)
- `frontend/src/components/ModelSelector.vue` (新建)
- `frontend/src/components/panel/SkillListPanel.vue` (新建)
- `tools/builtin/index.js` - 添加 register_skill 工具
- `scripts/init-database.js` - 添加 skill-importer Expert

---

*创建日期：2026-02-26*