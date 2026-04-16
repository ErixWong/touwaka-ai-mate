# App 平台页面设计

> 本文件从 [`app-platform-design.md`](app-platform-design.md) 中提取，集中管理所有页面设计。
> 主文档中的页面章节引用本文件。

## 页面总览

| 类型 | 页面 | 路由 | 用户 | 功能 |
|------|------|------|------|------|
| 用户页面 | App 列表页 | `/apps` | 所有用户 | 小程序商店，卡片网格展示 |
| 用户页面 | App 详情页 | `/apps/:appId` | 所有用户 | 动态加载小程序组件 |
| 管理页面 | App 管理 | `/system/apps` | admin | 创建/编辑小程序，配置字段、状态、权限 |
| 管理页面 | 处理脚本管理 | `/system/handlers` | admin | 管理脚本，查看执行日志，测试脚本 |
| 管理页面 | 事件处理器管理 | `/system/apps/:appId/events` | admin | 管理 CRUD 事件处理器（create/update/delete） |

---

## 用户页面

### App 列表页 — AppsView.vue

**路由**：`/apps`

**文件位置**：`frontend/src/views/AppsView.vue`

**功能**：小程序商店，展示所有用户可访问的 App 卡片。

```vue
<!-- views/AppsView.vue -->
<template>
  <div class="apps-view">
    <h1 class="view-title">{{ $t('apps.title') }}</h1>
  
    <div class="apps-grid">
      <AppCard
        v-for="app in activeApps"
        :key="app.id"
        :app="app"
        @click="openApp(app)"
      />
    </div>
  
    <div v-if="activeApps.length === 0" class="empty-state">
      <span class="empty-icon">📱</span>
      <p>{{ $t('apps.noApps') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppCard from '@/components/apps/AppCard.vue'

const router = useRouter()
const activeApps = ref([])

onMounted(async () => {
  // 获取用户可访问的 App 列表
  const response = await fetch('/api/mini-apps')
  activeApps.value = await response.json()
})

function openApp(app) {
  router.push(`/apps/${app.id}`)
}
</script>
```

**UI 展示**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📱 App 小程序                                                            │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ 📄           │  │ 📊           │  │ 📋           │  │ 📁           ││
│  │ 销售合同管理  │  │ 文档对比      │  │ 发票管理     │  │ 质量文档     ││
│  │              │  │              │  │              │  │              ││
│  │ [打开]       │  │ [打开]       │  │ [打开]       │  │ [打开]       ││
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### App 详情页 — AppDetailView.vue

**路由**：`/apps/:appId`

**文件位置**：`frontend/src/views/AppDetailView.vue`

**功能**：动态加载小程序组件，根据 App 配置决定使用通用组件还是自定义组件。

```vue
<!-- views/AppDetailView.vue -->
<template>
  <div class="app-detail-view">
    <!-- 小程序头部 -->
    <div class="app-header">
      <button class="btn-back" @click="goBack">← {{ $t('apps.back') }}</button>
      <div class="app-info">
        <span class="app-icon">{{ currentApp?.icon }}</span>
        <h1 class="app-name">{{ currentApp?.name }}</h1>
      </div>
    </div>
  
    <!-- 动态加载小程序组件 -->
    <AppContainer :app="currentApp">
      <component :is="miniAppComponent" :app="currentApp" />
    </AppContainer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppContainer from '@/components/apps/AppContainer.vue'
import GenericMiniApp from '@/components/apps/GenericMiniApp.vue'

const route = useRoute()
const router = useRouter()
const currentApp = ref(null)

// 小程序组件映射（按需加载）
const componentMap: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  ContractManager: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/ContractManager.vue')
  ),
  DocumentCompare: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/DocumentCompare.vue')
  ),
  InvoiceManager: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/InvoiceManager.vue')
  ),
  QualityDocs: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/QualityDocs.vue')
  ),
}

// 动态选择组件
const miniAppComponent = computed(() => {
  const comp = currentApp.value?.component
  // 如果 App 配置了自定义组件，加载自定义组件
  if (comp && componentMap[comp]) {
    return componentMap[comp]
  }
  // 否则使用通用组件
  return GenericMiniApp
})

onMounted(async () => {
  const appId = route.params.appId
  const response = await fetch(`/api/mini-apps/${appId}`)
  currentApp.value = await response.json()
})

function goBack() {
  router.push('/apps')
}
</script>
```

