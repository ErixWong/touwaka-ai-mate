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
- [x] 后端：技能CRUD API（`skill.controller.js`）
- [x] 后端：技能路由（`skill.routes.js`）
- [x] 后端：ZIP上传安装（使用 adm-zip）
- [x] 后端：本地目录安装
- [x] 前端：技能管理页面（`SkillsView.vue`）
- [x] 前端：技能状态管理（`skill.ts` store）
- [x] 前端：路由配置和导航入口
- [x] 国际化：中英文翻译
- [x] AI基础能力：`read` / `write` / `execute` / `http_get` / `http_post`
  - 已创建 `skills/builtin/` 内置技能
  - 实现 7 类 18 个工具：读取、写入、编辑、搜索、管理、压缩、执行、网络

---

## 待办

- [ ] 数据库迁移：执行下方迁移脚本
- [ ] 后端：URL下载安装功能
- [ ] 后端：AI分析服务（调用便宜AI解析技能）
- [ ] 测试：完整功能测试

---

## 数据库迁移脚本

```sql
-- =============================================
-- Skills 表迁移（逐条执行，忽略已存在的列）
-- =============================================

-- 添加 version 字段
ALTER TABLE skills ADD COLUMN version VARCHAR(32);

-- 添加 author 字段
ALTER TABLE skills ADD COLUMN author VARCHAR(128);

-- 添加 tags 字段
ALTER TABLE skills ADD COLUMN tags JSON;

-- 添加 source_url 字段
ALTER TABLE skills ADD COLUMN source_url VARCHAR(512);

-- 添加 security_score 字段
ALTER TABLE skills ADD COLUMN security_score INT DEFAULT 100;

-- 添加 security_warnings 字段
ALTER TABLE skills ADD COLUMN security_warnings JSON;

-- =============================================
-- 创建 skill_tools 表（主键使用字符串类型）
-- =============================================
CREATE TABLE skill_tools (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  skill_id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  type ENUM('http', 'script', 'builtin') DEFAULT 'http',
  `usage` TEXT,
  command VARCHAR(512),
  endpoint VARCHAR(512),
  method VARCHAR(16),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_skill_name (skill_id, name),
  INDEX idx_skill_id (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **注意：** 
> - `usage` 是 MySQL 保留字，必须用反引号包裹
> - 如果字段已存在会报错，可以忽略
> - 主键 `id` 使用 VARCHAR(32) 字符串类型，与项目其他表一致

---

## 相关文档

- [技能管理系统设计方案 v2.0](../design/v2/skill-market-design.md)
