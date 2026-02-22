# 前端组件

## 右侧面板组件

对话页面右侧的多功能面板，采用 Tab 页形式组织多个功能模块。

### 基本使用

```vue
<template>
  <RightPanel 
    @topic-select="handleTopicSelect"
    @doc-select="handleDocSelect"
  />
</template>

<script setup>
import RightPanel from '@/components/panel/RightPanel.vue'
import { usePanelStore } from '@/stores/panel'

const panelStore = usePanelStore()

// 切换面板展开/收起
panelStore.toggleCollapse()

// 切换 Tab
panelStore.setActiveTab('docs')  // 'docs' | 'topics' | 'debug'
</script>
```

### Tab 页说明

| Tab | 组件 | 用途 |
|-----|------|------|
| Docs | `DocsTab.vue` | 展示阶段性成果文档（Markdown） |
| Topics | `TopicsTab.vue` | 历史话题列表 |
| Debug | `DebugTab.vue` | 调试信息（仅管理员可见） |

### 文件结构

```
frontend/src/components/panel/
├── RightPanel.vue    # 面板容器
├── DocsTab.vue       # 文档 Tab
├── TopicsTab.vue     # 话题 Tab
└── DebugTab.vue      # 调试 Tab
```

### 状态管理

面板状态通过 Pinia Store 管理：

```typescript
// stores/panel.ts
export const usePanelStore = defineStore('panel', {
  state: () => ({
    collapsed: false,
    activeTab: 'docs' as 'docs' | 'topics' | 'debug'
  }),
  actions: {
    toggleCollapse() { this.collapsed = !this.collapsed },
    setActiveTab(tab) { this.activeTab = tab }
  }
})
```

---

## 通用分页组件

### 基本使用

```vue
<template>
  <Pagination
    :current-page="pagination.page"
    :total-pages="pagination.pages"
    :total="pagination.total"
    @change="handlePageChange"
  />
</template>

<script setup>
import Pagination from '@/components/Pagination.vue'

const pagination = ref({ page: 1, size: 10, total: 0, pages: 0 })

const handlePageChange = (page: number) => {
  loadData(page)
}
</script>
```

### 分页类型定义

```typescript
// types/index.ts

interface PageQuery {
  page: number      // 页码，从 1 开始
  size: number      // 每页条数，默认 10
  sort_by?: string  // 排序字段
  sort_order?: 'asc' | 'desc'
}

interface PageResponse<T> {
  items: T[]        // 数据列表
  total: number     // 总条数
  page: number      // 当前页码
  size: number      // 每页条数
  pages: number     // 总页数
}
```

### Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `current-page` | number | 是 | 当前页码 |
| `total-pages` | number | 是 | 总页数 |
| `total` | number | 否 | 总条数（用于显示） |

### Events

| Event | 参数 | 说明 |
|-------|------|------|
| `change` | page: number | 页码变化时触发 |

---

*最后更新: 2026-02-22*
