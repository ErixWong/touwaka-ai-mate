# App Market 设计 - 小程序市场与安装机制

> **创建时间**: 2026-04-16
> **目标**: 设计 App 的打包格式、GitHub Registry、管理界面浏览安装机制

## 问题背景

当前 App 平台已完成基础架构：
- 数据库表（mini_apps, mini_app_rows 等）
- 后端 API（CRUD + 状态流转）
- 前端界面（AppsView, AppDetailView, GenericMiniApp）
- 时钟调度器 + 处理脚本

**缺失部分**：
1. App 如何打包分发？
2. 用户如何从 GitHub 仓库发现并安装 App？
3. App 的组织形式是什么？

---

## 1. App 组织形式

### 1.1 App 包结构

每个 App 是一个独立目录，包含：

```
apps/
├── contract-manager/           # App ID = contract-manager
│   ├── manifest.json           # App 元数据（必需）
│   ├── fields.json             # 字段定义（可选，也可在 manifest 中）
│   ├── states.json             # 状态定义（可选）
│   ├── handlers/               # 处理脚本目录
│   │   ├── ocr-service/
│   │   │   ├── index.js        # 脚本入口
│   │   │   └── package.json    # 脚本依赖（可选）
│   │   └── llm-extract/
│   │   │   ├── index.js
│   │   │   └── prompt.txt      # Prompt 模板
│   │   └── fapiao-extract/
│   │       └── index.js
│   ├── frontend/               # 前端组件（可选）
│   │   └── ContractManager.vue # 自定义组件（代替 GenericMiniApp）
│   ├── README.md               # App 说明文档
│   └── screenshots/            # 截图（用于市场展示）
│       ├── list-view.png
│       └── form-view.png
│
├── invoice-manager/            # 发票管理 App
│   ├── manifest.json
│   ├── handlers/
│   └── ...
│
└── quality-docs/               # 质量文档管理 App
    ├── manifest.json
    └── ...
```

### 1.2 manifest.json 格式

```json
{
  "id": "contract-manager",
  "name": "销售合同管理",
  "version": "1.0.0",
  "description": "上传合同文件，AI自动提取合同元数据，支持批量处理和确认入库",
  "icon": "📄",
  "type": "document",
  "author": "Touwaka Team",
  "license": "MIT",
  "repository": "https://github.com/touwaka/touwaka-mate-apps",
  "homepage": "https://docs.touwaka.ai/apps/contract-manager",
  "keywords": ["合同", "文档", "OCR", "AI提取"],
  
  "compatibility": {
    "min_platform_version": "2.0.0",
    "requires": {
      "mcp": ["markitdown", "mineru"],
      "skills": ["fapiao"]
    }
  },
  
  "fields": [
    { "name": "contract_number", "label": "合同编号", "type": "text", "required": true, "ai_extractable": true },
    { "name": "contract_date", "label": "签订日期", "type": "date", "required": true, "ai_extractable": true },
    { "name": "party_a", "label": "甲方", "type": "text", "required": true, "ai_extractable": true },
    { "name": "party_b", "label": "乙方", "type": "text", "required": true, "ai_extractable": true },
    { "name": "contract_amount", "label": "合同金额", "type": "number", "required": true, "ai_extractable": true },
    { "name": "status", "label": "状态", "type": "select", "options": ["待审批", "执行中", "已完成", "已终止"], "default": "待审批" },
    { "name": "contract_file", "label": "合同文件", "type": "file" }
  ],
  
  "views": {
    "list": {
      "columns": ["contract_number", "contract_date", "party_a", "party_b", "contract_amount", "status"],
      "sort": { "field": "contract_date", "order": "desc" }
    }
  },
  
  "config": {
    "features": ["upload", "list", "detail", "batch"],
    "supported_formats": [".pdf", ".docx", ".doc", ".jpg", ".png"],
    "max_file_size": 20971520,
    "batch_limit": 50
  },
  
  "states": [
    { "name": "pending_ocr", "label": "待OCR", "is_initial": true, "handler": "ocr-service", "success_next": "pending_extract", "failure_next": "ocr_failed" },
    { "name": "pending_extract", "label": "待提取", "handler": "llm-extract", "success_next": "pending_review", "failure_next": "extract_failed" },
    { "name": "pending_review", "label": "待确认", "is_terminal": false },
    { "name": "confirmed", "label": "已确认", "is_terminal": true },
    { "name": "ocr_failed", "label": "OCR失败", "is_error": true },
    { "name": "extract_failed", "label": "提取失败", "is_error": true }
  ],
  
  "component": null,  // null = 使用 GenericMiniApp，否则指定自定义组件名
  "visibility": "all"
}
```

### 1.3 处理脚本格式

每个处理脚本是一个 Node.js 模块：

```javascript
// handlers/ocr-service/index.js
export default {
  name: 'ocr-service',
  description: 'OCR识别脚本，调用markitdown/mineru',
  
  // 脚本配置
  config: {
    timeout: 60,        // 超时秒数
    maxRetries: 2,      // 最大重试次数
    concurrency: 3,     // 并发数
  },
  
  // 入口函数
  async process(context) {
    const { record, app, files, services } = context;
    
    // services 提供的能力
    const { callMcp, callLlm, callSkill, logger } = services;
    
    // 读取关联文件
    const file = files[0];
    if (!file) {
      return { success: false, error: 'No file attached' };
    }
    
    // 调用 MCP OCR 服务
    let ocrText;
    try {
      ocrText = await callMcp('markitdown', 'convert', { path: file.path });
    } catch (e) {
      // 回退到 mineru
      ocrText = await callMcp('mineru', 'parse', { path: file.path });
    }
    
    // 返回结果（会自动更新 record.data）
    return {
      success: true,
      data: {
        _ocr_text: ocrText,
        _ocr_service: 'markitdown',
        _ocr_status: 'completed'
      },
      nextStatus: 'pending_extract'  // 指定下一个状态
    };
  }
};
```

---

## 2. GitHub App Registry

### 2.1 Registry 仓库结构

在项目 GitHub 仓库中创建 `apps/` 目录作为 Registry：

```
touwaka-ai-mate/
├── apps/                       # App Registry 目录
│   ├── README.md               # Registry 说明
│   ├── index.json              # App 索引（元数据摘要）
│   │
│   ├── contract-manager/       # App 目录
│   │   ├── manifest.json
│   │   ├── handlers/
│   │   ├── frontend/
│   │   └── screenshots/
│   │
│   ├── invoice-manager/
│   │   └── ...
│   │
│   └── quality-docs/
│   │   └── ...
│   │
│   └── _templates/             # App 模板（用于创建新 App）
│       ├── document-app/       # 文档类 App 模板
│       └── workflow-app/       # 流程类 App 模板
│
├── server/
├── frontend/
└── ...
```

### 2.2 index.json 格式

```json
{
  "version": "1.0.0",
  "updated_at": "2026-04-16T00:00:00Z",
  "apps": [
    {
      "id": "contract-manager",
      "name": "销售合同管理",
      "version": "1.0.0",
      "icon": "📄",
      "type": "document",
      "description": "上传合同文件，AI自动提取合同元数据",
      "author": "Touwaka Team",
      "tags": ["合同", "文档", "OCR"],
      "path": "apps/contract-manager",
      "manifest_url": "apps/contract-manager/manifest.json",
      "screenshots": ["apps/contract-manager/screenshots/list-view.png"]
    },
    {
      "id": "invoice-manager",
      "name": "发票管理",
      "version": "1.0.0",
      "icon": "🧾",
      "type": "document",
      "description": "增值税发票OCR识别与结构化提取",
      "author": "Touwaka Team",
      "tags": ["发票", "财务", "OCR"],
      "path": "apps/invoice-manager"
    }
  ],
  "categories": [
    { "id": "document", "name": "文档管理", "icon": "📄" },
    { "id": "workflow", "name": "流程审批", "icon": "🔄" },
    { "id": "data", "name": "数据管理", "icon": "📊" },
    { "id": "utility", "name": "实用工具", "icon": "🔧" }
  ]
}
```

