# 专家 LLM 参数配置化

**状态：** ✅ 已完成
**创建日期：** 2026-02-22
**完成日期：** 2026-02-23

## 描述

在专家设置界面添加 LLM 参数配置，支持每个专家独立配置 temperature、top_p、frequency_penalty 等参数。

## 当前问题

1. Temperature 写死在代码中：
   - Expressive Mind: 默认 `0.7`（[`llm-client.js:98`](../../lib/llm-client.js:98)）
   - Reflective Mind: 写死 `0.3`（[`llm-client.js:79`](../../lib/llm-client.js:79)）
2. `top_p` / `repeat_penalty` / `frequency_penalty` / `presence_penalty` 完全未实现
3. 数据库 `experts` 表无相关字段

---

## 数据库迁移

添加字段到 `experts` 表：

```sql
ALTER TABLE experts ADD COLUMN temperature DECIMAL(3,2) DEFAULT 0.70 COMMENT 'Expressive Mind 温度';
ALTER TABLE experts ADD COLUMN reflective_temperature DECIMAL(3,2) DEFAULT 0.30 COMMENT 'Reflective Mind 温度';
ALTER TABLE experts ADD COLUMN top_p DECIMAL(3,2) DEFAULT 1.00;
ALTER TABLE experts ADD COLUMN frequency_penalty DECIMAL(3,2) DEFAULT 0.00;
ALTER TABLE experts ADD COLUMN presence_penalty DECIMAL(3,2) DEFAULT 0.00;
```

---

## 参数说明

| 参数 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| `temperature` | 0-2 | 0.7 | 较低更确定，较高更随机 |
| `reflective_temperature` | 0-2 | 0.3 | 反思心智用较低值保证稳定 |
| `top_p` | 0-1 | 1.0 | 核采样，1.0 表示不限制 |
| `frequency_penalty` | -2 到 2 | 0 | 降低重复词频率 |
| `presence_penalty` | -2 到 2 | 0 | 鼓励谈论新话题 |

---

## 待办清单

- [x] 数据库：添加 LLM 参数字段到 `experts` 表
- [x] 后端：更新 `models/expert.js` 模型定义
- [x] 后端：更新 `lib/config-loader.js` 读取新字段
- [x] 后端：更新 `lib/llm-client.js` 使用配置的参数
- [x] 后端：更新 `lib/reflective-mind.js` 使用配置的参数
- [x] 前端：更新 `types/index.ts` Expert 接口
- [x] 前端：更新 `SettingsView.vue` 添加高级参数表单
- [x] 国际化：添加中英文翻译

---

## 相关代码

- [`lib/llm-client.js`](../../lib/llm-client.js) - LLM 调用，temperature 写死位置
- [`lib/reflective-mind.js`](../../lib/reflective-mind.js) - 反思心智
- [`models/expert.js`](../../models/expert.js) - 专家模型
