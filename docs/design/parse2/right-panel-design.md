# 右侧面板容器设计方案 v2

## 概述

在对话页面右侧实现一个固定显示的面板容器，采用 Tab 页形式组织多个功能模块。用户可以手动收起或展开面板。默认显示当前用户与当前专家沟通的 Topics 列表。

## 界面布局

### 展开状态
```
┌─────────────────────────────────────────────────────────────────┐
│                         Chat Header                              │
│  [Expert Name] [Model Badge]              [Toggle Panel] [⋮]   │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │  [Topics] [Debug] [Files] │
│                                     │  ┌───────────────────────┐│
│         Chat Window                 │  │ Topic Item 1          ││
│        (左侧主区域)                  │  │ Topic Item 2          ││
│                                     │  │ Topic Item 3          ││
│                                     │  │ ...                   ││
│                                     │  │                       ││
│                                     │  │     [Pagination]      ││
│                                     │  └───────────────────────┘│
├─────────────────────────────────────┴───────────────────────────┤
│                         Input Area                               │
└─────────────────────────────────────────────────────────────────┘
```

### 收起状态
```
┌─────────────────────────────────────────────────────────────────┐
│                         Chat Header                              │
│  [Expert Name] [Model Badge]                      [▶ Show Panel]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                     Chat Window                                 │
│                    (全宽显示)                                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                         Input Area                               │
└─────────────────────────────────────────────────────────────────┘
```

## 技术方案

### 1. 组件结构

```
frontend/src/
├── views/
│   └── ChatView.vue              # 主视图，包含布局逻辑
├── components/
│   ├── ChatWindow.vue            # 对话窗口（已有）
│   ├── Pagination.vue            # 通用分页组件（新建）
│   └── panel/                    # 面板组件目录
│       ├── RightPanel.vue        # 右侧面板容器
│       ├── TopicsTab.vue         # Topics 列表 Tab（默认）
│       ├── DebugTab.vue          # 调试信息 Tab
│       └── FilesTab.vue          # 文件管理 Tab
└── stores/
    └── panel.ts                  # 面板状态管理
```

### 2. 通用分页设计

#### 2.1 分页请求格式

```typescript
// types/index.ts 中添加

/**
 * 统一分页查询参数
 * 所有列表查询 API 都应支持此格式
 */
export interface PageQuery {
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页条数，默认 10，最大 100 */
  size: number
  /** 排序字段 */
  sort_by?: string
  /** 排序方向 */
  sort_order?: 'asc' | 'desc'
}

/**
 * 统一分页响应格式
 * 所有列表 API 都应返回此格式
 */
export interface PageResponse<T> {
  /** 数据列表 */
  items: T[]
  /** 总条数 */
  total: number
  /** 当前页码 */
  page: number
  /** 每页条数 */
  size: number
  /** 总页数 */
  pages: number
}
```

#### 2.2 通用分页组件

```vue
<!-- components/Pagination.vue -->
<template>
  <div class="pagination" v-if="totalPages > 1">
    <button 
      class="page-btn" 
      :disabled="currentPage <= 1"
      @click="goToPage(currentPage - 1)"
    >
      ‹
    </button>
    
    <button
      v-for="page in visiblePages"
      :key="page"
      class="page-btn"
      :class="{ active: page === currentPage }"
      @click="goToPage(page)"
    >
      {{ page }}
    </button>
    
    <button 
      class="page-btn" 
      :disabled="currentPage >= totalPages"
      @click="goToPage(currentPage + 1)"
    >
      ›
    </button>
    
    <span class="page-info">
      {{ $t('pagination.info', { total }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  currentPage: number
  totalPages: number
  total: number
  maxVisible?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxVisible: 5
})

const emit = defineEmits<{
  change: [page: number]
}>()

const visiblePages = computed(() => {
  const pages: number[] = []
  const half = Math.floor(props.maxVisible / 2)
  let start = Math.max(1, props.currentPage - half)
  let end = Math.min(props.totalPages, start + props.maxVisible - 1)
  
  if (end - start < props.maxVisible - 1) {
    start = Math.max(1, end - props.maxVisible + 1)
  }
  
  for (let i = start; i <= end; i++) {
    pages.push(i)
  }
  return pages
})

const goToPage = (page: number) => {
  if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
    emit('change', page)
  }
}
</script>
```