---

## 3. 管理界面设计

### 3.1 App Market 页面

新增 `AppMarketTab.vue` 组件，嵌入 SettingsView 的"系统管理"区域：

**位置**: `/system` → Tab "App 市场"

**功能**:
- 从 GitHub Registry 拉取 `index.json`，展示可用 App 列表
- 按 Category 分类显示
- 点击 App 卡片查看详情（字段、状态、截图）
- "安装"按钮一键部署

**界面草图**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  App 市场                                                                    │
│                                                                             │
│  分类筛选: [全部] [文档管理] [流程审批] [数据管理] [实用工具]                  │
│  搜索: [________________] [刷新]                                            │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 📄           │  │ 🧾           │  │ 📋           │  │ 📁           │    │
│  │ 销售合同管理  │  │ 发票管理     │  │ 报销审批     │  │ 质量文档     │    │
│  │              │  │              │  │              │  │              │    │
│  │ v1.0.0      │  │ v1.0.0      │  │ v0.9.0      │  │ v1.2.0      │    │
│  │ [已安装 ✓]   │  │ [安装]       │  │ [安装]       │  │ [安装]       │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 App 详情弹窗

点击 App 卡片弹出详情：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  销售合同管理                                                [关闭]         │
│                                                                             │
│  📄 v1.0.0 | 作者: Touwaka Team | License: MIT                              │
│                                                                             │
│  描述: 上传合同文件，AI自动提取合同元数据，支持批量处理和确认入库            │
│                                                                             │
│  截图:                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐                                  │
│  │ list-view.png   │  │ form-view.png   │                                  │
│  └─────────────────┘  └─────────────────┘                                  │
│                                                                             │
│  字段 (10):                                                                 │
│  • 合同编号 (text, required, AI提取)                                        │
│  • 签订日期 (date, required, AI提取)                                        │
│  • 甲方 (text, required, AI提取)                                            │
│  • ...                                                                      │
│                                                                             │
│  状态流转:                                                                  │
│  待OCR → 待提取 → 待确认 → 已确认                                           │
│                                                                             │
│  依赖:                                                                      │
│  • MCP: markitdown, mineru                                                  │
│  • Skills: 无                                                               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ [查看 README] [查看源码]                      [安装此 App]           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 安装流程

```
用户点击"安装"
    │
    ▼
前端调用 POST /api/app-market/install
    │
    ▼
后端执行安装流程：
    │
    ├── 1. 从 GitHub 拉取 manifest.json
    │
    ├── 2. 检查依赖是否满足
    │      • MCP 服务是否已配置
    │      • Skills 是否已安装
    │      • 平台版本是否兼容
    │      └── 不满足则返回错误提示
    │
    ├── 3. 插入 mini_apps 表
    │      INSERT INTO mini_apps (id, name, fields, views, config, ...)
    │
    ├── 4. 插入 app_state 表（状态定义）
    │      INSERT INTO app_state (app_id, name, label, handler_id, ...)
    │
    ├── 5. 复制处理脚本到 apps/{appId}/handlers/
    │      mkdir apps/{appId}/handlers/{handler-name}/
    │      cp handlers/* → apps/{appId}/handlers/
    │
    ├── 6. 插入 app_row_handlers 表
    │      INSERT INTO app_row_handlers (id, name, handler, ...)
    │
    ├── 7. 复制前端组件（如有）
    │      cp frontend/*.vue → frontend/src/components/apps/custom/
    │
    ├── 8. 返回安装结果
    │      { success: true, app_id: 'contract-manager' }
    │
    ▼
前端刷新 App 列表，显示"已安装 ✓"
```

---

## 4. 后端 API 设计

### 4.1 新增路由

```typescript
// server/routes/app-market.routes.js

// 获取 Registry 索引（从 GitHub 拉取）
GET /api/app-market/index
Response: {
  version: string,
  updated_at: string,
  apps: AppSummary[],
  categories: Category[]
}

// 获取 App 详情（从 GitHub 拉取 manifest）
GET /api/app-market/apps/:appId
Response: AppManifest

// 安装 App
POST /api/app-market/install
Request: { app_id: string, source: 'github', visibility?: string }
Response: { 
  success: boolean, 
  app_id: string,
  installed_handlers: string[],
  warnings?: string[]
}

// 卸载 App
DELETE /api/app-market/apps/:appId
Response: { success: boolean }

// 检查依赖
POST /api/app-market/check-dependencies
Request: { app_id: string }
Response: {
  satisfied: boolean,
  missing: {
    mcp: string[],
    skills: string[],
    platform_version: boolean
  }
}

// 更新 App（从 Registry 拉取最新版本）
PUT /api/app-market/apps/:appId/update
Response: { success: boolean, version: string }
```

### 4.2 服务层

```javascript
// server/services/app-market.service.js

class AppMarketService {
  constructor(db, config) {
    this.db = db;
    this.registryUrl = config.registryUrl || 
      'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps';
  }

  // 拉取 Registry 索引
  async fetchIndex() {
    const url = `${this.registryUrl}/index.json`;
    const response = await fetch(url);
    return response.json();
  }

  // 拉取 App Manifest
  async fetchManifest(appId) {
    const url = `${this.registryUrl}/${appId}/manifest.json`;
    const response = await fetch(url);
    return response.json();
  }

  // 拉取处理脚本
  async fetchHandler(appId, handlerName) {
    const url = `${this.registryUrl}/${appId}/handlers/${handlerName}/index.js`;
    const response = await fetch(url);
    return response.text();
  }

  // 检查依赖
  async checkDependencies(manifest) {
    const missing = { mcp: [], skills: [] };
    
    // 检查 MCP 服务
    if (manifest.compatibility?.requires?.mcp) {
      const configuredMcp = await this.getConfiguredMcpServices();
      for (const mcp of manifest.compatibility.requires.mcp) {
        if (!configuredMcp.includes(mcp)) {
          missing.mcp.push(mcp);
        }
      }
    }
    
    // 检查 Skills
    if (manifest.compatibility?.requires?.skills) {
      const installedSkills = await this.getInstalledSkills();
      for (const skill of manifest.compatibility.requires.skills) {
        if (!installedSkills.includes(skill)) {
          missing.skills.push(skill);
        }
      }
    }
    
    return {
      satisfied: missing.mcp.length === 0 && missing.skills.length === 0,
      missing
    };
  }

  // 安装 App
  async installApp(appId, options = {}) {
    const manifest = await this.fetchManifest(appId);
    
    // 检查依赖
    const deps = await this.checkDependencies(manifest);
    if (!deps.satisfied) {
      throw new Error(`Missing dependencies: MCP ${deps.missing.mcp.join(', ')}, Skills ${deps.missing.skills.join(', ')}`);
    }
    
    // 安装 App 元数据
    await this.installAppMetadata(manifest);
    
    // 安装状态定义
    await this.installStates(manifest);
    
    // 安装处理脚本
    const installedHandlers = await this.installHandlers(appId, manifest);
    
    return {
      success: true,
      app_id: appId,
      installed_handlers: installedHandlers
    };
  }

  // 安装处理脚本
  async installHandlers(appId, manifest) {
    const fs = require('fs').promises;
    const path = require('path');
    
    const installed = [];
    
    // App 专属 handlers 目录
    const appHandlersDir = path.join(process.cwd(), 'apps', appId, 'handlers');
    await fs.mkdir(appHandlersDir, { recursive: true });
    
    for (const state of manifest.states) {
      if (!state.handler) continue;
      
      const handlerDir = path.join(appHandlersDir, state.handler);
      await fs.mkdir(handlerDir, { recursive: true });
      
      const scriptContent = await this.fetchHandler(appId, state.handler);
      await fs.writeFile(path.join(handlerDir, 'index.js'), scriptContent);
      
      // 插入 handler 记录（路径指向 apps/{appId}/handlers/）
      await this.db.models.AppRowHandler.create({
        id: `${appId}-${state.handler}`,  // 唯一ID，含 appId 前缀
        name: state.handler,
        handler: `apps/${appId}/handlers/${state.handler}`,  // App 专属路径
        handler_function: 'process',
        concurrency: 3,
        timeout: 60,
        max_retries: 2,
        is_active: true
      });
      
      installed.push(state.handler);
    }
    
    return installed;
  }
}
```

