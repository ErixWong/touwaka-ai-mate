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
touwaka-mate-v2-p0/
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
    ├── 5. 复制处理脚本到 scripts/app-handlers/
    │      mkdir scripts/app-handlers/{handler-id}
    │      cp handlers/* → scripts/app-handlers/
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
      'https://raw.githubusercontent.com/touwaka/touwaka-mate-v2-p0/main/apps';
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
    
    for (const state of manifest.states) {
      if (!state.handler) continue;
      
      const handlerDir = path.join(process.cwd(), 'scripts', 'app-handlers', state.handler);
      await fs.mkdir(handlerDir, { recursive: true });
      
      const scriptContent = await this.fetchHandler(appId, state.handler);
      await fs.writeFile(path.join(handlerDir, 'index.js'), scriptContent);
      
      // 插入 handler 记录
      await this.db.models.AppRowHandler.create({
        id: `handler-${state.handler}`,
        name: state.handler,
        handler: `scripts/app-handlers/${state.handler}`,
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

## 6. 配置选项

### 6.1 Registry URL 配置

在 `kilo.json` 或环境变量中配置：

```json
{
  "appMarket": {
    "registryUrl": "https://raw.githubusercontent.com/touwaka/touwaka-mate-v2-p0/main/apps",
    "allowCustomRegistry": true,
    "autoUpdate": false
  }
}
```

或环境变量：

```
APP_REGISTRY_URL=https://raw.githubusercontent.com/your-org/your-repo/main/apps
```

### 6.2 本地 Registry（开发模式）

开发时可以从本地文件系统读取：

```
APP_REGISTRY_MODE=local
APP_REGISTRY_PATH=./apps
```

---

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

## 9. 后续扩展

| 功能 | 说明 |
|------|------|
| App 版本更新 | 检测 Registry 新版本，一键更新 |
| App 导出 | 将本地 App 导出为符合格式的目录 |
| 自定义 Registry | 支持配置第三方 Registry URL |
| App 评分评论 | 用户对安装的 App 进行评分 |
| App 使用统计 | 记录每个 App 的使用次数、记录数 |

---

*让我们一起愉快地写代码吧！💪✨*