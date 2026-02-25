# 技能 LLM 分析功能

> 创建日期：2026-02-25

## 背景

当前技能导入只能做基础的规则解析，无法理解知识型技能（如 PDF）的语义。需要使用 LLM 来分析技能内容，提取工具定义和参数。

## 设计方案

### 两阶段导入

```
阶段1: 手工导入（快速）
- 用户指定技能路径
- 系统读取 SKILL.md
- 存储到 skills 表：name, source_path, skill_md

阶段2: LLM 分析（异步/按需）
- 读取 skills.skill_md
- 扫描 source_path/scripts/ 目录
- 调用 LLM 分析
- 更新 skills 表：description, license, argument_hint 等
- 写入 skill_tools 表：工具定义和参数
```

### 前端界面

在技能管理页面添加"重新分析"按钮：
- 点击后调用 LLM 分析接口
- 显示分析进度
- 完成后刷新技能详情

## 技术实现

### 1. 分析接口

```javascript
// POST /api/skills/:id/analyze
async function analyzeSkill(skillId) {
  // 1. 读取 skill 记录
  const skill = await Skill.findByPk(skillId);
  
  // 2. 扫描 scripts 目录
  const scripts = scanScripts(skill.source_path);
  
  // 3. 构建 LLM 提示词
  const prompt = buildAnalysisPrompt(skill.skill_md, scripts);
  
  // 4. 调用 LLM
  const result = await callLLM(prompt);
  
  // 5. 更新数据库
  await updateSkillFromAnalysis(skillId, result);
}
```

### 2. LLM 提示词

```
你是一个技能分析专家。请分析以下技能文件，提取工具定义和参数。

## SKILL.md 内容
{skill_md}

## 脚本文件
{scripts}

请以 JSON 格式返回：
{
  "description": "技能描述",
  "license": "MIT/Proprietary",
  "argument_hint": "[参数提示]",
  "tools": [
    {
      "name": "工具名称",
      "description": "工具描述",
      "parameters": {
        "type": "object",
        "properties": {
          "param1": { "type": "string", "description": "参数描述" }
        },
        "required": ["param1"]
      }
    }
  ]
}
```

### 3. 数据库更新

```javascript
async function updateSkillFromAnalysis(skillId, analysis) {
  // 更新 skills 表
  await Skill.update({
    description: analysis.description,
    license: analysis.license,
    argument_hint: analysis.argument_hint,
  }, { where: { id: skillId } });
  
  // 删除旧的 skill_tools 记录
  await SkillTool.destroy({ where: { skill_id: skillId } });
  
  // 插入新的 skill_tools 记录
  for (const tool of analysis.tools) {
    await SkillTool.create({
      id: generateId(),
      skill_id: skillId,
      name: tool.name,
      description: tool.description,
      parameters: JSON.stringify(tool.parameters),
    });
  }
}
```

## 任务清单

- [ ] 后端：实现 `/api/skills/:id/analyze` 接口
- [ ] 后端：增强 `skill-analyzer.js` 支持脚本扫描
- [ ] 前端：添加"重新分析"按钮
- [ ] 前端：显示分析进度和结果
- [ ] 测试：验证 PDF 技能的分析结果

## 数据库优化

### source_path 和 source_url 合并

当前 `skills` 表有两个字段：
- `source_path` - 本地路径
- `source_url` - 远程路径

这两个字段互斥，可以合并成一个 `source_location` 字段：
- 本地路径：`/path/to/skill` 或 `data/skills/xxx`
- 远程路径：`https://github.com/xxx/skill`

### 迁移脚本

```sql
-- 1. 添加新字段
ALTER TABLE skills ADD COLUMN source_location VARCHAR(512);

-- 2. 迁移数据
UPDATE skills SET source_location = source_path WHERE source_path IS NOT NULL;
UPDATE skills SET source_location = source_url WHERE source_url IS NOT NULL AND source_path IS NULL;

-- 3. 删除旧字段
ALTER TABLE skills DROP COLUMN source_path;
ALTER TABLE skills DROP COLUMN source_url;
```

## 相关文件

- `lib/skill-analyzer.js` - 技能分析器
- `server/controllers/skill.controller.js` - 技能控制器
- `frontend/src/views/SkillsView.vue` - 技能管理页面
- `data/skills/skill-importer/` - 技能导入器
- `models/skill.js` - 技能模型
