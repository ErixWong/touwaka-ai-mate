# Touwaka Mate v2 文档

## 目录结构

```
docs/
├── core/                        # 核心必读（每次开工必读）
│   ├── SOUL.md                 # 人设
│   ├── TODO.md                 # 任务列表
│   └── tasks/                  # 任务详情文档
│
├── guides/                      # 开发手册（技术参考）
│   ├── development/            # 开发手册
│   │   ├── README.md           # 开发指南索引
│   │   ├── quick-start.md      # 快速开始
│   │   ├── coding-standards.md # 编码规范
│   │   ├── core-modules.md     # 核心模块
│   │   ├── frontend-components.md # 前端组件
│   │   └── api-reference.md    # API 参考
│   └── database/               # 数据库手册
│       ├── README.md           # 数据库概览
│       ├── api-query-design.md # API 查询设计
│       └── orm-analysis.md     # ORM 分析
│
├── design/                      # 设计文档（版本化）
│   ├── README.md               # 设计文档索引
│   ├── v1/                     # v1 设计文档
│   ├── v2/                     # v2 设计文档
│   └── archive/                # 归档
│
├── archive/                     # TODO 归档
│   └── todo-archive-YYYY-MM.md # 月度任务归档
│
└── README.md                    # 本文件
```

## 快速导航

### 📋 必读文档（开工三件套）

- [人设 (SOUL.md)](./core/SOUL.md) - 开发助手人设和工作规范
- [任务列表 (TODO.md)](./core/TODO.md) - 当前任务状态
- [开发手册](./guides/development/README.md) - 开发规范和流程

### 📚 技术手册

- [开发手册](./guides/development/README.md) - 快速开始、编码规范、核心模块、API 参考
- [数据库手册](./guides/database/README.md) - 数据库设计、ORM 使用、查询 API

### 📐 设计文档

- [设计文档索引](./design/README.md) - 设计文档总入口
- [v1 设计文档](./design/v1/README.md) - v1 版本架构和设计
- [v2 设计文档](./design/v2/README.md) - v2 版本设计（Task Layer、右侧面板等）

### 📁 任务详情

- [core/tasks/](./core/tasks/) - 当前进行中的任务详情文档

### 🗄️ 归档

- [TODO 归档](./archive/) - 已完成任务的月度归档
- [设计归档](./design/archive/) - 已废弃的设计文档

## 项目概述

**Touwaka Mate v2** - AI 专家副本系统 🤖

- **Expert（专家）**：具有独特人设的 AI 角色
- **Topic（话题）**：对话历史的阶段性总结
- **Skill（技能）**：专家可调用的工具能力
- **双心智架构**：表达心智 + 反思心智

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + MySQL |
| ORM | Sequelize |
| AI | LLM 应用开发、Prompt Engineering |

---

*最后更新: 2026-02-24*
