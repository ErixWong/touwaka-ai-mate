# 系统配置功能设计方案

**项目**: Touwaka Mate V2  
**创建日期**: 2026-03-08  
**状态**: 设计稿，待 Eric 确认

---

## 1. 数据存储方案

### 方案 A：独立配置表（推荐）

创建专门的 `system_settings` 表存储系统配置：

```sql
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  value_type VARCHAR(20) DEFAULT 'string',  -- string, number, boolean, json
  description VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始数据
INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
-- LLM 默认参数
('llm.context_threshold', '0.70', 'number', '上下文压缩阈值'),
('llm.temperature', '0.70', 'number', '表达温度默认值'),
('llm.reflective_temperature', '0.30', 'number', '反思温度默认值'),
('llm.top_p', '1.0', 'number', 'Top-p 采样默认值'),
('llm.frequency_penalty', '0.0', 'number', '频率惩罚默认值'),
('llm.presence_penalty', '0.0', 'number', '存在惩罚默认值'),
('llm.max_tokens', '4096', 'number', '最大 Token 默认值'),

-- 连接限制
('connection.max_per_user', '5', 'number', '每用户最大 SSE 连接数'),
('connection.max_per_expert', '100', 'number', '每 Expert 最大 SSE 连接数'),

-- Token 配置
('token.access_expiry', '15m', 'string', 'Access Token 过期时间'),
('token.refresh_expiry', '7d', 'string', 'Refresh Token 过期时间'),

-- 分页配置
('pagination.default_size', '20', 'number', '默认分页大小'),
('pagination.max_size', '100', 'number', '最大分页大小');
```

**优点**：
- 配置项可动态增减
- 支持描述字段
- 易于扩展

### 方案 B：JSON 配置文件

在 `config/` 目录下创建 `system.json`：

```json
{
  "llm": {
    "context_threshold": 0.70,
    "temperature": 0.70,
    "reflective_temperature": 0.30,
    "top_p": 1.0,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0,
    "max_tokens": 4096
  },
  "connection": {
    "max_per_user": 5,
    "max_per_expert": 100
  },
  "token": {
    "access_expiry": "15m",
    "refresh_expiry": "7d"
  },
  "pagination": {
    "default_size": 20,
    "max_size": 100
  }
}
```

**优点**：
- 简单直接
- 无需数据库变更

**缺点**：
- 需要重启服务才能生效
- 不支持运行时修改

---

## 2. 后端 API 设计

### 2.1 获取所有系统配置

```
GET /api/system-settings
```

**权限**: 需要管理员角色

**响应**:
```json
{
  "code": 0,
  "data": {
    "llm": {
      "context_threshold": 0.70,
      "temperature": 0.70,
      "reflective_temperature": 0.30,
      "top_p": 1.0,
      "frequency_penalty": 0.0,
      "presence_penalty": 0.0,
      "max_tokens": 4096
    },
    "connection": {
      "max_per_user": 5,
      "max_per_expert": 100
    },
    "token": {
      "access_expiry": "15m",
      "refresh_expiry": "7d"
    },
    "pagination": {
      "default_size": 20,
      "max_size": 100
    }
  }
}
```

### 2.2 更新系统配置

```
PUT /api/system-settings
```

**权限**: 需要管理员角色

**请求体**:
```json
{
  "llm": {
    "temperature": 0.80,
    "context_threshold": 0.75
  },
  "connection": {
    "max_per_user": 10
  }
}
```

**响应**:
```json
{
  "code": 0,
  "message": "系统配置已更新"
}
```

### 2.3 重置为默认值

```
POST /api/system-settings/reset
```

**权限**: 需要管理员角色

**请求体**:
```json
{
  "keys": ["llm.temperature", "connection.max_per_user"]
  // 或 "all": true 重置所有
}
```

---

## 3. 前端界面设计

### 3.1 位置

在现有 [`SettingsView.vue`](frontend/src/views/SettingsView.vue) 的 tabs 中添加新标签：

```typescript
const tabs = computed(() => [
  { key: 'profile', label: t('settings.profile') },
  { key: 'model', label: t('settings.modelAndProvider') },
  { key: 'expert', label: t('settings.expertSettings') },
  { key: 'system', label: t('settings.systemConfig') },  // 新增
  { key: 'user', label: t('settings.userManagement') },
  { key: 'role', label: t('settings.roleManagement') },
  { key: 'organization', label: t('settings.organizationManagement') },
  { key: 'about', label: t('settings.about') },
])
```