**UI 展示**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← 返回    📄 销售合同管理                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  GenericMiniApp / 自定义组件                                      │   │
│  │                                                                   │   │
│  │  [列表] [上传] [统计]                                              │   │
│  │                                                                   │   │
│  │  ┌───────┬────────┬────────┬────────┬──────┬──────────┐         │   │
│  │  │ 编号  │ 日期    │ 甲方    │ 乙方    │ 金额 │ 操作     │         │   │
│  │  ├───────┼────────┼────────┼────────┼──────┼──────────┤         │   │
│  │  │ ...   │ ...    │ ...    │ ...    │ ...  │ 查看 编辑│         │   │
│  │  └───────┴────────┴────────┴────────┴──────┴──────────┘         │   │
│  │                                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 管理页面

### App 管理 — AppManagementView.vue

**路由**：`/system/apps`（推测，位于系统管理模块下）

**文件位置**：`frontend/src/views/system/AppManagementView.vue`

**功能**：创建/编辑/删除小程序，配置字段、状态、权限。

**操作流程**：

```
系统管理 → App 管理 → 新建 App
  → 表单填写：名称、图标、类型
  → 字段设计器：拖拽添加字段，设置类型和属性
  → 状态设计器：定义状态流转（可选）
  → 脚本绑定：为状态选择处理脚本（可选）
  → 保存 → 立即可用
```

**UI 展示**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  系统管理 → App 管理                                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  App 列表                                                        │   │
│  │  ┌──────┬──────────────┬──────────┬─────────┬────────┬────────┐│   │
│  │  │ 图标  │ 名称          │ 类型      │ 状态    │ 记录数 │ 操作   ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ 📄   │ 销售合同管理  │ document │ ✅ 启用 │ 128    │ 编辑   ││   │
│  │  │      │              │          │         │        │ 删除   ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ 📋   │ 发票管理      │ document │ ✅ 启用 │ 256    │ 编辑   ││   │
│  │  │      │              │          │         │        │ 删除   ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ 📁   │ 质量文档      │ document │ ✅ 启用 │ 64     │ 编辑   ││   │
│  │  └──────┴──────────────┴──────────┴─────────┴────────┴────────┘│   │
│  │                                                                 │   │
│  │  [+ 新建 App]                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**新建/编辑 App 表单**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  新建 App                                                                │
│                                                                         │
│  基本信息：                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  名称：[销售合同管理          ]                                   │   │
│  │  图标：[📄]  类型：[document ▼]                                  │   │
│  │  描述：[用于管理销售合同的录入、提取和统计...                    ]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  字段设计器：                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │   │
│  │  │ 合同编号    │  │ 签订日期    │  │ 合同金额    │  [+ 添加字段] │   │
│  │  │ type:text  │  │ type:date  │  │ type:number│                 │   │
│  │  │ required   │  │ required   │  │ required   │                 │   │
│  │  │ AI可提取   │  │ AI可提取   │  │ AI可提取   │                 │   │
│  │  └────────────┘  └────────────┘  └────────────┘                 │   │
│  │                                                                 │   │
│  │  拖拽排序 | 点击编辑属性 | 点击删除                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  状态设计器（可选）：                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │   │
│  │  │ 待OCR        │  │ 待提取       │  │ 待确认       │           │   │
│  │  │ sort:1       │  │ sort:2       │  │ sort:3       │           │   │
│  │  │ handler:ocr  │  │ handler:llm │  │ handler:无   │           │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │   │
│  │                                                                 │   │
│  │  [+ 添加状态]  流转顺序：待OCR → 待提取 → 待确认 → 已确认        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  权限设置：                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  可见范围：[全员可用 ▼]                                          │   │
│  │  App 管理员：[当前用户]                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [取消]  [保存]                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 状态设计器详解