---

## 5. 前端组件

### 5.1 AppMarketTab.vue

```vue
<template>
  <div class="app-market-tab">
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.appMarket.title') }}</h3>
      <button class="btn-refresh" @click="refreshIndex" :disabled="loading">
        {{ $t('common.refresh') }}
      </button>
    </div>

    <!-- 分类筛选 -->
    <div class="category-filter">
      <button
        v-for="cat in categories"
        :key="cat.id"
        :class="{ active: selectedCategory === cat.id }"
        @click="selectedCategory = cat.id"
      >
        {{ cat.icon }} {{ cat.name }}
      </button>
    </div>

    <!-- 搜索 -->
    <div class="search-box">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="$t('settings.appMarket.searchPlaceholder')"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- App 卡片网格 -->
    <div v-else class="app-grid">
      <div
        v-for="app in filteredApps"
        :key="app.id"
        class="app-card"
        @click="showAppDetail(app)"
      >
        <div class="app-icon">{{ app.icon }}</div>
        <div class="app-name">{{ app.name }}</div>
        <div class="app-version">v{{ app.version }}</div>
        <div class="app-desc">{{ app.description }}</div>
        <div class="app-tags">
          <span v-for="tag in app.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <button
          class="btn-install"
          :class="{ installed: isInstalled(app.id) }"
          @click.stop="installApp(app)"
          :disabled="isInstalled(app.id) || installing"
        >
          {{ isInstalled(app.id) ? $t('settings.appMarket.installed') : $t('settings.appMarket.install') }}
        </button>
      </div>
    </div>

    <!-- App 详情弹窗 -->
    <div v-if="showDetailDialog" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">{{ selectedApp?.name }}</h3>
        <div class="dialog-body">
          <!-- 截图 -->
          <div class="screenshots">
            <img v-for="ss in selectedApp?.screenshots" :key="ss" :src="ss" />
          </div>
          
          <!-- 字段列表 -->
          <div class="fields-section">
            <h4>{{ $t('settings.appMarket.fields') }}</h4>
            <ul>
              <li v-for="field in selectedAppManifest?.fields" :key="field.name">
                {{ field.label }} ({{ field.type }}
                <span v-if="field.required">*</span>
                <span v-if="field.ai_extractable">🤖</span>)
              </li>
            </ul>
          </div>
          
          <!-- 状态流转 -->
          <div class="states-section">
            <h4>{{ $t('settings.appMarket.states') }}</h4>
            <div class="state-flow">
              <span v-for="state in selectedAppManifest?.states" :key="state.name" class="state-node">
                {{ state.label }}
              </span>
            </div>
          </div>
          
          <!-- 依赖 -->
          <div class="deps-section">
            <h4>{{ $t('settings.appMarket.dependencies') }}</h4>
            <div v-if="depsCheck" class="deps-check">
              <span v-if="depsCheck.satisfied" class="satisfied">✓ 所有依赖已满足</span>
              <span v-else class="missing">
                缺失: MCP {{ depsCheck.missing.mcp.join(', ') }}
              </span>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDetailDialog">{{ $t('common.close') }}</button>
          <button class="btn-install" @click="installApp(selectedApp)" :disabled="isInstalled(selectedApp?.id)">
            {{ $t('settings.appMarket.install') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getAppMarketIndex, getAppManifest, installAppFromMarket, checkDependencies } from '@/api/app-market'
import { getApps } from '@/api/mini-apps'

const loading = ref(true)
const installing = ref(false)
const index = ref<any>(null)
const installedApps = ref<string[]>([])
const selectedCategory = ref('all')
const searchQuery = ref('')
const showDetailDialog = ref(false)
const selectedApp = ref<any>(null)
const selectedAppManifest = ref<any>(null)
const depsCheck = ref<any>(null)

const categories = computed(() => [
  { id: 'all', name: '全部', icon: '📦' },
  ...index.value?.categories || []
])

const filteredApps = computed(() => {
  let apps = index.value?.apps || []
  if (selectedCategory.value !== 'all') {
    apps = apps.filter(a => a.type === selectedCategory.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    apps = apps.filter(a => 
      a.name.toLowerCase().includes(q) || 
      a.description.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    )
  }
  return apps
})

function isInstalled(appId: string) {
  return installedApps.value.includes(appId)
}

async function refreshIndex() {
  loading.value = true
  try {
    index.value = await getAppMarketIndex()
    const apps = await getApps()
    installedApps.value = apps.map(a => a.id)
  } catch (e) {
    console.error('Failed to fetch index:', e)
  } finally {
    loading.value = false
  }
}

async function showAppDetail(app: any) {
  selectedApp.value = app
  showDetailDialog.value = true
  try {
    selectedAppManifest.value = await getAppManifest(app.id)
    depsCheck.value = await checkDependencies(app.id)
  } catch (e) {
    console.error('Failed to fetch manifest:', e)
  }
}

async function installApp(app: any) {
  installing.value = true
  try {
    await installAppFromMarket(app.id)
    installedApps.value.push(app.id)
    closeDetailDialog()
  } catch (e: any) {
    alert('安装失败: ' + e.message)
  } finally {
    installing.value = false
  }
}

function closeDetailDialog() {
  showDetailDialog.value = false
  selectedApp.value = null
  selectedAppManifest.value = null
}

onMounted(refreshIndex)
</script>
```

### 5.2 API 模块

```typescript
// frontend/src/api/app-market.ts

export interface AppMarketIndex {
  version: string
  updated_at: string
  apps: AppSummary[]
  categories: Category[]
}

export interface AppSummary {
  id: string
  name: string
  version: string
  icon: string
  type: string
  description: string
  author: string
  tags: string[]
  path: string
}

export interface Category {
  id: string
  name: string
  icon: string
}

export async function getAppMarketIndex(): Promise<AppMarketIndex> {
  return apiRequest(apiClient.get('/app-market/index'))
}

export async function getAppManifest(appId: string): Promise<any> {
  return apiRequest(apiClient.get(`/app-market/apps/${appId}`))
}

export async function installAppFromMarket(appId: string, visibility?: string): Promise<any> {
  return apiRequest(apiClient.post('/app-market/install', { app_id: appId, visibility }))
}

export async function checkDependencies(appId: string): Promise<any> {
  return apiRequest(apiClient.post('/app-market/check-dependencies', { app_id: appId }))
}

export async function uninstallApp(appId: string): Promise<void> {
  return apiRequest(apiClient.delete(`/app-market/apps/${appId}`))
}
```

---

## 6. 部署与配置

### 6.1 镜像部署方式（确认：方式 B）

采用**方式 B：镜像带空 apps/ 目录作为缓存位置**

```
Docker 镜像结构：
├── server/                # 后端代码
├── frontend/              # 前端代码
├── apps/                  # 【空目录，作为 Registry 缓存】
├── scripts/
├── data/
└── ...
```

**设计理由**：
- 首次启动时 `apps/` 为空，从 GitHub 实时拉取
- 支持离线环境（上次缓存的 Registry 索引可用）
- 比方式 A 更健壮（网络故障时有缓存兜底）
- 比方式 C 更灵活（不需要重新打包镜像就能更新 App）

### 6.2 Registry 配置（复用 system_settings 表）

**配置存储位置**：复用现有的 `system_settings` 表，命名空间为 `app_market.*`

```sql
-- 初始化 App Market 配置（在系统初始化或首次启动时插入）
INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
('app_market.registry_url', 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps', 'string', 'App Market Registry URL'),
('app_market.registry_branch', 'main', 'string', 'Registry 分支'),
('app_market.auto_check_updates', 'true', 'boolean', '是否自动检查更新'),
('app_market.check_interval_hours', '24', 'number', '自动检查间隔（小时）'),
('app_market.offline_mode', 'false', 'boolean', '离线模式（不从 Registry 拉取）'),
('app_market.cache_ttl_hours', '168', 'number', 'Registry 缓存有效期（小时，默认7天）'),
('app_market.last_check_at', '', 'string', '上次检查时间（ISO 8601格式）')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
```

