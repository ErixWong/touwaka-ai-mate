# 合同管理 App 元数据结构优化设计

> Issue: #645
> 状态: 已采纳（Phase 2 后端已完成）

## 背景

当前销售合同管理 App（contract-mgr）的元数据提取设计为扁平 fields 结构，无法支撑用户查阅合同的完整需求。

## 用户场景

### 清单页（列表视图）

用户需要快速浏览、筛选合同。当前设计合理：

- 合同编号、签订日期、甲方、乙方、金额、状态

### 详情页（双击打开）

用户需要：

1. **头部** — 基础数据摘要（确认核心信息）
2. **中部** — 章节目录 + 关键条款（定位条款、了解要点）
3. **底部** — OCR 原文（查看原始内容、核对细节）
4. **操作区** — 确认/修改按钮（审核入库）

## 问题分析

| 问题 | 说明 |
|------|------|
| 扁平结构 | `fields` 只存储基础数据，无法结构化存储章节和条款 |
| 检索受限 | 无法独立检索特定条款（如"付款条款"、"违约责任"） |
| 导航缺失 | 详情页缺少章节目录导航 |

## 解决方案

### 数据结构设计

```json
{
  "contract_number": "HT-2024-001",
  "party_a": "XX科技有限公司",
  "party_b": "YY商贸公司",
  "contract_amount": 500000,
  
  "sections": {
    "payment": {
      "title": "付款条款",
      "clauses": [
        {"id": "3.1", "content": "分期付款..."},
        {"id": "3.2", "content": "付款期限..."}
      ]
    },
    "breach": {
      "title": "违约责任",
      "clauses": [...]
    }
  },
  
  "full_text": "OCR原文..."
}
```

### 数据库设计

新增扩展表：

| 表名 | 说明 |
|------|------|
| `app_contract_contents` | 存储 OCR 全文和章节结构 |
| `app_contract_sections` | 存储章节信息（可选，用于独立检索） |

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mini-apps/:appId/content/:rowId` | GET | 获取 OCR 全文和章节结构 |
| `/api/mini-apps/:appId/extension/distinct` | GET | 获取字段唯一值（用于筛选） |

## 实施阶段

### Phase 1 — 基础上线（已完成）

- 列表页：基础字段展示
- 详情页：基础字段 + OCR 原文

### Phase 2 — 后端章节结构（已完成）

- 扩展表架构
- API 端点
- Handler 提示词注入

### Phase 3 — 前端功能（进行中）

详见 [contract-mgr-frontend-design.md](./contract-mgr-frontend-design.md)

## 影响范围

| 文件 | 说明 |
|------|------|
| `apps/contract-mgr/manifest.json` | fields 定义 |
| 提取 handler 逻辑 | 章节解析 |
| 详情页前端组件 | DocumentContentViewer |
| 数据库结构 | 扩展表 |

---

*最后更新: 2026-04-26*