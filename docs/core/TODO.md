# 项目待办事项

> 最后更新：2026-02-22

## 待开始

### 1. 反思心智模板配置化

**状态：** ⏳ 待开始

**描述：** 将反思心智（ReflectiveMind）的硬编码模板改为可配置，允许在专家配置界面中自定义反思维度、权重和输出格式。

**方案：**
- 在 `experts` 表添加 `reflection_template` TEXT 字段
- 支持变量替换：`{{core_values}}`, `{{behavioral_guidelines}}`, `{{taboos}}`, `{{emotional_tone}}`
- 如果字段为空，使用默认模板

**默认模板内容：**
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

**待办：**
- [ ] 数据库添加 `reflection_template` 字段
- [ ] 修改 `ReflectiveMind` 支持模板配置
- [ ] 前端专家编辑界面添加配置入口

**相关代码：**
- [`lib/reflective-mind.js:109-153`](../../lib/reflective-mind.js:109) - 当前硬编码位置

---

### 3. Skill 管理系统

**状态：** ⏳ 待开始

**描述：** 实现技能管理系统，支持多种来源安装、AI解析、工具清单生成。

**核心理念：**
- 技能来源：URL / 上传ZIP / 本地目录（不需要技能市场界面）
- AI解析：注册时调用便宜AI（DeepSeek/通义）分析技能
  - 安全检查（检测恶意代码）
  - 提取工具清单（存入 skill_tools 表）
  - 生成结构化元数据
- 技能维护：通过对话维修、升级技能

**数据库：**
- `skills` 表：技能元数据 + 安全评分
- `skill_tools` 表：工具清单（AI生成）

**待办：**
- [ ] 数据库：创建 `skills` 和 `skill_tools` 表
- [ ] 后端：技能安装API（from-url / from-zip / from-path）
- [ ] 后端：AI分析服务（调用便宜AI解析技能）
- [ ] 后端：技能CRUD API
- [ ] 前端：添加技能页面（三种来源表单）
- [ ] 前端：技能列表页面
- [ ] AI基础能力：`read` / `write` / `execute` / `http_get` / `http_post`

**相关文档：**
- [技能管理系统设计方案 v2.0](../design/v2/skill-market-design.md)

---

## 进行中

### 2. 对话窗口右侧多功能 Panel

**状态：** ✅ 基础功能已完成

**描述：** 在对话页面右侧实现一个固定显示的面板容器，采用 Tab 页形式组织多个功能模块。

**Tab 页：**
1. ~~**Docs Tab**~~ - ❌ 已移除（简化设计）
2. **Topics Tab** - ✅ 历史话题列表（已完成）
3. **Debug Tab** - ✅ 调试信息（已完成）

**已完成：**
- [x] 实现 `RightPanel.vue` 容器组件
- [x] 迁移 `DebugPanel.vue` 到 `DebugTab.vue`
- [x] 实现 `TopicsTab.vue` 组件
- [x] 实现通用分页组件 `Pagination.vue`
- [x] 创建 `panel.ts` 状态管理
- [x] 更新 `types/index.ts` 添加分页类型
- [x] 更新国际化文件（zh-CN, en-US）
- [x] 修改 `ChatView.vue` 集成右侧面板
- [x] 后端 Topics 分页 API 实现（`topic.controller.js`）
- [x] Topic 消息计数和标题自动更新功能
- [x] 移除 Docs Tab（简化设计）

**待办：**
- [ ] Topics Tab 支持加载更多/无限滚动
- [ ] Debug Tab 显示更多调试信息（如 token 统计）

**相关文档：**
- [右侧面板设计方案 v2](../design/v2/right-panel-design.md)
- [API 查询设计规范](../guides/database/api-query-design.md)

---

## 文档索引

### 数据库手册
| 文档 | 描述 |
|------|------|
| [README.md](../guides/database/README.md) | 数据库概览与快速开始 |
| [api-query-design.md](../guides/database/api-query-design.md) | 复杂查询 API 规范 |
| [orm-analysis.md](../guides/database/orm-analysis.md) | ORM 选型分析 |

### 设计文档
| 文档 | 描述 |
|------|------|
| [right-panel-design.md](../design/v2/right-panel-design.md) | 右侧面板容器设计 |
| [task-layer-design.md](../design/v2/task-layer-design.md) | 任务层设计 |
| [api-design.md](../design/v1/api-design.md) | API 设计文档 (v1) |
| [ui-design-draft.md](../design/v1/ui-design-draft.md) | UI 设计草稿 (v1) |
| [i18n-design.md](../design/v1/i18n-design.md) | 国际化设计 (v1) |

---

*使用说明：状态图标含义*
- 🔄 进行中
- ⏳ 待开始  
- ✅ 已完成
- ❌ 已取消
