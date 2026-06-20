# 技能配置系统设计

## 背景

技能可能需要配置参数，例如：
- 天气查询技能需要 API 地址和 API Key
- 数据库技能需要连接字符串
- 邮件发送技能需要 SMTP 配置

## 配置存储方案对比

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| 环境变量 (.env) | 12-factor 推荐，部署简单 | 无法动态配置，需重启 | 系统级配置 |
| 数据库 (skills.config) | 动态配置，多租户支持 | 依赖数据库 | ✅ 技能运行时配置 |
| 配置文件 | 与代码一起管理 | 文件管理麻烦 | 开发期配置 |

## 数据库存储方案

### 设计原则

- **简单灵活**：用户自己管理参数，不强制绑定 SKILL.md 定义
- **按需配置**：用户根据技能说明，手工添加需要的参数
- **全局共享**：所有专家共享同一套配置

### 表结构

只需要一张表 `skill_parameters`：

```sql
CREATE TABLE skill_parameters (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
    param_name VARCHAR(64) NOT NULL COMMENT '参数名（如 api_key, base_url）',
    param_value TEXT NULL COMMENT '参数值',
    is_secret BOOLEAN DEFAULT FALSE COMMENT '是否敏感参数（前端显示/隐藏）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_skill_param (skill_id, param_name),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='技能参数表';
```

**示例数据：**

| skill_id | param_name | param_value | is_secret | 说明 |
|----------|------------|-------------|-----------|------|
| weather | api_key | xxx | 1 | 天气API密钥 |
| weather | base_url | https://api.weather.com | 0 | 天气API地址 |
| weather | timeout | 30 | 0 | 请求超时(秒) |

### 配置来源

```
高  ┌──────────────────────────────────┐
    │ skill_parameters 全局配置        │ ← 数据库存储的参数值
    │                                  │
    ├──────────────────────────────────┤
    │ 环境变量 SKILL_{param_name}      │ ← 运维注入（可选备用）
    │ (子进程环境)                     │
    └──────────────────────────────────┘
```

### 数据库升级脚本

创建文件：`scripts/migrations/2026-02-23-skill-parameters.sql`

```sql
-- =============================================
-- 技能参数表迁移
-- 日期：2026-02-23
-- 描述：创建 skill_parameters 表用于存储技能配置参数
-- =============================================

-- 先检查 skills 表是否存在且字符集一致
-- SHOW CREATE TABLE skills;

CREATE TABLE IF NOT EXISTS skill_parameters (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
    param_name VARCHAR(64) NOT NULL COMMENT '参数名',
    param_value TEXT NULL COMMENT '参数值',
    is_secret BOOLEAN DEFAULT FALSE COMMENT '是否敏感参数（用户控制前端显示）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_skill_param (skill_id, param_name),
    KEY idx_skill_id (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能参数表';

-- 单独添加外键（方便调试错误）
-- 如果报错，先检查：SHOW CREATE TABLE skills; 确认字符集为 utf8mb4
ALTER TABLE skill_parameters
ADD CONSTRAINT fk_skill_params_skill
FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;

-- =============================================
-- 错误 150 排查指南
-- =============================================
-- 1. 检查 skills 表字符集：
--    SHOW CREATE TABLE skills;
--
-- 2. 如果 skills 表是 utf8mb3，改为 utf8mb4：
--    ALTER TABLE skills CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--
-- 3. 如果不需要外键约束，可以删除外键行，只保留 KEY idx_skill_id (skill_id)
--
-- 4. 验证迁移：
--    SHOW TABLES LIKE 'skill_%';
--    DESC skill_parameters;
```

### Sequelize 模型

#### models/skill_parameter.js（新建）