**配置 API**（仅限管理员）：

```typescript
// GET /api/app-market/settings
Response: {
  registry_url: "https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps",
  registry_branch: "main",
  auto_check_updates: true,
  check_interval_hours: 24,
  offline_mode: false,
  cache_ttl_hours: 168,
  last_check_at: "2026-04-17T10:00:00Z"
}

// PUT /api/app-market/settings
Request: {
  registry_url?: string,
  registry_branch?: string,
  auto_check_updates?: boolean,
  offline_mode?: boolean
}
```

**为什么不新建表**：
- 复用现有 `system_settings` 表，保持系统统一
- 已有配置管理界面，无需重复开发
- 支持配置导入导出（系统已有功能）
- 减少表数量，简化维护

**为什么不放配置文件**：
- 配置文件在镜像内，用户修改需要重启
- 数据库存储支持运行时动态修改
- 支持多租户（不同组织不同 Registry）

### 6.3 本地缓存机制

```
apps/ 目录结构（运行时生成）：
├── .cache/                    # 内部缓存文件
│   ├── index.json            # 拉取的 Registry 索引（带时间戳）
│   └── last_sync             # 上次同步时间
│
├── contract-manager/         # 已下载的 App 包（仅元数据，不含代码）
│   └── manifest.json
│
└── invoice-manager/
    └── manifest.json
```

**缓存策略**：
- Registry 索引缓存 24 小时（可配置）
- App manifest 缓存 1 小时
- 手动刷新按钮可强制更新
- 离线模式直接使用缓存

### 6.4 开发模式

开发时可以使用本地 Registry：

```bash
# 1. 修改数据库配置（复用 system_settings 表）
node scripts/db-query.js "UPDATE system_settings SET setting_value='http://localhost:3000/mock-registry' WHERE setting_key='app_market.registry_url'"

# 2. 或使用本地文件系统（file:// 协议）
# 修改 registry_url 为 file:///path/to/project/apps
```

## 7. 安全考虑

### 7.1 脚本沙箱

处理脚本在 AppClock 中已实现安全限制：
- 只能加载 `scripts/` 或 `data/skills/` 目录下的脚本
- 使用 `claimRecord()` 原子认领避免竞态
- 超时、重试机制

### 7.2 依赖检查

安装前强制检查依赖，避免安装后无法运行。

### 7.3 权限控制

所有 Market API 仅限管理员：
- `GET /api/app-market/*` - 管理员
- `POST /api/app-market/install` - 管理员
- `DELETE /api/app-market/apps/:appId` - 管理员

---

## 8. 实施计划

| Step | 内容 | 预估 |
|------|------|------|
| 1 | 创建 apps/ 目录 + index.json | 1h |
| 2 | 迁移 contract-manager 到 apps/ 目录 | 1h |
| 3 | 后端 AppMarketService + routes | 3h |
| 4 | 前端 AppMarketTab.vue + API 模块 | 4h |
| 5 | SettingsView 添加"App 市场" Tab | 0.5h |
| 6 | 依赖检查逻辑 | 2h |
| 7 | 测试安装流程 | 2h |
| **合计** | | **~13.5h** |

---

## 9. 补充设计：完整功能规范

### 9.1 数据备份与导出

#### 备份场景

| 场景 | 备份内容 | 导出格式 |
|------|----------|----------|
| **迁移环境** | App 元数据 + 字段定义 + 数据行 + 文件 | JSON Bundle |
| **数据归档** | 历史数据行 | CSV / Excel |
| **合规审计** | 操作日志 + 变更历史 | JSON / PDF |

#### 导出 API

```typescript
// GET /api/mini-apps/:appId/export
// Query: format=bundle|csv|json&date_from=&date_to=&status=

// Response: 文件下载流
// 文件名: {app_id}_{date}.{zip|csv|json}
```

**导出格式 - Bundle（完整迁移）**:

```json
{
  "manifest": {
    "id": "contract-manager",
    "name": "销售合同管理",
    "version": "1.2.0",
    "export_date": "2026-04-17T10:00:00Z",
    "total_rows": 1523,
    "total_files": 1523
  },
  "app_definition": {
    "id": "contract-manager",
    "name": "销售合同管理",
    "fields": [...],
    "views": {...},
    "config": {...}
  },
  "state_definitions": [
    { "name": "pending_ocr", "label": "待OCR", ... }
  ],
  "handlers": [
    { "id": "handler-ocr", "name": "OCR识别", ... }
  ],
  "rows": [
    {
      "id": "row_001",
      "data": { "contract_number": "HT-2024-001", ... },
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "files": [
    {
      "record_id": "row_001",
      "field_name": "contract_file",
      "file_name": "contract.pdf",
      "file_size": 2048576,
      "file_content_base64": "..."
    }
  ]
}
```

**导出格式 - CSV（仅数据）**:

```csv
id,contract_number,contract_date,party_a,party_b,contract_amount,status,created_at
row_001,HT-2024-001,2024-03-15,甲方公司,乙方公司,100000,执行中,2024-03-15T10:00:00Z
```

#### 导入/恢复 API

```typescript
// POST /api/mini-apps/import
// Content-Type: multipart/form-data
// Body: file=@export-bundle.zip, options={...}

Request: {
  file: File,
  mode: 'restore' | 'merge',
  skip_files?: boolean
}

Response: {
  success: boolean,
  imported_rows: number,
  imported_files: number,
  skipped_rows: number,
  errors: string[]
}
```

### 9.2 App 版本更新机制

#### 版本检测

```typescript
// GET /api/app-market/check-updates
Response: {
  apps: [
    {
      "id": "contract-manager",
      "local_version": "1.0.0",
      "registry_version": "1.2.0",
      "has_update": true,
      "changelog": "新增付款计划字段；优化OCR识别",
      "breaking_changes": false
    }
  ]
}
```

#### 更新流程

1. 拉取新版 manifest.json
2. 检测变更类型（字段/脚本/配置）
3. 执行更新（备份→更新表→更新脚本→更新组件）
4. 数据迁移（新增字段为 null，删除字段保留但隐藏）
5. 返回更新结果

#### 后端更新服务

```javascript
class AppUpdateService {
  async checkUpdate(appId) {
    const localApp = await this.db.models.MiniApp.findByPk(appId);
    const manifest = await this.marketService.fetchManifest(appId);
    return {
      has_update: this.compareVersion(localApp.version, manifest.version) < 0,
      local_version: localApp.version,
      registry_version: manifest.version
    };
  }
}
```

### 9.3 本地 App 导出到 Registry

#### 导出命令

```bash
node scripts/export-app-to-registry.js contract-manager --output=./apps
```

#### 导出目录结构

```
./apps/contract-manager/
├── manifest.json
├── handlers/
│   ├── ocr-service/index.js
│   └── llm-extract/index.js
├── frontend/ContractManager.vue
├── screenshots/
└── README.md
```