#### 2.3 分页组件使用示例

```vue
<template>
  <div class="list-container">
    <div v-for="item in items" :key="item.id">
      <!-- item content -->
    </div>
    
    <Pagination
      :current-page="pagination.page"
      :total-pages="pagination.pages"
      :total="pagination.total"
      @change="handlePageChange"
    />
  </div>
</template>

<script setup>
const pagination = ref({ page: 1, size: 10, total: 0, pages: 0 })

const loadData = async (page: number = 1) => {
  const response = await api.getList({
    page,
    size: pagination.value.size
  })
  items.value = response.items
  pagination.value = {
    page: response.page,
    size: response.size,
    total: response.total,
    pages: response.pages
  }
}

const handlePageChange = (page: number) => {
  loadData(page)
}
</script>
```

### 3. Topics Tab 设计

#### 3.1 显示格式选择

**推荐：卡片列表形式**

理由：
- Topics 通常包含标题、描述、时间等多维度信息
- 卡片形式更易于展示这些信息，视觉层次更清晰
- 支持更好的交互（点击进入、hover 效果等）
- 移动端适配更友好

**替代方案：表格形式**
- 适合数据量大、需要快速扫描对比的场景
- 适合管理后台场景

#### 3.2 TopicsTab 组件设计

```vue
<!-- components/panel/TopicsTab.vue -->
<template>
  <div class="topics-tab">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      {{ $t('common.loading') }}
    </div>
    
    <!-- 空状态 -->
    <div v-else-if="topics.length === 0" class="empty-state">
      <p>{{ $t('topics.noTopics') }}</p>
    </div>
    
    <!-- Topics 列表 -->
    <div v-else class="topics-list">
      <div 
        v-for="topic in topics" 
        :key="topic.id"
        class="topic-card"
        :class="{ active: topic.id === activeTopicId }"
        @click="selectTopic(topic)"
      >
        <div class="topic-header">
          <h4 class="topic-title">{{ topic.title }}</h4>
          <span class="topic-date">{{ formatDate(topic.created_at) }}</span>
        </div>
        <p class="topic-description">{{ topic.description || $t('topics.noDescription') }}</p>
        <div class="topic-meta">
          <span class="meta-item">
            <span class="meta-icon">💬</span>
            {{ topic.message_count }} {{ $t('topics.messages') }}
          </span>
          <span class="meta-item" :class="topic.status">
            {{ $t(`topics.status.${topic.status}`) }}
          </span>
        </div>
      </div>
    </div>
    
    <!-- 分页 -->
    <Pagination
      v-if="pagination.pages > 1"
      :current-page="pagination.page"
      :total-pages="pagination.pages"
      :total="pagination.total"
      @change="handlePageChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Pagination from '@/components/Pagination.vue'
import { topicApi } from '@/api/services'
import type { Topic, PageResponse } from '@/types'

const route = useRoute()
const topics = ref<Topic[]>([])
const loading = ref(false)
const activeTopicId = ref<string | null>(null)

const pagination = ref({
  page: 1,
  size: 10,
  total: 0,
  pages: 0
})

// 从路由获取当前 expertId
const expertId = computed(() => route.params.expertId as string)

// 加载 Topics
const loadTopics = async (page: number = 1) => {
  if (!expertId.value) return
  
  loading.value = true
  try {
    const response: PageResponse<Topic> = await topicApi.getTopicsByExpert(
      expertId.value,
      { page, size: pagination.value.size }
    )
    topics.value = response.items
    pagination.value = {
      page: response.page,
      size: response.size,
      total: response.total,
      pages: response.pages
    }
  } catch (error) {
    console.error('Failed to load topics:', error)
  } finally {
    loading.value = false
  }
}

// 选择 Topic
const selectTopic = (topic: Topic) => {
  activeTopicId.value = topic.id
  // 可以触发加载该 topic 下的消息
  emit('select', topic)
}

// 分页变化
const handlePageChange = (page: number) => {
  loadTopics(page)
}

// 监听 expertId 变化
watch(expertId, (newId) => {
  if (newId) {
    loadTopics(1)
  }
}, { immediate: true })

// 格式化日期
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString()
}

const emit = defineEmits<{
  select: [topic: Topic]
}>()
</script>

<style scoped>
.topics-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.topics-list {
  flex: 1;
  overflow-y: auto;
}

.topic-card {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.topic-card:hover {
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.topic-card.active {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.topic-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-date {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  flex-shrink: 0;
  margin-left: 8px;
}

.topic-description {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.topic-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary, #666);
}

.meta-item.active {
  color: var(--success-color, #4caf50);
}

.meta-item.archived {
  color: var(--warning-color, #ff9800);
}
</style>
```