状态设计器是 App 管理页面的核心组件，用于定义 App 的状态流转和脚本绑定。

**位置**：App 管理页面 → 新建/编辑 App 表单 → 状态设计器

**功能**：
- 添加/编辑/删除状态
- 设置状态属性（名称、显示名、类型）
- 设置流转顺序（拖拽排序）
- 绑定处理脚本
- 设置成功/失败后的下一状态

**添加状态弹窗**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  添加状态                                                                │
│                                                                         │
│  状态名称：[pending_ocr          ]  （英文标识，用于系统内部）            │
│  显示名称：[待OCR                ]  （中文显示，用于前端展示）            │
│                                                                         │
│  状态类型：                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ☑ 初始状态（创建记录时自动设置此状态）                          │   │
│  │  ☐ 终态（此状态不会触发任何脚本）                                │   │
│  │  ☐ 错误状态（用于展示失败记录）                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  流转顺序：[1] （数值越小越靠前，1=第一步）                               │
│                                                                         │
│  脚本绑定（可选）：                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  处理脚本：[OCR识别 ▼]  （选择已注册的脚本）                      │   │
│  │  成功后转到：[pending_extract ▼]  （处理成功后的下一状态）        │   │
│  │  失败后转到：[ocr_failed ▼]      （处理失败后的下一状态）         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [取消]  [添加]                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**状态卡片说明**：

```
┌──────────────┐
│ 待OCR        │  ← 显示名称（label）
│ sort:1       │  ← 流转顺序（sort_order）
│ handler:ocr  │  ← 绑定的脚本（handler_id）
│              │
│ [编辑] [删除]│
└──────────────┘
```

**流转顺序可视化**：

状态设计器底部显示状态流转图：

```
流转顺序：
  [待OCR] → [待提取] → [待确认] → [已确认]
     ↓           ↓
  [OCR失败]  [提取失败]
```

**数据存储**：

状态定义保存到 `app_state` 表：

```sql
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state)
VALUES ('state-1', 'contract-mgr', 'pending_ocr', '待OCR', 1, 1, 0, 0, 'script-ocr', 'pending_extract', 'ocr_failed');
```

---

### 处理脚本管理 — HandlerManagementView.vue

**路由**：`/system/handlers`（推测，位于系统管理模块下）

**文件位置**：`frontend/src/views/system/HandlerManagementView.vue`

**功能**：管理处理脚本（OCR、LLM提取等），查看执行日志，测试脚本。

