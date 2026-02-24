# Skill 管理系统

**状态：** 🔄 进行中  
**创建日期：** 2026-02-22

## 描述

实现技能管理系统，支持多种来源安装、AI解析、工具清单生成。

## 核心理念

- **技能来源**：URL / 上传ZIP / 本地目录（不需要技能市场界面）
- **AI解析**：注册时调用便宜AI（DeepSeek/通义）分析技能
  - 安全检查（检测恶意代码）
  - 提取工具清单（存入 skill_tools 表）
  - 生成结构化元数据
- **技能维护**：通过对话维修、升级技能

## 数据库

- `skills` 表：技能元数据 + 安全评分
- `skill_tools` 表：工具清单（AI生成）

---

## 已完成

- [x] 数据库模型：更新 `skills` 表模型
- [x] 数据库模型：创建 `skill_tools` 表模型
- [x] 数据库迁移：`init-database.js` 已包含所有字段和表（2026-02-24 确认）
- [x] 后端：技能CRUD API（`skill.controller.js`）
- [x] 后端：技能路由（`skill.routes.js`）
- [x] 后端：ZIP上传安装（使用 adm-zip）
- [x] 后端：URL下载安装（2026-02-24 完成）
- [x] 后端：本地目录安装
- [x] 后端：AI分析服务（2026-02-24 完成）
  - 创建 `lib/skill-analyzer.js`
  - 支持 DeepSeek/通义等便宜 AI
  - 安全检查（检测恶意代码）
  - 提取工具清单
  - 降级到基础解析（无 AI 配置时）
- [x] 前端：技能管理页面（`SkillsView.vue`）
- [x] 前端：技能状态管理（`skill.ts` store）
- [x] 前端：路由配置和导航入口
- [x] 国际化：中英文翻译
- [x] AI基础能力：`read` / `write` / `execute` / `http_get` / `http_post`
  - 已创建 `skills/builtin/` 内置技能
  - 实现 7 类 18 个工具：读取、写入、编辑、搜索、管理、压缩、执行、网络

---

## 待办

- [ ] 测试：完整功能测试

---

## 相关文档

- [技能管理系统设计方案 v2.0](../design/v2/skill-market-design.md)
