# 技能参数配置界面

## 任务概述

在顶部导航栏添加「技能」菜单入口，让用户可以访问技能管理页面（SkillsView），在技能管理页面中可以配置技能的运行时参数（如 API Key、base_url 等）。

## 背景

技能可能需要配置参数才能正常工作，例如：
- 天气查询技能需要 API 地址和 API Key
- 数据库技能需要连接字符串
- 邮件发送技能需要 SMTP 配置

后端 API、数据库表、前端 SkillParametersModal 组件和 SkillsView 页面都已经实现，只需要在 AppHeader 中添加导航链接即可。

## 实现内容

### 1. 添加导航链接

在 `AppHeader.vue` 的导航栏中，在「专家」和「设置」之间添加「技能」链接：

```vue
<router-link to="/skills" class="nav-link" :class="{ active: isActive('/skills') }">
  <span class="nav-icon">🧩</span>
  <span class="nav-text">{{ $t('nav.skills') }}</span>
</router-link>
```

### 2. 移除安装功能

技能安装功能已从 `SkillsView.vue` 中移除，因为技能应该通过「技能专家」进行对话式安装，而不是通过菜单界面。

移除的功能：
- 添加技能按钮（页面头部和空状态）
- 添加技能对话框（URL/ZIP/本地路径三种来源）
- 重新分析按钮
- 删除技能按钮

保留的功能：
- 查看技能详情
- 管理参数配置
- 激活/停用技能

### 3. 已有功能

以下功能已经实现，无需修改：

- **路由配置**：`/skills` 路由已指向 `SkillsView.vue`
- **技能管理页面**：`SkillsView.vue` 包含技能配置功能
- **参数配置弹窗**：`SkillParametersModal.vue` 已集成在 SkillsView 中
- **后端 API**：
  - `GET /api/skills/:id/parameters` - 获取参数
  - `POST /api/skills/:id/parameters` - 保存参数
- **i18n 翻译**：`nav.skills` 已定义

## 验收标准

- [x] 顶部导航栏显示「技能」菜单（位于专家和设置之间）
- [x] 点击「技能」跳转到技能管理页面
- [x] 技能管理页面显示「管理参数」按钮
- [x] 点击按钮打开参数配置弹窗
- [x] 可以添加、编辑、删除参数
- [x] 机密参数以密码框形式显示
- [x] 移除安装功能（通过技能专家安装）

## 相关文件

- `frontend/src/components/AppHeader.vue` - 顶部导航栏（已修改）
- `frontend/src/views/SkillsView.vue` - 技能管理页面（已修改，移除安装功能）
- `frontend/src/components/SkillParametersModal.vue` - 参数配置弹窗（已存在）
- `server/controllers/skill.controller.js` - 后端控制器（已实现）
- `docs/design/v2/skill-configuration-design.md` - 设计文档

## 进度

- 创建日期：2026-03-01
- 完成日期：2026-03-01
- 状态：✅ 已完成
