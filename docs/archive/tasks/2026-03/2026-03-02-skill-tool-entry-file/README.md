# 技能工具入口脚本字段

> 创建日期: 2026-03-02
> 状态: 已完成
> 分支: feature/skill-tool-entry-file

## 📋 需求概述

### 背景

当前 `skill_tools` 表没有入口脚本字段，导致 skill-runner 只能执行技能目录下的 `index.js` 文件。但实际场景中，一个技能可能包含多个工具，每个工具有独立的脚本文件：

**示例：pptx 技能**
```
data/skills/pptx/
├── SKILL.md
├── scripts/
│   ├── thumbnail.py      # 缩略图生成
│   ├── add_slide.py      # 添加幻灯片
│   ├── clean.py          # 清理脚本
│   └── office/
│       ├── unpack.py     # 解包 pptx
│       ├── pack.py       # 打包 pptx
│       └── soffice.py    # LibreOffice 调用
```

当前 `skill-runner.js` 硬编码加载 `index.js`：
```javascript
// lib/skill-runner.js:109-117
const indexJsPath = path.join(skillPath, 'index.js');
if (!fs.existsSync(indexJsPath)) {
  throw new Error(`Skill not found: ${indexJsPath}`);
}
return fs.readFileSync(indexJsPath, 'utf-8');
```

### 目标

1. 在 `skill_tools` 表添加 `entry_file` 字段，支持每个工具指定独立的入口脚本
2. 修改 `skill-runner.js` 支持加载指定的入口文件
3. 支持多语言脚本（.js, .py, .sh 等）

## 🎯 技术方案

### 数据库变更

**新增字段：`skill_tools.script_path`**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| script_path | VARCHAR(255) | 'index.js' | 工具入口脚本路径（相对于技能目录） |

**示例数据：**
```sql
-- pptx 技能的工具配置
INSERT INTO skill_tools (skill_id, name, script_path, description) VALUES
('pptx', 'thumbnail', 'scripts/thumbnail.py', '生成幻灯片缩略图'),
('pptx', 'add_slide', 'scripts/add_slide.py', '添加幻灯片'),
('pptx', 'unpack', 'scripts/office/unpack.py', '解包 pptx 文件'),
('pptx', 'pack', 'scripts/office/pack.py', '打包 pptx 文件');
```

### 代码变更

#### 1. skill-loader.js

在 `convertToolToOpenAIFormat` 方法中添加 `script_path` 到 `_meta`：

```javascript
_meta: {
  toolId: toolId,
  skillId: skill.id,
  toolName: toolRow.name,
  scriptPath: toolRow.script_path || 'index.js',  // 新增
  // ...
}
```

#### 2. skill-runner.js

修改 `loadSkill` 函数，接收 `scriptPath` 参数：

```javascript
function loadSkill(skillId, scriptPath = 'index.js') {
  let skillPath = process.env.SKILL_PATH;
  const scriptFullPath = path.join(skillPath, scriptPath);
  
  if (!fs.existsSync(scriptFullPath)) {
    throw new Error(`Tool script not found: ${scriptFullPath}`);
  }
  
  return fs.readFileSync(scriptFullPath, 'utf-8');
}
```

#### 3. 多语言支持

根据 `script_path` 扩展名选择执行器：

| 扩展名 | 执行器 |
|--------|--------|
| .js | node |
| .py | python |
| .sh | bash |

## 🎯 验收标准

- [x] 字段名确认：`script_path`
- [x] `skill_tools` 表添加 `script_path` 字段（迁移脚本已创建）
- [x] `skill-loader.js` 读取并传递 `script_path`
- [x] `skill-runner.js` 支持加载指定脚本文件
- [x] `tool-manager.js` 传递 `script_path` 到 `executeSkillTool`
- [x] `skill-manager` 技能支持 `script_path` 参数
- [ ] 支持 Python 脚本执行（待后续实现）
- [ ] 测试用例通过

## 📝 开发笔记

<!-- 开发过程中的重要决策、遇到的问题等 -->

## 🔗 相关链接

- 相关 TODO: [Tools 表执行路径字段](../../TODO.md#tools-表执行路径字段)
- 相关任务: [skill-runner 多语言支持](../../TODO.md#skill-runner-多语言支持)
- Code Review: [review.md](./review.md)

---

## ⚠️ 待确认事项

**数据库字段变更已确认！**

在 `skill_tools` 表添加以下字段：
- `script_path` VARCHAR(255) DEFAULT 'index.js'