**UI 展示**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  系统管理 → 处理脚本                                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  脚本列表                                                        │   │
│  │  ┌──────┬──────────────┬──────────┬─────────┬────────┬────────┐│   │
│  │  │ 名称  │ 描述          │ handler  │ 状态    │ 操作   │         ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ OCR  │ markitdown   │ scripts/ │ ✅ 启用 │ 编辑   │         ││   │
│  │  │      │ + mineru回退  │ ocr      │         │ 日志   │         ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ 提取  │ LLM元数据提取 │ scripts/ │ ✅ 启用 │ 编辑   │         ││   │
│  │  │      │              │ extract  │         │ 日志   │         ││   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┼────────┤│   │
│  │  │ 发票  │ fapiao技能   │ skills/  │ ✅ 启用 │ 编辑   │         ││   │
│  │  │      │              │ fapiao   │         │ 日志   │         ││   │
│  │  └──────┴──────────────┴──────────┴─────────┴────────┴────────┘│   │
│  │                                                                 │   │
│  │  [+ 新建脚本]                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**脚本详情页**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  脚本详情：OCR识别                                                       │
│                                                                         │
│  基本信息：                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  名称：OCR识别                                                   │   │
│  │  描述：调用markitdown/mineru进行OCR识别                          │   │
│  │  handler：scripts/ocr-service                                    │   │
│  │  handler_function：process                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  并发控制：                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  最大并发数：3                                                    │   │
│  │  超时时间：60 秒                                                  │   │
│  │  最大重试次数：2                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  关联的 App：                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • 销售合同管理 (pending_ocr 状态)                               │   │
│  │  • 发票管理 (pending_process 状态)                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  执行日志（最近 20 次）：                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ┌──────┬────────┬────────┬────────┬────────┬────────┬────────┐│   │
│  │  │ 时间  │ 记录ID │ 状态    │ 结果    │ 耗时   │ 详情   │         ││   │
│  │  ├──────┼────────┼────────┼────────┼────────┼────────┼────────┤│   │
│  │  │ 10:30 │ rec_01 │ pending │ ✅ 成功 │ 2.3s  │ 查看   │         ││   │
│  │  │ 10:29 │ rec_02 │ pending │ ✅ 成功 │ 1.8s  │ 查看   │         ││   │
│  │  │ 10:28 │ rec_03 │ pending │ ❌ 失败 │ 5.0s  │ 查看   │         ││   │
│  │  └──────┴────────┴────────┴────────┴────────┴────────┴────────┘│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  测试：                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  选择记录：[rec_001 ▼]                                           │   │
│  │  [执行测试]                                                      │   │
│  │  结果：{ success: true, data: { ... } }                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [返回列表]                                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 组件结构

### 目录结构

```
frontend/src/
├── views/
│   ├── AppsView.vue              # App 列表页（小程序商店）
│   ├── AppDetailView.vue         # App 详情页（动态加载小程序组件）
│   └── system/
│       ├── AppManagementView.vue # App 管理（系统管理）
│       └── HandlerManagementView.vue # 处理脚本管理（系统管理）
│
├── components/
│   └── apps/
│       ├── AppCard.vue            # 小程序卡片（用于列表展示）
│       ├── AppContainer.vue       # 小程序容器（提供共享能力注入）
│       ├── GenericMiniApp.vue     # 通用小程序组件（一个组件覆盖所有 App）
│       │
│       ├── mini-apps/             # 各小程序自定义组件
│       │   ├── ContractManager.vue    # 合同管理
│       │   ├── DocumentCompare.vue    # 文档对比
│       │   ├── InvoiceManager.vue     # 发票管理
│       │   ├── QualityDocs.vue        # 质量文档管理
│       │   └── ...
│       │
│       └── fields/                # 字段渲染组件（按类型）
│           ├── TextField.vue      # text → <input>
│           ├── TextAreaField.vue  # textarea → <textarea>
│           ├── NumberField.vue    # number → <input type="number">
│           ├── DateField.vue      # date → <DatePicker>
│           ├── SelectField.vue    # select → <Select>
│           ├── FileField.vue      # file → <FileUpload>
│           ├── BooleanField.vue   # boolean → <Switch>
│           ├── GroupField.vue     # group → 递归渲染子字段
│           └── RepeatingField.vue # repeating → 可编辑表格
```

### 组件说明

| 组件 | 用途 | 说明 |
|------|------|------|
| `AppCard.vue` | App 卡片 | 用于列表页展示，包含图标、名称、描述、打开按钮 |
| `AppContainer.vue` | App 容器 | 提供 AI 状态管理、MCP/技能调用接口、文件上传等共享能力 |
| `GenericMiniApp.vue` | 通用组件 | 根据 `fields` 和 `views` 自动渲染列表/表单/详情视图 |
| `mini-apps/*.vue` | 自定义组件 | 复杂交互场景（文档对比、发票图片预览等） |
| `fields/*.vue` | 字段组件 | 按字段类型渲染输入控件 |

---

## 路由设计

### 用户路由

```typescript
// frontend/src/router/index.ts

// App 平台路由（用户页面）
{
  path: 'apps',
  name: 'apps',
  component: () => import('@/views/AppsView.vue'),
  meta: { title: 'App 小程序', requiresAuth: true }
},
{
  path: 'apps/:appId',
  name: 'app-detail',
  component: () => import('@/views/AppDetailView.vue'),
  meta: { title: '小程序详情', requiresAuth: true }
},
```