**注意**: `system` 标签仅对管理员可见

### 3.2 界面布局

```
┌─────────────────────────────────────────────────────────────┐
│  系统配置                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📊 LLM 默认参数                            [重置]  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                     │   │
│  │  上下文压缩阈值    [0.70    ]  (0-1)               │   │
│  │  表达温度          [0.70    ]  (0-2)               │   │
│  │  反思温度          [0.30    ]  (0-2)               │   │
│  │  Top-p 采样        [1.00    ]  (0-1)               │   │
│  │  频率惩罚          [0.00    ]  (0-2)               │   │
│  │  存在惩罚          [0.00    ]  (0-2)               │   │
│  │  最大 Token        [4096    ]                      │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔗 连接限制                                [重置]  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                     │   │
│  │  每用户最大连接数  [5       ]                       │   │
│  │  每 Expert 最大连接数 [100   ]                      │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔐 Token 配置                              [重置]  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                     │   │
│  │  Access Token 过期时间 [15m  ]  (如: 15m, 1h, 1d)  │   │
│  │  Refresh Token 过期时间 [7d   ]  (如: 1d, 7d, 30d) │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📄 分页配置                                [重置]  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                     │   │
│  │  默认分页大小      [20      ]                       │   │
│  │  最大分页大小      [100     ]                       │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                              [ 重置全部 ]  [ 保存更改 ]    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 组件结构

创建新组件 [`frontend/src/components/settings/SystemConfigTab.vue`](frontend/src/components/settings/SystemConfigTab.vue)：

```vue
<template>
  <div class="system-config-tab">
    <!-- LLM 参数配置 -->
    <div class="config-section">
      <div class="section-header">
        <h3 class="section-title">📊 {{ $t('settings.llmDefaults') }}</h3>
        <button class="btn-reset-section" @click="resetSection('llm')">
          {{ $t('common.reset') }}
        </button>
      </div>
      
      <div class="config-grid">
        <div class="config-item">
          <label class="config-label">{{ $t('settings.contextThreshold') }}</label>
          <input type="number" v-model.number="form.llm.context_threshold" 
                 min="0" max="1" step="0.05" class="config-input" />
          <span class="config-hint">0-1</span>
        </div>
        
        <div class="config-item">
          <label class="config-label">{{ $t('settings.temperature') }}</label>
          <input type="number" v-model.number="form.llm.temperature" 
                 min="0" max="2" step="0.1" class="config-input" />
          <span class="config-hint">0-2</span>
        </div>
        
        <!-- ... 其他 LLM 参数 -->
      </div>
    </div>
    
    <!-- 连接限制配置 -->
    <div class="config-section">
      <!-- ... -->
    </div>
    
    <!-- Token 配置 -->
    <div class="config-section">
      <!-- ... -->
    </div>
    
    <!-- 分页配置 -->
    <div class="config-section">
      <!-- ... -->
    </div>
    
    <!-- 底部操作按钮 -->
    <div class="config-actions">
      <button class="btn-reset-all" @click="resetAll">
        {{ $t('settings.resetAll') }}
      </button>
      <button class="btn-save" @click="saveConfig" :disabled="!hasChanges">
        {{ $t('settings.saveChanges') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useSystemSettingsStore } from '@/stores/systemSettings'

const systemSettingsStore = useSystemSettingsStore()

const form = reactive({
  llm: {
    context_threshold: 0.70,
    temperature: 0.70,
    reflective_temperature: 0.30,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    max_tokens: 4096,
  },
  connection: {
    max_per_user: 5,
    max_per_expert: 100,
  },
  token: {
    access_expiry: '15m',
    refresh_expiry: '7d',
  },
  pagination: {
    default_size: 20,
    max_size: 100,
  },
})

const hasChanges = computed(() => {
  return JSON.stringify(form) !== JSON.stringify(systemSettingsStore.settings)
})

const saveConfig = async () => {
  await systemSettingsStore.updateSettings(form)
}

const resetSection = (section: string) => {
  systemSettingsStore.resetSection(section)
  Object.assign(form[section], systemSettingsStore.settings[section])
}

const resetAll = () => {
  systemSettingsStore.resetAll()
  Object.assign(form, systemSettingsStore.settings)
}

onMounted(async () => {
  await systemSettingsStore.fetchSettings()
  Object.assign(form, systemSettingsStore.settings)
})
</script>
```

### 3.4 Pinia Store

创建 [`frontend/src/stores/systemSettings.ts`](frontend/src/stores/systemSettings.ts)：

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/utils/api'

export interface SystemSettings {
  llm: {
    context_threshold: number
    temperature: number
    reflective_temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
    max_tokens: number
  }
  connection: {
    max_per_user: number
    max_per_expert: number
  }
  token: {
    access_expiry: string
    refresh_expiry: string
  }
  pagination: {
    default_size: number
    max_size: number
  }
}

export const useSystemSettingsStore = defineStore('systemSettings', () => {
  const settings = ref<SystemSettings | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const fetchSettings = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.get('/api/system-settings')
      settings.value = response.data.data
    } catch (e: any) {
      error.value = e.message
    } finally {
      isLoading.value = false
    }
  }

  const updateSettings = async (newSettings: Partial<SystemSettings>) => {
    isLoading.value = true
    error.value = null
    try {
      await api.put('/api/system-settings', newSettings)
      await fetchSettings()
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      isLoading.value = false
    }
  }

  const resetSection = async (section: string) => {
    await api.post('/api/system-settings/reset', { section })
    await fetchSettings()
  }

  const resetAll = async () => {
    await api.post('/api/system-settings/reset', { all: true })
    await fetchSettings()
  }

  return {
    settings,
    isLoading,
    error,
    fetchSettings,
    updateSettings,
    resetSection,
    resetAll,
  }
})
```

---

## 4. 后端控制器

创建 [`server/controllers/system-setting.controller.js`](server/controllers/system-setting.controller.js)：

```javascript
import { BaseController } from './base.controller.js'

// 默认配置
const DEFAULT_SETTINGS = {
  llm: {
    context_threshold: 0.70,
    temperature: 0.70,
    reflective_temperature: 0.30,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    max_tokens: 4096,
  },
  connection: {
    max_per_user: 5,
    max_per_expert: 100,
  },
  token: {
    access_expiry: '15m',
    refresh_expiry: '7d',
  },
  pagination: {
    default_size: 20,
    max_size: 100,
  },
}

export class SystemSettingController extends BaseController {
  constructor(db) {
    super(db, 'SystemSetting')
  }

  // 获取所有配置
  async index(ctx) {
    // 检查管理员权限
    if (ctx.state.role !== 'admin') {
      ctx.status = 403
      ctx.error('需要管理员权限', 403)
      return
    }

    try {
      const settings = await this.Model.findAll({ raw: true })
      const result = this.parseSettings(settings)
      ctx.success(result)
    } catch (error) {
      ctx.error('获取系统配置失败', 500, { error: error.message })
    }
  }

  // 更新配置
  async update(ctx) {
    if (ctx.state.role !== 'admin') {
      ctx.status = 403
      ctx.error('需要管理员权限', 403)
      return
    }

    try {
      const updates = ctx.request.body
      const flatUpdates = this.flattenSettings(updates)

      for (const [key, value] of Object.entries(flatUpdates)) {
        await this.Model.upsert({
          setting_key: key,
          setting_value: String(value),
          updated_at: new Date(),
        })
      }

      // 返回更新后的配置
      const settings = await this.Model.findAll({ raw: true })
      ctx.success(this.parseSettings(settings))
    } catch (error) {
      ctx.error('更新系统配置失败', 500, { error: error.message })
    }
  }

  // 重置配置
  async reset(ctx) {
    if (ctx.state.role !== 'admin') {
      ctx.status = 403
      ctx.error('需要管理员权限', 403)
      return
    }

    try {
      const { keys, section, all } = ctx.request.body

      if (all) {
        // 重置所有配置
        for (const [key, value] of Object.entries(this.flattenSettings(DEFAULT_SETTINGS))) {
          await this.Model.upsert({
            setting_key: key,
            setting_value: String(value),
            updated_at: new Date(),
          })
        }
      } else if (section && DEFAULT_SETTINGS[section]) {
        // 重置指定分区
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS[section])) {
          await this.Model.upsert({
            setting_key: `${section}.${key}`,
            setting_value: String(value),
            updated_at: new Date(),
          })
        }
      } else if (keys && Array.isArray(keys)) {
        // 重置指定键
        for (const key of keys) {
          const defaultValue = this.getNestedValue(DEFAULT_SETTINGS, key)
          if (defaultValue !== undefined) {
            await this.Model.upsert({
              setting_key: key,
              setting_value: String(defaultValue),
              updated_at: new Date(),
            })
          }
        }
      }

      const settings = await this.Model.findAll({ raw: true })
      ctx.success(this.parseSettings(settings))
    } catch (error) {
      ctx.error('重置系统配置失败', 500, { error: error.message })
    }
  }

  // 辅助方法：解析扁平的数据库记录为嵌套对象
  parseSettings(records) {
    const result = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    for (const record of records) {
      const parts = record.setting_key.split('.')
      if (parts.length === 2) {
        const [section, key] = parts
        if (result[section]) {
          result[section][key] = this.parseValue(record.setting_value)
        }
      }
    }
    return result
  }

  // 辅助方法：将嵌套对象扁平化
  flattenSettings(obj, prefix = '') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'object' && value !== null) {
        Object.assign(result, this.flattenSettings(value, fullKey))
      } else {
        result[fullKey] = value
      }
    }
    return result
  }

  // 辅助方法：解析值类型
  parseValue(value) {
    if (value === 'true') return true
    if (value === 'false') return false
    if (!isNaN(Number(value))) return Number(value)
    return value
  }

  // 辅助方法：获取嵌套对象的值
  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj)
  }
}
```

---

## 5. 路由配置

在 [`server/routes/index.js`](server/routes/index.js) 添加：

```javascript
import { SystemSettingController } from '../controllers/system-setting.controller.js'

// 在路由设置中添加
router.get('/system-settings', authMiddleware, (ctx) => new SystemSettingController(db).index(ctx))
router.put('/system-settings', authMiddleware, (ctx) => new SystemSettingController(db).update(ctx))
router.post('/system-settings/reset', authMiddleware, (ctx) => new SystemSettingController(db).reset(ctx))
```

---

## 6. 实施步骤

### 阶段一：数据库和后端（需 Eric 确认）

1. [ ] 创建 `system_settings` 表迁移脚本
2. [ ] 执行迁移
3. [ ] 生成 Model
4. [ ] 创建 SystemSettingController
5. [ ] 添加路由

### 阶段二：前端

1. [ ] 创建 systemSettings store
2. [ ] 创建 SystemConfigTab 组件
3. [ ] 在 SettingsView 中集成新标签
4. [ ] 添加国际化文本

### 阶段三：集成

1. [ ] 修改 expert.controller.js 使用系统默认值
2. [ ] 修改 stream.controller.js 使用连接限制配置
3. [ ] 修改 auth.js 使用 Token 配置

---

## 7. 国际化文本

### 中文 (zh-CN)

```json
{
  "settings": {
    "systemConfig": "系统配置",
    "llmDefaults": "LLM 默认参数",
    "connectionLimits": "连接限制",
    "tokenConfig": "Token 配置",
    "paginationConfig": "分页配置",
    "contextThreshold": "上下文压缩阈值",
    "temperature": "表达温度",
    "reflectiveTemperature": "反思温度",
    "topP": "Top-p 采样",
    "frequencyPenalty": "频率惩罚",
    "presencePenalty": "存在惩罚",
    "maxTokens": "最大 Token",
    "maxConnectionsPerUser": "每用户最大连接数",
    "maxConnectionsPerExpert": "每 Expert 最大连接数",
    "accessTokenExpiry": "Access Token 过期时间",
    "refreshTokenExpiry": "Refresh Token 过期时间",
    "defaultPageSize": "默认分页大小",
    "maxPageSize": "最大分页大小",
    "resetAll": "重置全部",
    "saveChanges": "保存更改"
  }
}
```

### 英文 (en-US)

```json
{
  "settings": {
    "systemConfig": "System Config",
    "llmDefaults": "LLM Defaults",
    "connectionLimits": "Connection Limits",
    "tokenConfig": "Token Config",
    "paginationConfig": "Pagination Config",
    "contextThreshold": "Context Threshold",
    "temperature": "Temperature",
    "reflectiveTemperature": "Reflective Temperature",
    "topP": "Top-p Sampling",
    "frequencyPenalty": "Frequency Penalty",
    "presencePenalty": "Presence Penalty",
    "maxTokens": "Max Tokens",
    "maxConnectionsPerUser": "Max Connections per User",
    "maxConnectionsPerExpert": "Max Connections per Expert",
    "accessTokenExpiry": "Access Token Expiry",
    "refreshTokenExpiry": "Refresh Token Expiry",
    "defaultPageSize": "Default Page Size",
    "maxPageSize": "Max Page Size",
    "resetAll": "Reset All",
    "saveChanges": "Save Changes"
  }
}
```

---

**文档创建**: Maria  
**创建时间**: 2026-03-08 14:45 (Asia/Shanghai)