```javascript
import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class skill_parameter extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true
      },
      skill_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        references: {
          model: 'skills',
          key: 'id'
        }
      },
      param_name: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '参数名，如 api_key, base_url'
      },
      param_value: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '参数值'
      },
      is_secret: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否机密参数（用户控制前端显示/隐藏）'
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'skill_parameters',
      timestamps: false,
      indexes: [
        { name: 'PRIMARY', unique: true, fields: ['id'] },
        { name: 'uk_skill_param', unique: true, fields: ['skill_id', 'param_name'] },
        { name: 'idx_skill_id', fields: ['skill_id'] }
      ]
    });
  }
}
```

### 前端界面设计

**参数管理 Modal：**

技能卡片添加「管理参数」按钮，点击打开 Modal 窗口：

```
┌─────────────────────────────────────────────┐
│  技能参数设置 - Weather Skill        [X]    │
├─────────────────────────────────────────────┤
│  参数名      │  参数值        │ 机密 │ 操作 │
├──────────────┼────────────────┼──────┼──────┤
│  api_key     │  [••••••••]    │ [✓]  │ [删] │
│  base_url    │  https://...   │ [ ]  │ [删] │
│  timeout     │  30            │ [ ]  │ [删] │
├──────────────┴────────────────┴──────┴──────┤
│  [+ 添加参数]                               │
├─────────────────────────────────────────────┤
│              [取消]        [保存]           │
└─────────────────────────────────────────────┘
```

**交互说明：**

| 字段 | 控件 | 说明 |
|------|------|------|
| 参数名 | 文本输入框 | 用户输入参数名称（如 api_key） |
| 参数值 | 动态输入框 | 根据「机密」switch 状态切换类型：is_secret=true 时为 password（显示•••），false 时为 text |
| 机密 | Switch 开关 | 用户自己标记是否敏感信息。开启时参数值变为密码框，关闭时显示明文。可随时切换查看 |
| 操作 | 删除按钮 | 删除该参数行 |

**Vue 实现示例：**

```vue
<template>
  <tr v-for="param in parameters" :key="param.id">
    <td><input v-model="param.param_name" placeholder="参数名" /></td>
    <td>
      <!-- 根据 is_secret 切换输入框类型 -->
      <input
        v-model="param.param_value"
        :type="param.is_secret ? 'password' : 'text'"
        placeholder="参数值"
      />
    </td>
    <td>
      <!-- 机密开关：控制显示/隐藏 -->
      <label class="switch">
        <input v-model="param.is_secret" type="checkbox" />
        <span class="slider"></span>
      </label>
    </td>
    <td><button @click="removeParam(param)">删除</button></td>
  </tr>
</template>
```

**工作流程：**
1. 用户点击「管理参数」打开 Modal
2. 显示已有参数列表（name/value/is_secret）
3. 用户点击「机密」switch：
   - 开启 → 参数值输入框变为 password 类型（显示•••）
   - 关闭 → 参数值输入框变为 text 类型（显示明文）
4. 用户可随时切换开关查看/隐藏敏感值
5. 点击「添加参数」新增空白行
6. 点击「保存」提交到后端

## 实现细节

### 1. 配置注入机制

**子进程技能（环境变量注入 - 安全隔离版）**

⚠️ **安全要求**：只注入当前技能的配置，不暴露其他技能或系统的敏感信息