### 管理路由

```typescript
// frontend/src/router/index.ts

// 系统管理路由（管理员页面）
{
  path: 'system',
  name: 'system',
  component: () => import('@/views/SystemView.vue'),
  meta: { title: '系统管理', requiresAuth: true, requiresAdmin: true },
  children: [
    // ... 其他系统管理子路由
    
    // App 管理
    {
      path: 'apps',
      name: 'system-apps',
      component: () => import('@/views/system/AppManagementView.vue'),
      meta: { title: 'App 管理', requiresAdmin: true }
    },
    
    // 处理脚本管理
    {
      path: 'handlers',
      name: 'system-handlers',
      component: () => import('@/views/system/HandlerManagementView.vue'),
      meta: { title: '处理脚本管理', requiresAdmin: true }
    }
  ]
}
```

---

## 导航设计

### 顶部导航栏

在 [`AppHeader.vue`](../../frontend/src/components/AppHeader.vue) 的 `header-nav` 中新增 App 导航项：

```
nav 结构（现有）：
  🤖 专家 → /experts
  🧩 技能 → /skills
  📚 知识库 → /knowledge
  🎯 解决方案 → /solutions
  🏢 组织 → /organization (管理员)
  👤 个人 → /personal
  ⚙️ 系统 → /system (管理员)

新增：
  📱 App → /apps
```

### 系统管理子导航

```
系统管理子导航（现有）：
  用户管理 → /system/users
  角色管理 → /system/roles
  技能管理 → /system/skills
  ...

新增：
  App 管理 → /system/apps
  处理脚本 → /system/handlers
```

---

## GenericMiniApp 通用组件

### 工作原理

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GenericMiniApp.vue 工作原理                                             │
│                                                                         │
│  1. 进入 App → 请求 GET /api/mini-apps/:appId                           │
│     → 获取 fields（字段定义）+ views（视图配置）+ config（功能开关）       │
│     → 获取 app_state（状态定义）                                         │
│                                                                         │
│  2. 根据 fields 自动渲染：                                               │
│     • 列表页 → 表格列 = fields 中 required/ai_extractable 的字段         │
│     • 表单页 → 表单字段 = fields 逐个渲染为输入控件                      │
│     • 详情页 → 字段值展示                                               │
│                                                                         │
│  3. 字段类型 → 控件映射：                                                │
│     text       → <input type="text">                                    │
│     textarea   → <textarea>                                             │
│     number     → <input type="number">                                  │
│     date       → <DatePicker>                                           │
│     select     → <Select>（options 从 field.options 读取）              │
│     file       → <FileUpload>（上传后调 /extract）                       │
│     boolean    → <Switch>                                               │
│     group      → <GroupField>（递归渲染子字段）                          │
│     repeating  → <RepeatingField>（可编辑表格）                          │
│                                                                         │
│  4. 所有 CRUD 操作调用统一 API                                           │
│     → GET /api/mini-apps/:appId/data                                    │
│     → POST /api/mini-apps/:appId/data                                   │
│     → PUT /api/mini-apps/:appId/data/:id                                │
│     → DELETE /api/mini-apps/:appId/data/:id                             │
│                                                                         │
│  5. 状态追踪                                                             │
│     → 前端轮询 GET /api/mini-apps/:appId/data/:recordId                 │
│     → 检查 data._status 字段变化                                        │
│     → pending_ocr → pending_extract → pending_review → confirmed        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 视图切换

GenericMiniApp 根据 `config.features` 动态生成 Tab：

```
features: ["upload", "list", "detail", "stats"]

Tab Bar:
  [列表] [上传] [统计]

点击列表 → 显示数据表格
点击上传 → 显示文件上传区 + AI 提取进度 + 表单预填
点击统计 → 显示基础统计图表
```