### 4. RightPanel 容器设计

```vue
<!-- components/panel/RightPanel.vue -->
<template>
  <div class="right-panel" :class="{ collapsed: isCollapsed }">
    <!-- 折叠时的展开按钮 -->
    <div v-if="isCollapsed" class="collapsed-bar" @click="togglePanel">
      <span class="expand-icon">◀</span>
      <span class="collapsed-text">{{ $t('panel.topics') }}</span>
    </div>
    
    <!-- 展开时的内容 -->
    <template v-else>
      <!-- Tab 导航 -->
      <div class="panel-header">
        <div class="panel-tabs">
          <button 
            v-for="tab in visibleTabs" 
            :key="tab.id"
            class="tab-btn"
            :class="{ active: activeTab === tab.id }"
            @click="setActiveTab(tab.id)"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            <span class="tab-label">{{ tab.label }}</span>
          </button>
        </div>
        <button class="collapse-btn" @click="togglePanel" :title="$t('panel.collapse')">
          ▶
        </button>
      </div>
      
      <!-- Tab 内容 -->
      <div class="panel-content">
        <TopicsTab 
          v-if="activeTab === 'topics'" 
          @select="handleTopicSelect" 
        />
        <DebugTab v-if="activeTab === 'debug'" />
        <FilesTab v-if="activeTab === 'files'" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePanelStore } from '@/stores/panel'
import { useUserStore } from '@/stores/user'
import TopicsTab from './TopicsTab.vue'
import DebugTab from './DebugTab.vue'
import FilesTab from './FilesTab.vue'
import type { Topic } from '@/types'

const panelStore = usePanelStore()
const userStore = useUserStore()

const isCollapsed = computed(() => panelStore.isCollapsed)
const activeTab = computed(() => panelStore.activeTab)

const visibleTabs = computed(() => {
  const tabs = [
    { id: 'topics', label: '话题', icon: '💬' },
    { id: 'files', label: '文件', icon: '📁' },
    { id: 'debug', label: '调试', icon: '🔧', adminOnly: true },
  ]
  
  return tabs.filter(tab => {
    if (tab.adminOnly && !userStore.isAdmin) {
      return false
    }
    return true
  })
})

const togglePanel = () => {
  panelStore.toggleCollapse()
}

const setActiveTab = (tabId: string) => {
  panelStore.setActiveTab(tabId)
}

const handleTopicSelect = (topic: Topic) => {
  // 处理 topic 选择
  console.log('Selected topic:', topic)
}
</script>

<style scoped>
.right-panel {
  width: 320px;
  border-left: 1px solid var(--border-color, #e0e0e0);
  background: var(--sidebar-bg, #fff);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
}

.right-panel.collapsed {
  width: 40px;
}

.collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  cursor: pointer;
  height: 100%;
}

.collapsed-bar:hover {
  background: var(--hover-bg, #f5f5f5);
}

.expand-icon {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.collapsed-text {
  writing-mode: vertical-rl;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 8px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.panel-tabs {
  display: flex;
  gap: 4px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--hover-bg, #f5f5f5);
}

.tab-btn.active {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.tab-icon {
  font-size: 14px;
}

.collapse-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-radius: 4px;
}

.collapse-btn:hover {
  background: var(--hover-bg, #f5f5f5);
}

.panel-content {
  flex: 1;
  overflow: hidden;
}
</style>
```

