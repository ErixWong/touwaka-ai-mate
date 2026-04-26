# Parse4 设计文档 — 合同管理 App 增强

> 本目录包含合同管理 App（contract-mgr）的功能增强设计文档。
> 创建时间：2026-04-26
> 关联 Issue：#645, #646, #648

## 概述

Parse4 在 Parse3 App 平台基础上，针对合同管理 App 进行深度优化：

- **元数据结构优化** — 从扁平 fields 到章节化结构
- **驻留进程 API** — 复杂业务逻辑的扩展能力
- **前端详情页增强** — OCR 全文展示、章节导航、重提取交互

## 文档索引

| 文档 | 说明 | 状态 |
|------|------|------|
| [contract-mgr-metadata-design.md](./contract-mgr-metadata-design.md) | 合同管理元数据结构优化设计 | 已实现 |
| [resident-api-design.md](./resident-api-design.md) | 驻留进程实现小程序自定义 API 设计 | 草稿 |
| [contract-mgr-frontend-design.md](./contract-mgr-frontend-design.md) | 合同管理前端详情页和筛选组件设计 | 已实现 |

## 实施阶段

### Phase 1 — 基础上线（已完成）

- 列表页：基础字段展示 ✓
- 详情页：基础字段 + OCR 原文 ✓

### Phase 2 — 后端章节结构（已完成）

- 扩展表架构 ✓
- API 端点 ✓
- Handler 提示词注入 ✓

### Phase 3 — 前端功能（已完成）

- DocumentContentViewer 控件 ✓
- TreeFilter 筛选组件 ✓
- ReExtractDialog 重提取交互 ✓
- 国际化支持 ✓

## 依赖关系

```
Parse3 App 平台基础
       ↓
Phase 2 后端章节结构
       ↓
Phase 3 前端功能 ← 当前阶段
```

---

*最后更新: 2026-04-26*