### 什么时候需要自定义组件？

| 场景 | 通用组件能否覆盖 | 解决方案 |
|------|------------------|----------|
| 标准 CRUD + AI 提取 | ✅ 可以 | `GenericMiniApp.vue` |
| 列表 + 筛选 + 排序 | ✅ 可以 | `GenericMiniApp.vue` |
| 文档对比（左右分栏 diff） | ❌ 不行 | 自定义 `DocumentCompare.vue` |
| 合同条款高亮标注 | ❌ 不行 | 自定义 `ContractReview.vue` |
| 发票图片预览 + 明细编辑 | ❌ 不行 | 自定义 `InvoiceManager.vue` |
| 统计图表 | ⚠️ 部分 | 通用组件提供基础统计，复杂图表需自定义 |

**策略**：先用 `GenericMiniApp.vue` 快速上线所有 App，后续按需为特定 App 开发自定义组件。

---

## API 接口

### 小程序管理 API

```typescript
// 获取可用小程序列表
GET /api/mini-apps
Response: MiniApp[]

// 获取小程序详情
GET /api/mini-apps/:appId
Response: MiniApp

// 创建小程序（管理员）
POST /api/mini-apps
Request: { name, icon, type, fields, config, visibility, owner_id }
Response: MiniApp

// 更新小程序（管理员）
PUT /api/mini-apps/:appId
Request: { name, fields, config, ... }
Response: MiniApp

// 删除小程序（管理员）
DELETE /api/mini-apps/:appId
```

### 小程序数据操作 API

```typescript
// 查询小程序数据（分页、筛选）
GET /api/mini-apps/:appId/data?page=&size=&filter=&sort=
Response: { items: any[], total: number, page: number, pages: number }

// 获取单条数据详情
GET /api/mini-apps/:appId/data/:recordId
Response: { id, app_id, data, title, ai_extracted, ... }

// 创建记录（手动填写）
POST /api/mini-apps/:appId/data
Request: { data: Record<string, any>, attachments?: string[] }

// 更新记录
PUT /api/mini-apps/:appId/data/:recordId
Request: { data: Record<string, any> }

// 删除记录
DELETE /api/mini-apps/:appId/data/:recordId

// 批量上传文件
POST /api/mini-apps/:appId/data/batch
Content-Type: multipart/form-data
Request: { files: File[] }
Response: { upload_time: string, count: number }
// 返回上传时间戳，用于后续进度查询

// 批量进度查询（按上传时间戳）
GET /api/mini-apps/:appId/status-summary?created_after=2026-04-14T10:30:00Z
Response: {
  total: number,
  by_status: { [status_name]: count },
  completed: number,
  processing: number,
  failed: number
}
```

### 处理脚本管理 API

```typescript
// 获取脚本列表
GET /api/handlers
Response: Handler[]

// 获取脚本详情
GET /api/handlers/:handlerId
Response: Handler

// 创建脚本（管理员）
POST /api/handlers
Request: { name, description, handler, handler_function, concurrency, timeout, max_retries }

// 更新脚本（管理员）
PUT /api/handlers/:handlerId

// 删除脚本（管理员）
DELETE /api/handlers/:handlerId

// 获取脚本执行日志
GET /api/handlers/:handlerId/logs?limit=20
Response: ActionLog[]

// 测试脚本
POST /api/handlers/:handlerId/test
Request: { record_id: string }
Response: { success: boolean, data?: any, error?: string }
```

---

## 状态定义管理 API

```typescript
// 获取 App 的状态定义列表
GET /api/mini-apps/:appId/states
Response: AppState[]

// 创建状态定义（管理员）
POST /api/mini-apps/:appId/states
Request: { name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state }

// 更新状态定义（管理员）
PUT /api/mini-apps/:appId/states/:stateId

// 删除状态定义（管理员）
DELETE /api/mini-apps/:appId/states/:stateId
```

---

## 事件处理器管理 API

> 用于事件驱动模式：固定的 CRUD 事件（create/update/delete）触发脚本执行。

