# 助理 Direct 模式工具配置

> **创建时间**: 2026-03-16
> **关联任务**: #67 助理系统设计
> **状态**: ✅ 已完成
> **审计报告**: [CODE_REVIEW.md](./CODE_REVIEW.md)

---

## 1. 需求背景

### 1.1 现状

助理系统支持三种执行模式：
- **direct** - 直接执行指定工具
- **llm** - LLM 推理选择工具
- **hybrid** - 混合模式

当选择 **direct** 模式时，后端需要知道要执行哪个工具（`tool_name`），但前端助理设置页面没有提供工具选择功能，导致：
1. 用户无法在 direct 模式下选择要执行的工具
2. 保存到数据库的 `tool_name` 等字段为空
3. 后端执行时会返回错误："直接模式需要配置 tool_name"

### 1.2 目标

在助理设置页面的编辑弹窗中，当选择 **direct** 执行模式时，显示工具配置区域，让用户可以选择要执行的技能/工具。

---

## 2. 数据库字段

### 2.1 assistants 表（已有）

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_name` | VARCHAR(64) | 工具名称，如 `ocr_analyze` |
| `tool_description` | TEXT | 工具描述 |
| `tool_parameters` | TEXT | JSON Schema 格式的参数定义 |

### 2.2 后端逻辑

当 `execution_mode === 'direct'` 时，后端会调用 `ToolManager.executeTool(assistant.tool_name, ...)` 执行工具。

---

## 3. 修改内容

### 3.1 前端文件

| 文件 | 修改 |
|------|------|
| `frontend/src/components/settings/AssistantEditDialog.vue` | 添加工具配置区域，direct 模式下显示 |
| `frontend/src/i18n/locales/zh-CN.ts` | 添加工具相关中文翻译 |
| `frontend/src/i18n/locales/en-US.ts` | 添加工具相关英文翻译 |

### 3.2 修改详情

#### AssistantEditDialog.vue

1. **引入 skillStore**：使用现有的 `useSkillStore` 获取可用技能列表

2. **表单新增字段**：
   ```typescript
   form = reactive({
     // ... 已有字段
     tool_name: '',
     tool_description: '',
     tool_parameters: '',
   })
   ```

3. **条件显示工具配置区域**：
   ```vue
   <!-- 工具配置（direct 模式专用） -->
   <div v-if="isDirectMode" class="form-section tool-config-section">
     <!-- 工具名称选择 -->
     <select v-model="form.tool_name">
       <option v-for="skill in skillStore.skills" :value="skill.id">
         {{ skill.name }} ({{ skill.id }})
       </option>
     </select>
     <!-- 工具描述和参数 -->
   </div>
   ```

4. **验证逻辑**：direct 模式必须选择工具，否则保存时提示错误

### 3.3 国际化

| Key | 中文 | 英文 |
|-----|------|------|
| `assistant.toolConfig` | 工具配置 | Tool Config |
| `assistant.toolName` | 工具名称 | Tool Name |
| `assistant.toolNameRequired` | direct 模式必须选择要执行的工具 | Direct mode must select a tool to execute |
| `assistant.selectTool` | 请选择工具 | Select a tool |
| `assistant.toolDescription` | 工具描述 | Tool Description |
| `assistant.toolParameters` | 工具参数 | Tool Parameters |

---

## 4. UI 效果

### 4.1 执行模式选择

```
执行模式: [直接执行指定工具 ▼]
           LLM 推理选择工具
           混合模式
```

### 4.2 Direct 模式工具配置

```
┌─────────────────────────────────────────────┐
│ 工具配置 (direct 模式)                      │
├─────────────────────────────────────────────┤
│ 工具名称: [OCR 文字识别 (ocr) ▼]           │
│           ↑ 从技能列表中选择                 │
│                                             │
│ 工具描述: [识别图片中的文字内容...]          │
│                                             │
│ 工具参数: [                                  │
│   {"type": "object", "properties": {...}}  │
│ ]                                           │
└─────────────────────────────────────────────┘
```

---

## 5. 实施记录

| 步骤 | 日期 | 操作 |
|:----:|------|------|
| 1 | 2026-03-16 | 创建 task 目录和文档 |
| 2 | 2026-03-16 | 修改 AssistantEditDialog.vue |
| 3 | 2026-03-16 | 添加 i18n 翻译 |
| 4 | 2026-03-16 | 代码审查 |

---

## 6. 后续扩展

1. **工具参数可视化编辑** - 通过 UI 生成 JSON Schema
2. **工具测试功能** - 在配置页面测试工具是否正常工作
3. **工具筛选** - 只显示适合 direct 模式的工具

---

*创建时间: 2026-03-16*