```javascript
// lib/skill-loader.js
async executeSkillTool(skillId, toolName, params, context) {
  // 从数据库读取该技能的参数
  const parameters = await this.db.skill_parameter.findAll({
    where: { skill_id: skillId }
  });
  
  // 构建参数对象
  const config = parameters.reduce((acc, p) => {
    acc[p.param_name] = p.param_value;
    return acc;
  }, {});
  
  // 构建该技能的最小化环境变量（安全隔离）
  const env = this.buildSkillEnvironment(skillId, config);
  
  // 启动子进程 - 只传递最小化 env
  const proc = spawn('node', [SKILL_RUNNER_PATH, skillId, toolName], {
    env,  // ❌ 不要传递 ...process.env
    timeout: SKILL_EXECUTION_TIMEOUT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  // ... 后续逻辑
}

/**
 * 构建技能的最小化环境变量
 * 安全原则：只暴露该技能需要的配置，不暴露其他技能或系统环境变量
 */
buildSkillEnvironment(skillId, config) {
  // 最小化系统环境变量白名单（仅保留必要的）
  const allowedSystemVars = ['PATH', 'NODE_ENV', 'HOME', 'TMPDIR', 'LANG', 'TZ'];
  const systemEnv = Object.fromEntries(
    allowedSystemVars
      .filter(key => process.env[key])
      .map(key => [key, process.env[key]])
  );
  
  return {
    ...systemEnv,               // 1. 最小化系统变量
    SKILL_ID: skillId,          // 2. 当前技能ID
    SKILL_PATH: path.join(this.skillsBasePath, skillId),
    SKILL_CONFIG: JSON.stringify(config),  // 3. 完整配置JSON
    // 4. 展开配置为独立环境变量（便于技能直接读取）
    ...Object.entries(config).reduce((acc, [key, value]) => {
      acc[`SKILL_${key.toUpperCase()}`] = String(value);
      return acc;
    }, {}),
    NODE_OPTIONS: `--max-old-space-size=${SKILL_MEMORY_LIMIT}`,
  };
}
```

**子进程中读取配置：**
```javascript
// 方式1：读取完整配置对象
const config = JSON.parse(process.env.SKILL_CONFIG || '{}');
const apiKey = config.api_key;

// 方式2：直接读取独立环境变量（推荐）
const apiKey = process.env.SKILL_API_KEY;
const baseUrl = process.env.SKILL_BASE_URL;
```

### 2. 内置技能配置读取

```javascript
// lib/tool-manager.js
async executeTool(toolName, params, context = {}) {
  const skillId = this.toolToSkill.get(toolName);
  
  // 为内置技能注入配置
  if (skillId === 'builtin') {
    context.skillConfig = await this.getSkillConfig(skillId);
    return await this.executeBuiltinTool(toolName, params, context);
  }
  
  // ... 其他技能
}

// 获取技能配置
async getSkillConfig(skillId) {
  const parameters = await this.db.skill_parameter.findAll({
    where: { skill_id: skillId }
  });
  return parameters.reduce((acc, p) => {
    acc[p.param_name] = p.param_value;
    return acc;
  }, {});
}
```

### 3. API 设计

**获取技能参数**
```
GET /api/skills/:id/parameters

Response:
{
  "success": true,
  "data": [
    { "id": "p1", "param_name": "api_key", "param_value": "xxx", "is_secret": true },
    { "id": "p2", "param_name": "base_url", "param_value": "https://...", "is_secret": false }
  ]
}
```

**保存技能参数（全量替换）**
```
POST /api/skills/:id/parameters

Request:
{
  "parameters": [
    { "param_name": "api_key", "param_value": "xxx", "is_secret": true },
    { "param_name": "base_url", "param_value": "https://...", "is_secret": false }
  ]
}
```

## 实现优先级

1. **P1**: 数据库迁移 - 创建 `skill_parameters` 表
2. **P1**: 后端模型 - `models/skill_parameter.js`
3. **P1**: 后端 API - 参数 CRUD 接口
4. **P2**: 后端集成 - `lib/skill-loader.js` 读取参数并注入环境变量
5. **P2**: 前端 Modal - 参数管理弹窗
6. **P3**: 前端集成 - 技能卡片添加「管理参数」按钮

## 相关文件

- `scripts/migrations/2026-02-23-skill-parameters.sql` - 数据库迁移（新建）
- `models/skill_parameter.js` - Sequelize 模型（新建）
- `server/controllers/skill.controller.js` - 参数 CRUD API
- `lib/skill-loader.js` - 子进程环境变量注入
- `lib/tool-manager.js` - 内置技能配置注入
- `frontend/src/views/SkillsView.vue` - 技能管理页面