### 9.4 完整 API 汇总

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/app-market/index` | GET | 获取 Registry 索引 | 管理员 |
| `/api/app-market/apps/:appId` | GET | 获取 App 详情 | 管理员 |
| `/api/app-market/install` | POST | 安装 App | 管理员 |
| `/api/app-market/apps/:appId` | DELETE | 卸载 App | 管理员 |
| `/api/app-market/check-dependencies` | POST | 检查依赖 | 管理员 |
| `/api/app-market/check-updates` | GET | 检查版本更新 | 管理员 |
| `/api/app-market/apps/:appId/update` | PUT | 更新 App | 管理员 |
| `/api/app-market/export-to-registry` | POST | 导出到 Registry 格式 | 管理员 |
| `/api/mini-apps/:appId/export` | GET | 导出数据 | 管理员 |
| `/api/mini-apps/import` | POST | 导入数据 | 管理员 |

### 9.5 数据表扩展

**决策变更**：App Market 功能**不新增任何数据库表**，完全复用现有表。

#### 复用的现有表

| 表名 | 用途 |
|------|------|
| `mini_apps` | App 注册、字段定义、视图配置 |
| `mini_app_rows` | 数据记录存储 |
| `mini_app_files` | 文件关联 |
| `app_state` | 状态定义 |
| `app_row_handlers` | 处理脚本定义 |
| `app_action_logs` | 脚本执行日志 |
| `system_settings` | Registry URL 等配置（`app_market.*` 命名空间） |

#### 不新增表的理由

1. **配置版本管理**：直接从 GitHub Registry 重新安装旧版本即可回滚
2. **数据备份**：通过导出/导入功能（CSV/JSON）实现，不依赖历史表
3. **简化架构**：减少维护成本，降低复杂性
4. **GitHub 即真相源**：所有 App 定义以 GitHub 上的 `apps/` 目录为准

---

**存储结构**：
```
apps/
├── index.json
├── contract-manager/
│   ├── manifest.json
│   ├── handlers/
│   └── frontend/                    ← 组件代码目录
│       ├── ContractManager.umd.js
│       └── ContractManager.css
│
└── invoice-manager/
    └── frontend/
        └── InvoiceManager.umd.js
```

**后端加载组件代码**：
```javascript
// server/services/app-component.service.js

class AppComponentService {
  constructor() {
    this.appsDir = path.join(process.cwd(), 'apps');
  }

  async loadComponent(appId, componentName) {
    const componentPath = path.join(
      this.appsDir, 
      appId, 
      'frontend', 
      `${componentName}.umd.js`
    );
    
    // 检查文件存在
    if (!await fs.exists(componentPath)) {
      throw new Error(`Component not found: ${componentPath}`);
    }
    
    // 读取代码
    const code = await fs.readFile(componentPath, 'utf-8');
    
    // 可选：读取 CSS
    const cssPath = componentPath.replace('.umd.js', '.css');
    const css = await fs.exists(cssPath) 
      ? await fs.readFile(cssPath, 'utf-8') 
      : null;
    
    return { code, css, source: 'filesystem' };
  }
  
