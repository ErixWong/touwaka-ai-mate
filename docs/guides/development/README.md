# 开发手册

本手册涵盖 Touwaka Mate v2 的开发规范、核心模块和 API 参考。

## 文档索引

| 文档 | 说明 |
|------|------|
| [快速开始](./quick-start.md) | 环境配置、启动命令、目录结构 |
| [编码规范](./coding-standards.md) | snake_case 铁律、命名规范、响应格式 |
| [核心模块](./core-modules.md) | ChatService、LLMClient、MemorySystem、认证中间件 |
| [前端组件](./frontend-components.md) | 右侧面板、通用分页 |
| [API 参考](./api-reference.md) | 端点列表、环境变量、错误码 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Pinia + Vite |
| 后端 | Node.js + Koa + @koa/router |
| 数据库 | MySQL 8.0+ |
| 认证 | JWT 双 Token |
| 流式 | SSE |

## 架构

```
Frontend (Vue 3) ←→ API Server (Koa) ←→ Service Layer ←→ MySQL
```

核心服务：`ChatService` → `ExpertChatService` → `LLMClient`/`MemorySystem`/`ReflectiveMind`

## 相关资源

- [数据库手册](../database/README.md) - 数据库设计、ORM 使用
- [经验教训](../../design/lessons-learned.md) - 常见问题和解决方案

---

*最后更新: 2026-02-22*