```typescript
// 获取 App 的事件处理器列表
GET /api/mini-apps/:appId/event-handlers
Response: EventHandler[]

// 创建事件处理器（管理员）
POST /api/mini-apps/:appId/event-handlers
Request: {
  event_type: 'create' | 'update' | 'delete',  // 事件类型
  handler_id: string,                           // 处理脚本ID
  priority: number,                             // 执行优先级（数值越小越先执行）
  execution_mode: 'sync' | 'async',             // 执行模式
  failure_policy: 'block' | 'log' | 'ignore',   // 失败策略
  condition?: object                            // 触发条件（JSON 表达式）
}

// 更新事件处理器（管理员）
PUT /api/mini-apps/:appId/event-handlers/:handlerId
Request: { priority, execution_mode, failure_policy, condition, is_active }

// 删除事件处理器（管理员）
DELETE /api/mini-apps/:appId/event-handlers/:handlerId

// 测试事件处理器
POST /api/mini-apps/:appId/event-handlers/:handlerId/test
Request: {
  record_id: string,                            // 测试记录ID
  event_type: 'create' | 'update' | 'delete',   // 模拟的事件类型
  simulate_data?: object                        // 模拟的记录数据（可选）
}
Response: {
  success: boolean,
  data?: any,                                   // 脚本返回的数据
  error?: string,                               // 错误信息
  blocked?: boolean                             // 是否会阻止操作
}
```

**事件处理器示例**：

```jsonc
// 创建后自动编号
{
  "event_type": "create",
  "handler_id": "handler-auto-number",
  "priority": 1,
  "execution_mode": "sync",
  "failure_policy": "block",
  "condition": null
}

// 更新后发送通知（仅状态变更时）
{
  "event_type": "update",
  "handler_id": "handler-notification",
  "priority": 1,
  "execution_mode": "sync",
  "failure_policy": "log",
  "condition": { "status": { "$ne": "draft" } }
}

// 删除前检查关联数据
{
  "event_type": "delete",
  "handler_id": "handler-check-relations",
  "priority": 1,
  "execution_mode": "sync",
  "failure_policy": "block",
  "condition": null
}
```

---

## 权限控制

### App 级权限

- `visibility = 'all'`：全员可用
- `visibility = 'department'`：仅 owner 所在部门可用
- `visibility = 'owner'`：仅 owner_id 用户和 admin 可用
- `visibility = 'role'`：通过 `mini_app_role_access` 表指定角色

### 记录级权限（Phase 1）

- 查询：`WHERE user_id = 当前用户ID`
- 编辑：只有记录创建者可以编辑
- 删除：只有记录创建者 + admin 可以删除
- 例外：App 管理员（owner_id）+ admin 角色可以看到所有记录

### 管理页面权限

- App 管理：仅 admin 角色
- 处理脚本管理：仅 admin 角色

---

## Phase 规划

| Phase | 页面 | 说明 |
|-------|------|------|
| Phase 1 | App 列表页 | 基础卡片展示 |
| Phase 1 | App 详情页 | GenericMiniApp 通用组件 |
| Phase 1 | 发票管理 | 第一个小程序（基于 fapiao 技能） |
| Phase 1 | 状态驱动 | OCR → LLM 提取 → 用户确认（先实现） |
| Phase 2 | App 管理 | 系统管理页面，创建/编辑小程序 |
| Phase 2 | 处理脚本管理 | 系统管理页面，管理脚本 |
| Phase 2 | 合同管理 | 自定义组件（条款高亮等） |
| Phase 2 | 事件驱动基础 | create/update/delete 事件处理器，同步执行 |
| Phase 3 | 文档对比 | 自定义组件（左右分栏 diff） |
| Phase 3 | 质量文档管理 | 版本链、有效期管理 |
| Phase 3 | 事件驱动增强 | 条件过滤、异步执行、复杂编排 |

---

*让我们一起愉快地写代码吧！ 💪✨*