  async getComponentInfo(appId) {
    const frontendDir = path.join(this.appsDir, appId, 'frontend');
    
    if (!await fs.exists(frontendDir)) {
      return null;  // 无自定义组件
    }
    
    const files = await fs.readdir(frontendDir);
    const jsFiles = files.filter(f => f.endsWith('.umd.js'));
    
    return jsFiles.map(f => ({
      name: f.replace('.umd.js', ''),
      path: path.join(frontendDir, f),
      size: (await fs.stat(path.join(frontendDir, f))).size
    }));
  }
}
```

**优点**：
- 直观可见，便于调试修改
- 备份简单（直接打包 `apps/` 目录）
- 无需数据库 blob 转换
- 开发时热重载方便

**API 保持不变**：
```typescript
// GET /api/app-market/component/:appId
// 返回 { code, css, version }，前端无需关心来源
```

#### system_settings 表（复用现有表，新增配置项）

使用现有的 `system_settings` 表存储 App Market 配置，避免重复建表：

```sql
-- 初始化 App Market 配置（在系统初始化脚本中添加）
INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
('app_market.registry_url', 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps', 'string', 'App Market Registry URL'),
('app_market.registry_branch', 'main', 'string', 'Registry 分支'),
('app_market.auto_check_updates', 'true', 'boolean', '是否自动检查更新'),
('app_market.check_interval_hours', '24', 'number', '自动检查间隔（小时）'),
('app_market.offline_mode', 'false', 'boolean', '离线模式（不从 Registry 拉取）'),
('app_market.cache_ttl_hours', '168', 'number', 'Registry 缓存有效期（小时）'),
('app_market.last_check_at', '', 'string', '上次检查时间（ISO 8601）');
```

**配置读取/写入**：

```javascript
// server/services/app-market.service.js

class AppMarketService {
  async getRegistryConfig() {
    const settings = await this.db.models.SystemSetting.findAll({
      where: { setting_key: { [Op.like]: 'app_market.%' } }
    });
    
    const config = {};
    for (const s of settings) {
      const key = s.setting_key.replace('app_market.', '');
      config[key] = this.parseValue(s.setting_value, s.value_type);
    }
    
    return {
      registry_url: config.registry_url || 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps',
      registry_branch: config.registry_branch || 'main',
      auto_check_updates: config.auto_check_updates !== 'false',
      check_interval_hours: parseInt(config.check_interval_hours) || 24,
      offline_mode: config.offline_mode === 'true',
      cache_ttl_hours: parseInt(config.cache_ttl_hours) || 168,
      last_check_at: config.last_check_at || null
    };
  }
  
  async updateRegistryConfig(updates) {
    for (const [key, value] of Object.entries(updates)) {
      await this.db.models.SystemSetting.update(
        { setting_value: String(value) },
        { where: { setting_key: `app_market.${key}` } }
      );
    }
  }
  
  parseValue(value, type) {
    switch (type) {
      case 'boolean': return value === 'true';
      case 'number': return parseFloat(value);
      default: return value;
    }
  }
}
```

**为什么复用 system_settings**：
- 现有系统已经使用此表存储配置
- 统一的配置管理界面（SettingsView 已支持）
- 避免表数量膨胀
- 支持配置导入导出（已有功能）

---

## 10. 实施计划（最终版）

**设计原则确认**：
- ✅ 零新增数据库表（完全复用现有表）
- ✅ 组件代码存文件系统（`apps/{appId}/frontend/`）
- ✅ Registry 配置存 `system_settings` 表（`app_market.*` 命名空间）
- ✅ 镜像带空 `apps/` 目录作为缓存

| Step | 内容 | 预估 | 优先级 | 说明 |
|------|------|------|--------|------|
| 1 | 创建 `apps/` 目录结构 + `index.json` | 1h | P0 | Registry 索引文件 |
| 2 | 迁移 contract-manager 到 `apps/` 目录 | 1h | P0 | 作为示例 App |
| 3 | 后端 `AppMarketService` + 基础 routes | 3h | P0 | 安装、卸载、检查依赖 |
| 4 | 前端 `AppMarketTab.vue` + API 模块 | 4h | P0 | 市场浏览界面 |
| 5 | `SettingsView` 添加"App 市场" Tab | 0.5h | P0 | 集成到系统管理 |
| 6 | 依赖检查逻辑 | 2h | P0 | MCP/Skills/平台版本检查 |
| 7 | 数据导出功能（bundle/csv/json） | 3h | P1 | 数据备份 |
| 8 | 数据导入功能 | 2h | P1 | 数据恢复 |
| 9 | 版本检测与更新 | 3h | P1 | 对比 GitHub 版本 |
| 10 | 本地 App 导出到 Registry | 2h | P2 | 开发工具 |
| 11 | CLI 工具脚本 | 2h | P2 | `app-market-cli.js` |
| 12 | 自定义组件动态加载 | 3h | P1 | 文件系统方案 |
| 13 | 测试完整流程 | 2h | P0 | 安装/导出/导入/更新 |
| **合计** | | **~26.5h** | | |

**关键决策汇总**：
1. **部署方式**：镜像带空 `apps/` 目录（方式 B）
2. **Registry 配置**：`system_settings` 表，`app_market.registry_url`
3. **组件存储**：`apps/{appId}/frontend/` 文件系统
4. **数据表**：零新增，完全复用现有表
5. **仓库地址**：`https://github.com/ErixWong/touwaka-ai-mate`

---

## 附录：管理员操作流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        App Market 管理员操作流程                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 浏览市场                                                                 │
│     Settings → 系统管理 → App 市场                                            │
│     └── 查看分类列表、搜索、查看详情                                          │
│                                                                             │
│  2. 安装 App                                                                │
│     点击"安装" → 检查依赖 → 自动部署                                         │
│     └── 安装成功：显示在 Apps 导航菜单                                        │
│                                                                             │
│  3. 配置 App                                                                │
│     Apps → 选择 App → 设置                                                    │
│     └── 修改字段、调整状态流转、配置权限                                      │
│                                                                             │
│  4. 备份数据（数据行）                                                        │
│     Apps → 选择 App → 更多 → 导出数据                                         │
│     └── 选择格式（CSV/JSON）→ 下载文件                                       │
│                                                                             │
│  5. 更新 App                                                                │
│     App 市场 → 检测更新 → 查看变更 → 一键更新                                 │
│     └── 从 GitHub 拉取新版本 → 更新本地配置和脚本                              │
│                                                                             │
│  6. 回滚 App（重新安装旧版本）                                                 │
│     App 市场 → 选择 App → 版本历史 → 安装指定版本                              │
│     └── 从 GitHub 拉取历史版本重新安装                                          │
│                                                                             │
│  7. 删除/卸载                                                               │
│     Apps → 选择 App → 更多 → 卸载                                             │
│     └── 选择：仅卸载保留数据 / 完全删除（含数据）                              │
│                                                                             │
│  8. 恢复数据（数据行）                                                        │
│     Apps → 导入数据 → 上传备份文件 → 选择模式（恢复/合并）                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键说明**：
- **配置回滚**：直接从 GitHub 重新安装历史版本（无需本地备份表）
- **数据备份/恢复**：通过导出/导入功能实现（CSV/JSON 文件）

---

## 11. 自定义组件动态加载架构

### 11.1 问题背景

App 平台支持两种前端渲染方式：
- **通用组件** (`GenericMiniApp.vue`)：自动根据 `fields` 渲染表单/列表，90% 场景够用
- **自定义组件**：如发票明细表格、流程可视化等复杂交互

**核心问题**：用户安装新 App 后，如何加载其自定义组件？是否需要重新编译前端 `dist/`？

### 11.2 方案对比

| 方案 | 实现方式 | 是否需要重编 | 是否需要重启 | 生产可用性 |
|------|----------|--------------|--------------|-----------|
| **A: 预编译组件** | 组件编译为 UMD，数据库存储，Blob URL 动态加载 | ❌ 不需要 | ❌ 不需要 | ✅ 推荐 |
| **B: 源码组件** | `.vue` 文件复制到 `src/`，重新运行 `npm run build` | ✅ 需要 | ✅ 需要 | ❌ 不可接受 |
| **C: 在线渲染** | 后端渲染 HTML，前端 iframe 嵌入 | ❌ 不需要 | ❌ 不需要 | ⚠️ 体验差 |

**结论**：采用 **方案 A（预编译组件）**，组件与主应用解耦，运行时动态加载。

### 11.3 架构设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        自定义组件动态加载架构                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  开发阶段                                                                │
│  ─────────                                                               │
│  apps/contract-manager/frontend/                                         │
│  ├── ContractManager.vue          # 自定义组件源码                       │
│  ├── vite.config.ts               # Lib 模式配置                         │
│  └── package.json                 # 依赖 Vue（不依赖主项目）              │
│       ↓                                                                  │
│  npm run build:lib                                                       │
│       ↓                                                                  │
│  ContractManager.umd.js           # 预编译产物（UMD 格式）                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Registry 存储                                                            │
│  ───────────                                                             │
│  apps/contract-manager/                                                  │
│  ├── manifest.json                                                       │
│  ├── handlers/                                                           │
│  └── frontend/                                                           │
│      └── ContractManager.umd.js     # 提交到 GitHub                        │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  安装阶段                                                                │
│  ─────────                                                               │
│  用户点击"安装"                                                           │
│       ↓                                                                  │
│  后端:                                                                   │
│  ├── 1. 拉取 manifest.json                                               │
│  ├── 2. 插入 mini_apps 表（component='ContractManager'）                │
│  ├── 3. 复制 handlers/ 到 apps/{appId}/handlers/                        │
│  └── 4. 复制 frontend/*.umd.js 到 apps/{appId}/frontend/               │
│       ↓                                                                  │
│  ✅ 安装完成，无需重启，无需重编                                          │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  运行阶段                                                                │
│  ─────────                                                               │
│  用户访问 /apps/contract-manager                                         │
│       ↓                                                                  │
│  前端 GenericMiniApp.vue:                                                │
│  ├── 1. 获取 App 元数据（component='ContractManager'）                   │
│  ├── 2. 检查本地组件注册表（无）                                         │
│  ├── 3. 调用 loadRemoteComponent('contract-manager')                     │
│  │       ↓                                                              │
│  │   GET /api/app-market/component/contract-manager                     │
│  │       ↓                                                              │
│  │   后端读取 apps/contract-manager/frontend/*.umd.js 文件返回 code      │
│  │       ↓                                                              │
│  ├── 4. 创建 Blob URL：`blob:http://...`                               │
│  ├── 5. 动态导入：`import(/* @vite-ignore */ blobUrl)`                 │
│  └── 6. 渲染 `<component :is="RemoteComponent" />`                     │
│       ↓                                                                  │
│  ✅ 组件渲染成功，与主应用完全解耦                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.4 组件开发规范

#### 11.4.1 组件打包配置

```typescript
// apps/contract-manager/frontend/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: './ContractManager.vue',
      name: 'ContractManager',
      fileName: 'ContractManager',
      formats: ['umd']  // UMD 格式兼容浏览器直接加载
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue'
        }
      }
    }
  }
})
```

#### 11.4.2 组件接口规范

```vue
<!-- apps/contract-manager/frontend/ContractManager.vue -->
<template>
  <div class="contract-manager">
    <!-- 必须支持的标准 Props -->
    <AppToolbar :app="app" :record="record" @save="handleSave" />
    
    <!-- 自定义布局 -->
    <div class="custom-layout">
      <RepeatingTable 
        v-if="app.fields.find(f => f.type === 'repeating')"
        :field="repeatingField" 
        :data="record.data[repeatingField.name]"
        @update="updateField"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 自定义组件接口规范
 * 
 * Props（必须实现）：
 * - app: MiniApp - App 元数据（含 fields, views, config）
 * - record: AppRecord - 当前数据行
 * 
 * Emits（可选）：
 * - save: 保存数据
 * - status-change: 状态变更请求
 * - action: 自定义操作
 */
interface Props {
  app: {
    id: string
    name: string
    fields: FieldDefinition[]
    views: ViewConfig
    config: AppConfig
  }
  record: {
    id: string
    data: Record<string, any>
    _status: string
  }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  save: [data: Record<string, any>]
  'status-change': [from: string, to: string]
  action: [name: string, payload: any]
}>()

// 通过 inject 获取沙箱服务
const { callMcp, callLlm, logger } = inject('appServices')

// 组件逻辑...
</script>
```

### 11.5 后端实现（文件系统方案）

#### 11.5.1 组件存储位置

**单机部署方案**：组件代码和处理脚本都存储在 `apps/{appId}/` 目录下

```
apps/
├── index.json
├── contract-manager/
│   ├── manifest.json              ← App 元数据
│   ├── handlers/                  ← 处理脚本
│   │   ├── ocr-service/
│   │   │   └── index.js
│   │   └── llm-extract/
│   │       └── index.js
│   └── frontend/                  ← 自定义组件
│       ├── ContractManager.umd.js
│       └── ContractManager.css
│
└── invoice-manager/
    ├── manifest.json
    ├── handlers/
    └── frontend/
        └── InvoiceManager.umd.js
```
apps/
├── index.json
├── contract-manager/
│   ├── manifest.json
│   ├── handlers/
│   └── frontend/                    ← 组件代码目录
│       ├── ContractManager.umd.js
│       └── ContractManager.css
│
└── invoice-manager/
    └── frontend/
        └── InvoiceManager.umd.js
```

**安装流程**（Registry → 本地）：
```
GitHub Registry (raw.githubusercontent.com)
    │
    ▼
GET /ErixWong/touwaka-ai-mate/main/apps/contract-manager/frontend/ContractManager.umd.js
    │
    ▼
保存到本地 apps/contract-manager/frontend/
    │
    ▼
前端通过 /api/app-market/component/:appId 读取本地文件
```