### 5. Panel Store 设计

```typescript
// stores/panel.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const usePanelStore = defineStore('panel', () => {
  // State
  const isCollapsed = ref(false)
  const activeTab = ref('topics')  // 默认显示 topics
  const width = ref(320)

  // Actions
  const toggleCollapse = () => {
    isCollapsed.value = !isCollapsed.value
    // 持久化到 localStorage
    localStorage.setItem('panel_collapsed', String(isCollapsed.value))
  }

  const setActiveTab = (tabId: string) => {
    activeTab.value = tabId
    // 如果面板是收起的，展开它
    if (isCollapsed.value) {
      isCollapsed.value = false
    }
  }

  const setWidth = (newWidth: number) => {
    width.value = Math.min(Math.max(newWidth, 280), 600)
  }

  // 初始化时从 localStorage 恢复状态
  const initFromStorage = () => {
    const collapsed = localStorage.getItem('panel_collapsed')
    if (collapsed !== null) {
      isCollapsed.value = collapsed === 'true'
    }
  }

  // 自动调用初始化
  initFromStorage()

  return {
    isCollapsed,
    activeTab,
    width,
    toggleCollapse,
    setActiveTab,
    setWidth,
  }
})
```

## 后端 API 需求

### Topics API

```
GET /api/topics?expert_id={expert_id}&page=1&size=10

Response:
{
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "title": "话题标题",
      "description": "话题描述",
      "expert_id": "uuid",
      "status": "active",
      "message_count": 15,
      "created_at": "2026-02-20T10:00:00Z",
      "updated_at": "2026-02-20T12:00:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "size": 10,
  "pages": 5
}
```

### 通用分页查询约定

所有列表 API 应遵循以下约定：

**请求参数：**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码，从 1 开始 |
| size | number | 10 | 每页条数，最大 100 |
| sort_by | string | created_at | 排序字段 |
| sort_order | string | desc | 排序方向 asc/desc |

**响应格式：**
```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "size": 10,
  "pages": 0
}
```

## 国际化

```typescript
// zh-CN.ts
panel: {
  topics: '话题',
  files: '文件',
  debug: '调试',
  collapse: '收起面板',
  expand: '展开面板',
}

topics: {
  noTopics: '暂无话题',
  noDescription: '暂无描述',
  messages: '条消息',
  status: {
    active: '进行中',
    archived: '已归档',
    deleted: '已删除',
  }
}

pagination: {
  info: '共 {total} 条',
  prev: '上一页',
  next: '下一页',
}

// en-US.ts
panel: {
  topics: 'Topics',
  files: 'Files',
  debug: 'Debug',
  collapse: 'Collapse Panel',
  expand: 'Expand Panel',
}

topics: {
  noTopics: 'No topics yet',
  noDescription: 'No description',
  messages: 'messages',
  status: {
    active: 'Active',
    archived: 'Archived',
    deleted: 'Deleted',
  }
}

pagination: {
  info: '{total} total',
  prev: 'Previous',
  next: 'Next',
}
```

### 6. Docs Tab 设计（阶段性成果展示）

#### 6.1 功能定位

Docs Tab 是右侧面板的**默认 Tab**，用于展示对话过程中产生的阶段性成果文档，如：
- AI 撰写的报告
- 生成的 Markdown 文档
- 代码片段
- 会议纪要
- 方案设计文档

#### 6.2 数据结构

