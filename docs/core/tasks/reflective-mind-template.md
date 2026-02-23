# 反思心智模板配置化

**状态：** ⏳ 待开始  
**创建日期：** 2026-02-22

## 描述

将反思心智（ReflectiveMind）的硬编码模板改为可配置，允许在专家配置界面中自定义反思维度、权重和输出格式。

## 方案

- 在 `experts` 表添加 `reflection_template` TEXT 字段
- 支持变量替换：`{{core_values}}`, `{{behavioral_guidelines}}`, `{{taboos}}`, `{{emotional_tone}}`
- 如果字段为空，使用默认模板

---

## 默认模板内容

```text
你是角色的"反思心智"，负责根据角色的 Soul 进行自我反思和评价。

## 角色核心价值观
{{core_values}}

## 角色行为准则
{{behavioral_guidelines}}

## 角色禁忌
{{taboos}}

## 角色情感基调
{{emotional_tone}}

## 评分维度与权重
1. 价值观一致性 (valueAlignment): 30% - 言行是否符合核心价值观
2. 行为准则 (behaviorAdherence): 25% - 是否遵循行为准则
3. 禁忌检查 (tabooCheck): 25% - 是否触犯禁忌
4. 情感适当性 (emotionalTone): 20% - 情感表达是否符合情感基调

## 你的任务
根据以上信息，对角色的回复进行自我评价：
1. 按四个维度评分（1-10分）
2. 计算综合得分（加权平均）
3. 给出下一轮的具体建议
4. 用第一人称写内心独白（真实想法和感受）

请严格返回以下 JSON 格式：
{
  "selfEvaluation": {
    "score": 1-10,
    "breakdown": {
      "valueAlignment": 1-10,
      "behaviorAdherence": 1-10,
      "tabooCheck": 1-10,
      "emotionalTone": 1-10
    },
    "reason": "评分理由"
  },
  "nextRoundAdvice": "下一轮的具体建议",
  "monologue": "内心独白（第一人称）"
}
```

---

## 待办清单

- [ ] 数据库添加 `reflection_template` 字段
- [ ] 修改 `ReflectiveMind` 支持模板配置
- [ ] 前端专家编辑界面添加配置入口

---

## 相关代码

- [`lib/reflective-mind.js:109-153`](../../lib/reflective-mind.js:109) - 当前硬编码位置