#### 11.5.2 组件加载 API

```javascript
// server/services/app-component.service.js

const fs = require('fs').promises;
const path = require('path');

class AppComponentService {
  constructor() {
    this.appsDir = path.join(process.cwd(), 'apps');
  }

  /**
   * 加载组件代码
   * @param {string} appId - App ID
   * @param {string} componentName - 组件名（如 ContractManager）
   * @returns {Promise<{code: string, css: string|null, version: string}>}
   */
  async loadComponent(appId, componentName) {
    const componentPath = path.join(
      this.appsDir, 
      appId, 
      'frontend', 
      `${componentName}.umd.js`
    );
    
    // 检查文件存在
    try {
      await fs.access(componentPath);
    } catch {
      throw new Error(`Component not found: ${componentPath}`);
    }
    
    // 读取 JS 代码
    const code = await fs.readFile(componentPath, 'utf-8');
    
    // 读取 CSS（可选）
    const cssPath = componentPath.replace('.umd.js', '.css');
    let css = null;
    try {
      css = await fs.readFile(cssPath, 'utf-8');
    } catch {
      // CSS 不存在，忽略
    }
    
    // 获取文件修改时间作为版本标识
    const stat = await fs.stat(componentPath);
    const version = stat.mtime.toISOString();
    
    return { code, css, version };
  }
  
  /**
   * 获取组件信息（用于调试）
   */
  async getComponentInfo(appId) {
    const frontendDir = path.join(this.appsDir, appId, 'frontend');
    
    try {
      const files = await fs.readdir(frontendDir);
      const jsFiles = files.filter(f => f.endsWith('.umd.js'));
      
      return Promise.all(jsFiles.map(async f => {
        const stat = await fs.stat(path.join(frontendDir, f));
        return {
          name: f.replace('.umd.js', ''),
          path: path.join(frontendDir, f),
          size: stat.size,
          modified: stat.mtime
        };
      }));
    } catch {
      return [];  // 目录不存在，返回空数组
    }
  }
}

module.exports = AppComponentService;
```

```javascript
// server/routes/app-market.routes.js

/**
 * 获取 App 自定义组件代码
 * GET /api/app-market/component/:appId
 */
app.get('/api/app-market/component/:appId', requireAuth, async (req, res) => {
  const { appId } = req.params;
  
  // 1. 验证 App 存在且已启用
  const app = await db.models.MiniApp.findByPk(appId);
  if (!app || !app.is_active) {
    return res.status(404).json({ error: 'App not found or inactive' });
  }
  
  // 2. 无自定义组件
  if (!app.component) {
    return res.status(204).send();  // No Content
  }
  
  // 3. 从文件系统加载组件
  try {
    const componentService = new AppComponentService();
    const { code, css, version } = await componentService.loadComponent(
      appId, 
      app.component
    );
    
    // 4. 返回组件代码（支持 ETag 缓存）
    const etag = `"${version}"`;
    
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).send();  // Not Modified
    }
    
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      name: app.component,
      code,
      css,
      version
    });
    
  } catch (error) {
    console.error(`Failed to load component for app ${appId}:`, error);
    return res.status(404).json({ 
      error: `Component ${app.component} not found: ${error.message}` 
    });
  }
});
```

#### 11.5.3 安装时组件下载

```javascript
// server/services/app-market.service.js

const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

class AppMarketService {
  constructor(db, config) {
    this.db = db;
    this.appsDir = path.join(process.cwd(), 'apps');
    this.registryUrl = config.registryUrl || 
      'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps';
  }

  async installApp(appId, options = {}) {
    const manifest = await this.fetchManifest(appId);
    
    // ... 之前的安装逻辑（插入数据库、复制 handlers）...
    
    // 安装自定义组件（如有）
    if (manifest.component) {
      await this.installComponent(appId, manifest);
    }
    
    return { success: true, app_id: appId };
  }
  
  /**
   * 从 Registry 下载组件到本地 apps/ 目录
   */
  async installComponent(appId, manifest) {
    const componentName = manifest.component;
    const frontendDir = path.join(this.appsDir, appId, 'frontend');
    
    // 1. 创建目录
    await fs.mkdir(frontendDir, { recursive: true });
    
    // 2. 下载组件 JS
    const jsUrl = `${this.registryUrl}/${appId}/frontend/${componentName}.umd.js`;
    const jsResponse = await fetch(jsUrl);
    
    if (!jsResponse.ok) {
      throw new Error(`Failed to fetch component JS: ${jsUrl}`);
    }
    
    const jsCode = await jsResponse.text();
    await fs.writeFile(
      path.join(frontendDir, `${componentName}.umd.js`),
      jsCode,
      'utf-8'
    );
    
    // 3. 下载组件 CSS（可选）
    const cssUrl = `${this.registryUrl}/${appId}/frontend/${componentName}.css`;
    try {
      const cssResponse = await fetch(cssUrl);
      if (cssResponse.ok) {
        const cssCode = await cssResponse.text();
        await fs.writeFile(
          path.join(frontendDir, `${componentName}.css`),
          cssCode,
          'utf-8'
        );
      }
    } catch {
      // CSS 不存在，忽略
    }
    
    logger.info(`Installed component ${componentName} for app ${appId}`);
  }
  
  /**
   * 卸载时删除组件文件
   */
  async uninstallApp(appId) {
    const { Op } = require('sequelize');
    
    // 1. 删除数据库记录
    await this.db.models.MiniApp.destroy({ where: { id: appId } });
    await this.db.models.AppState.destroy({ where: { app_id: appId } });
    await this.db.models.AppRowHandler.destroy({ 
      where: { 
        handler: { [Op.like]: `apps/${appId}/handlers/%` }  // 删除该 App 的所有 handlers
      } 
    });
    // 注意：mini_app_rows 数据可选保留或删除（根据用户选择）
    
    // 2. 删除本地文件（apps/{appId}/ 目录）
    const appDir = path.join(this.appsDir, appId);
    try {
      await fs.rm(appDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`Failed to remove app directory ${appDir}:`, error);
      // 继续执行，不阻塞卸载
    }
    
    return { success: true };
  }
}

module.exports = AppMarketService;
```

### 11.6 前端实现

#### 11.6.1 组件加载服务