```typescript
// types/index.ts 中添加

/**
 * 阶段性成果文档
 */
export interface Doc {
  id: string
  topic_id: string
  expert_id: string
  user_id: string
  title: string
  content: string          // Markdown 内容
  content_type: 'markdown' | 'code' | 'text'
  status: 'draft' | 'final' | 'archived'
  version: number
  tags: string[]
  created_at: string
  updated_at: string
}
```

#### 6.3 DocsTab 组件设计

```vue
<!-- components/panel/DocsTab.vue -->
<template>
  <div class="docs-tab">
    <!-- 工具栏 -->
    <div class="docs-toolbar">
      <button class="btn-new-doc" @click="createNewDoc">
        <span class="icon">+</span>
        {{ $t('docs.newDoc') }}
      </button>
    </div>
    
    <!-- 文档列表 -->
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
    </div>
    
    <div v-else-if="docs.length === 0" class="empty-state">
      <p>{{ $t('docs.noDocs') }}</p>
      <p class="hint">{{ $t('docs.hint') }}</p>
    </div>
    
    <div v-else class="docs-list">
      <div 
        v-for="doc in docs" 
        :key="doc.id"
        class="doc-card"
        :class="{ active: doc.id === activeDocId }"
        @click="selectDoc(doc)"
      >
        <div class="doc-header">
          <h4 class="doc-title">{{ doc.title }}</h4>
          <span class="doc-status" :class="doc.status">
            {{ $t(`docs.status.${doc.status}`) }}
          </span>
        </div>
        <p class="doc-preview">{{ getPreview(doc.content) }}</p>
        <div class="doc-meta">
          <span class="meta-item">{{ formatDate(doc.updated_at) }}</span>
          <span class="meta-item">v{{ doc.version }}</span>
        </div>
      </div>
    </div>
    
    <!-- 分页 -->
    <Pagination
      v-if="pagination.pages > 1"
      :current-page="pagination.page"
      :total-pages="pagination.pages"
      :total="pagination.total"
      @change="handlePageChange"
    />
    
    <!-- 文档预览/编辑弹窗 -->
    <DocPreviewModal
      v-if="showPreview"
      :doc="selectedDoc"
      @close="closePreview"
      @save="saveDoc"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import Pagination from '@/components/Pagination.vue'
import DocPreviewModal from './DocPreviewModal.vue'
import type { Doc, PageResponse } from '@/types'

const route = useRoute()
const docs = ref<Doc[]>([])
const loading = ref(false)
const activeDocId = ref<string | null>(null)
const selectedDoc = ref<Doc | null>(null)
const showPreview = ref(false)

const pagination = ref({
  page: 1,
  size: 10,
  total: 0,
  pages: 0
})

const expertId = computed(() => route.params.expertId as string)

// 加载文档列表
const loadDocs = async (page: number = 1) => {
  if (!expertId.value) return
  
  loading.value = true
  try {
    // TODO: 实现 docsApi
    // const response = await docsApi.getDocsByExpert(expertId.value, { page, size: 10 })
    // docs.value = response.items
    // pagination.value = { ...response }
  } catch (error) {
    console.error('Failed to load docs:', error)
  } finally {
    loading.value = false
  }
}

// 获取内容预览（前100字符）
const getPreview = (content: string) => {
  if (!content) return ''
  const text = content.replace(/[#*`\[\]]/g, '').trim()
  return text.length > 100 ? text.slice(0, 100) + '...' : text
}

// 选择文档
const selectDoc = (doc: Doc) => {
  activeDocId.value = doc.id
  selectedDoc.value = doc
  showPreview.value = true
}

// 创建新文档
const createNewDoc = () => {
  selectedDoc.value = null
  showPreview.value = true
}

// 关闭预览
const closePreview = () => {
  showPreview.value = false
  selectedDoc.value = null
}

// 保存文档
const saveDoc = async (doc: Partial<Doc>) => {
  // TODO: 实现保存逻辑
  console.log('Save doc:', doc)
  closePreview()
  loadDocs(pagination.value.page)
}

// 分页变化
const handlePageChange = (page: number) => {
  loadDocs(page)
}

