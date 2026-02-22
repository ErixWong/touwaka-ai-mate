# Touwaka Mate v2 文档

## 目录结构

```
docs/
├── core/                        # 核心必读（每次开工必读）
│   ├── SOUL.md                 # 人设
│   ├── TODO.md                 # 任务列表
│   └── development-guide.md    # 开发指南
│
├── guides/                      # 开发手册（技术参考）
│   └── database/               # 数据库手册
│       ├── README.md           # 数据库概览
│       ├── api-query-design.md # API 查询设计
│       └── orm-analysis.md     # ORM 分析
│
├── design/                      # 设计文档（版本化）
│   ├── v1/                     # v1 设计文档
│   ├── v2/                     # v2 设计文档
│   └── archive/                # 归档
│
└── README.md                    # 本文件
```

## 快速导航

### 📋 必读文档

- [人设 (SOUL.md)](./core/SOUL.md) - 开发助手人设和工作规范
- [任务列表 (TODO.md)](./core/TODO.md) - 当前任务状态
- [开发指南 (development-guide.md)](./core/development-guide.md) - 开发规范和流程

### 📚 技术手册

- [数据库手册](./guides/database/README.md) - 数据库设计、ORM 使用、查询 API

### 📐 设计文档

- [v1 设计文档](./design/v1/README.md) - v1 版本的设计文档
- [v2 设计文档](./design/v2/) - v2 版本的设计文档

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

*最后更新: 2026-02-20*
