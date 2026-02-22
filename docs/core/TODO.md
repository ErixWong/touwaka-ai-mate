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

**状态：** 🔄 进行中

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

**已完成：**
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

**待办：**
- [ ] 数据库迁移：执行下方迁移脚本
- [ ] 后端：URL下载安装功能
- [ ] 后端：AI分析服务（调用便宜AI解析技能）
- [ ] 测试：完整功能测试
- [x] AI基础能力：`read` / `write` / `execute` / `http_get` / `http_post`
  - 已创建 `skills/builtin/` 内置技能
  - 实现 7 类 18 个工具：读取、写入、编辑、搜索、管理、压缩、执行、网络

**数据库迁移脚本：**
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

**相关文档：**
- [技能管理系统设计方案 v2.0](../design/v2/skill-market-design.md)

---

## 已完成

### 1. SSE 连接自动重连机制

**状态：** ✅ 已完成

**描述：** 解决后端重启后前端无法连接的问题，实现 SSE 连接断开自动重连和 API 健康检查。

**实现内容：**
- **SSE 自动重连**：连接断开后每 3 秒自动重试，最多 10 次
- **健康检查**：每 5 秒检测后端可用性
- **智能等待**：发送消息时如后端不可用，自动等待后端恢复（最多 30 秒）
- **状态提示**：UI 显示连接状态和重连进度

**相关文件：**
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - SSE 连接管理和重连逻辑
- [`frontend/src/composables/useNetworkStatus.ts`](../../frontend/src/composables/useNetworkStatus.ts) - 网络状态检测 composable
- [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) - 中文翻译
- [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) - 英文翻译

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