// 监听 expertId 变化
watch(expertId, (newId) => {
  if (newId) loadDocs(1)
}, { immediate: true })

// 格式化日期
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString()
}
</script>

<style scoped>
.docs-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.docs-toolbar {
  margin-bottom: 12px;
}

.btn-new-doc {
  width: 100%;
  padding: 8px 12px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-new-doc:hover {
  background: var(--primary-hover, #1976d2);
}

.docs-list {
  flex: 1;
  overflow-y: auto;
}

.doc-card {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.doc-card:hover {
  border-color: var(--primary-color, #2196f3);
}

.doc-card.active {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
}

.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.doc-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.doc-status {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.doc-status.draft {
  background: #fff3e0;
  color: #e65100;
}

.doc-status.final {
  background: #e8f5e9;
  color: #2e7d32;
}

.doc-status.archived {
  background: #f5f5f5;
  color: #757575;
}

.doc-preview {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.doc-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary, #666);
}

.empty-state .hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin-top: 8px;
}
</style>
```

#### 6.4 Markdown 渲染

使用 `marked` 库渲染 Markdown：

```bash
npm install marked
```

```typescript
// DocPreviewModal.vue 中使用
import { marked } from 'marked'

const renderedContent = computed(() => {
  if (!props.doc?.content) return ''
  return marked(props.doc.content)
})
```

#### 6.5 后端 API 需求

```
GET /api/docs?expert_id={expert_id}&page=1&size=10

Response:
{
  "items": [
    {
      "id": "uuid",
      "topic_id": "uuid",
      "expert_id": "uuid",
      "user_id": "uuid",
      "title": "文档标题",
      "content": "# Markdown 内容...",
      "content_type": "markdown",
      "status": "final",
      "version": 1,
      "tags": ["报告", "设计"],
      "created_at": "2026-02-20T10:00:00Z",
      "updated_at": "2026-02-20T12:00:00Z"
    }
  ],
  "total": 10,
  "page": 1,
  "size": 10,
  "pages": 1
}

POST /api/docs
{
  "expert_id": "uuid",
  "topic_id": "uuid",
  "title": "新文档",
  "content": "# 内容",
  "content_type": "markdown",
  "tags": ["标签"]
}

PUT /api/docs/:id
{
  "title": "更新标题",
  "content": "更新内容",
  "status": "final"
}
```

#### 6.6 数据库表设计

```sql
CREATE TABLE docs (
  id VARCHAR(32) PRIMARY KEY,
  topic_id VARCHAR(32) NOT NULL,
  expert_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  content_type ENUM('markdown', 'code', 'text') DEFAULT 'markdown',
  status ENUM('draft', 'final', 'archived') DEFAULT 'draft',
  version INT DEFAULT 1,
  tags JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_topic_id (topic_id),
  INDEX idx_expert_id (expert_id),
  INDEX idx_user_id (user_id)
);
```

## 实现步骤

### Phase 1: 基础组件（1 天）
1. 创建 `Pagination.vue` 通用分页组件
2. 创建 `panel.ts` 状态管理
3. 更新 `types/index.ts` 添加分页类型和 Doc 类型

### Phase 2: 右侧面板框架（1 天）
1. 创建 `RightPanel.vue` 容器组件
2. 修改 `ChatView.vue` 布局，集成右侧面板
3. 实现展开/收起动画

### Phase 3: Docs Tab（1-2 天）
1. 创建 `DocsTab.vue` 组件
2. 创建 `DocPreviewModal.vue` 预览/编辑弹窗
3. 后端实现 docs API 和数据库表

### Phase 4: Topics Tab（1-2 天）
1. 创建 `TopicsTab.vue` 组件
2. 后端实现 topics 分页 API
3. 前端集成 API 调用

### Phase 5: Debug Tab（0.5 天）
1. 迁移 `DebugPanel` 到 `DebugTab`
2. 调整样式适配面板容器

---

*文档版本: v2.1*
*创建日期: 2026-02-20*
*更新日期: 2026-02-21*