```typescript
// frontend/src/services/app-component-loader.ts

import { defineAsyncComponent, shallowRef, inject } from 'vue'
import type { Component } from 'vue'

// 本地组件注册表（内置组件）
const localComponents: Record<string, () => Promise<Component>> = {
  // 开发时内置的复杂组件
  'InvoiceManager': () => import('@/components/apps/custom/InvoiceManager.vue'),
  'WorkflowVisualizer': () => import('@/components/apps/custom/WorkflowVisualizer.vue'),
}

// 远程组件缓存
const remoteComponentCache = new Map<string, Component>()

/**
 * 加载 App 自定义组件
 * 
 * 优先级：
 * 1. null → 返回 null，使用 GenericMiniApp
 * 2. 本地注册表 → 标准动态 import
 * 3. 远程加载 → Blob URL + @vite-ignore
 */
export async function loadAppComponent(
  appId: string, 
  componentName: string | null
): Promise<Component | null> {
  
  // 1. 无自定义组件
  if (!componentName) {
    return null
  }
  
  // 2. 检查本地组件
  if (localComponents[componentName]) {
    return defineAsyncComponent(localComponents[componentName])
  }
  
  // 3. 检查远程缓存
  const cacheKey = `${appId}:${componentName}`
  if (remoteComponentCache.has(cacheKey)) {
    return remoteComponentCache.get(cacheKey)!
  }
  
  // 4. 远程加载
  try {
    const component = await loadRemoteComponent(appId, componentName)
    remoteComponentCache.set(cacheKey, component)
    return component
  } catch (error) {
    console.error(`Failed to load remote component ${componentName}:`, error)
    throw new AppComponentLoadError(`组件 ${componentName} 加载失败`, { cause: error })
  }
}

/**
 * 远程组件加载核心逻辑
 */
async function loadRemoteComponent(
  appId: string, 
  componentName: string
): Promise<Component> {
  
  // 1. 获取组件代码
  const response = await fetch(`/api/app-market/component/${appId}`, {
    headers: {
      'Accept': 'application/json'
    }
  })
  
  if (response.status === 204) {
    throw new Error('App has no custom component')
  }
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  
  const { code, css, version } = await response.json()
  
  // 2. 注入 CSS（如果有）
  if (css) {
    const styleId = `app-component-${appId}-${componentName}-${version}`
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = css
      document.head.appendChild(style)
    }
  }
  
  // 3. 创建 Blob URL（关键：绕过 Vite 编译）
  const blob = new Blob([code], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  
  try {
    // 4. 动态导入（使用 @vite-ignore 跳过 Vite 处理）
    const module = await import(/* @vite-ignore */ url)
    
    // 5. 创建沙箱包装组件
    return createSandboxedComponent(module.default, appId)
  } finally {
    // 6. 清理 Blob URL
    URL.revokeObjectURL(url)
  }
}

/**
 * 创建沙箱包装组件
 * 限制组件可访问的服务，防止恶意代码
 */
function createSandboxedComponent(
  rawComponent: Component, 
  appId: string
): Component {
  return {
    name: `Sandboxed_${rawComponent.name || 'Unknown'}`,
    setup(props: any, context: any) {
      // 注入受限服务
      const sandboxServices = {
        // ✅ 允许的：App 相关服务
        callMcp: createScopedMcpCaller(appId),
        callLlm: createScopedLlmCaller(appId),
        logger: createScopedLogger(appId),
        
        // ❌ 禁止的：全局服务
        // router: undefined,  // 不注入
        // store: undefined,   // 不注入
        // apiClient: undefined  // 不注入
      }
      
      // 使用 Vue provide 向子组件传递
      provide('appServices', sandboxServices)
      
      // 调用原始组件的 setup
      return rawComponent.setup?.(props, context)
    },
    render: rawComponent.render,
    template: rawComponent.template
  }
}

// 清理缓存（App 卸载/更新时调用）
export function clearComponentCache(appId?: string) {
  if (appId) {
    // 清理特定 App 的缓存
    for (const key of remoteComponentCache.keys()) {
      if (key.startsWith(`${appId}:`)) {
        remoteComponentCache.delete(key)
      }
    }
  } else {
    // 清理所有缓存
    remoteComponentCache.clear()
  }
}

// 错误类
class AppComponentLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppComponentLoadError'
  }
}
```

#### 11.6.2 GenericMiniApp 集成

```vue
<!-- frontend/src/components/apps/GenericMiniApp.vue -->
<template>
  <div class="mini-app-container">
    <AppToolbar 
      :app="app" 
      :record="currentRecord"
      @save="handleSave"
    />
    
    <!-- 加载状态 -->
    <div v-if="loadingComponent" class="loading-state">
      <LoadingSpinner />
      <span>加载自定义组件...</span>
    </div>
    
    <!-- 错误状态 -->
    <div v-else-if="componentError" class="error-state">
      <AlertTriangle />
      <span>组件加载失败: {{ componentError.message }}</span>
      <button @click="retryLoadComponent">重试</button>
      <button @click="useFallback">使用通用视图</button>
    </div>
    
    <!-- 自定义组件 -->
    <component 
      v-else-if="AppComponent"
      :is="AppComponent"
      :app="app"
      :record="currentRecord"
      @save="handleSave"
      @status-change="handleStatusChange"
      @action="handleCustomAction"
    />
    
    <!-- 通用渲染（无自定义组件或加载失败回退） -->
    <GenericFormRenderer
      v-else
      :app="app"
      :record="currentRecord"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, provide } from 'vue'
import { loadAppComponent, clearComponentCache } from '@/services/app-component-loader'
import AppToolbar from './AppToolbar.vue'
import GenericFormRenderer from './GenericFormRenderer.vue'

const props = defineProps<{
  appId: string
}>()

const app = ref<MiniApp | null>(null)
const currentRecord = ref<AppRecord | null>(null)
const AppComponent = shallowRef<any>(null)
const loadingComponent = ref(false)
const componentError = ref<Error | null>(null)

onMounted(async () => {
  // 1. 获取 App 元数据
  app.value = await fetchApp(props.appId)
  
  // 2. 加载自定义组件（如有）
  if (app.value?.component) {
    await loadCustomComponent()
  }
  
  // 3. 获取当前记录数据
  currentRecord.value = await fetchRecord(props.appId)
})

async function loadCustomComponent() {
  if (!app.value?.component) return
  
  loadingComponent.value = true
  componentError.value = null
  
  try {
    const component = await loadAppComponent(app.value.id, app.value.component)
    AppComponent.value = component
  } catch (error) {
    componentError.value = error as Error
    console.error('Failed to load custom component:', error)
  } finally {
    loadingComponent.value = false
  }
}

function retryLoadComponent() {
  clearComponentCache(props.appId)
  loadCustomComponent()
}

function useFallback() {
  AppComponent.value = null
  componentError.value = null
}

// 标准事件处理
async function handleSave(data: Record<string, any>) {
  await saveRecord(props.appId, currentRecord.value!.id, data)
  // 刷新数据
  currentRecord.value = await fetchRecord(props.appId, currentRecord.value!.id)
}

function handleStatusChange(from: string, to: string) {
  // 触发状态流转
}

function handleCustomAction(name: string, payload: any) {
  // 处理自定义组件发出的特殊事件
}
</script>
```

### 11.7 性能优化

#### 11.7.1 缓存策略

```typescript
// 1. HTTP 缓存（后端）
// ETag + 304 Not Modified，减少传输

// 2. 内存缓存（前端）
const remoteComponentCache = new Map<string, Component>()

// 3. LocalStorage 持久化（可选）
const STORAGE_KEY = 'app_components_cache'

export function persistComponentToStorage(appId: string, component: CachedComponent) {
  const cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  cache[appId] = {
    code: component.code,
    version: component.version,
    cachedAt: Date.now()
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
}

export function loadComponentFromStorage(appId: string): CachedComponent | null {
  const cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  const cached = cache[appId]
  
  // 缓存 7 天
  if (cached && Date.now() - cached.cachedAt < 7 * 24 * 60 * 60 * 1000) {
    return cached
  }
  
  return null
}
```

#### 11.7.2 懒加载

```vue
<!-- 只在需要时加载组件 -->
<script setup>
import { defineAsyncComponent } from 'vue'

// 路由级懒加载
const AppDetailView = defineAsyncComponent(() => 
  import('@/views/AppDetailView.vue')
)

// 组件级懒加载
const loadComponent = async (appId: string) => {
  // 用户点击时才加载
  const component = await loadAppComponent(appId, 'ContractManager')
  return component
}
</script>
```

### 11.8 安全考虑

| 风险 | 防护措施 |
|------|----------|
| **XSS 攻击** | 组件代码从可信 Registry 获取，HTTPS 传输 |
| **恶意代码** | 沙箱限制：禁止访问 router/store/apiClient |
| **资源泄露** | Blob URL 使用后立即 revoke |
| **缓存投毒** | ETag 验证，版本号校验 |

```typescript
// 沙箱服务创建器
function createScopedMcpCaller(appId: string) {
  return async (service: string, method: string, params: any) => {
    // 只允许调用白名单内的 MCP 服务
    if (!ALLOWED_MCP_SERVICES.includes(service)) {
      throw new Error(`MCP service ${service} not allowed for app ${appId}`)
    }
    
    // 通过主应用的代理调用，附加 appId 上下文
    return await window.__MCP_PROXY__.call(service, method, {
      ...params,
      _app_id: appId  // 用于审计日志
    })
  }
}

// 白名单
const ALLOWED_MCP_SERVICES = ['markitdown', 'mineru']
```

### 11.9 自定义组件实施步骤

在主实施计划（第10章）中已包含自定义组件相关任务：
- Step 12: 自定义组件动态加载（3h，P1）

无需额外步骤，文件系统方案不新增数据库表。

---

*让我们一起愉快地写代码吧！💪✨*