<template>
  <div class="context-header">
    <div class="context-breadcrumb">
      <template v-for="(item, idx) in breadcrumbs" :key="idx">
        <span v-if="idx > 0" class="breadcrumb-sep">/</span>
        <router-link v-if="item.to && idx < breadcrumbs.length - 1" :to="item.to" class="breadcrumb-link">
          {{ item.label }}
        </router-link>
        <span v-else class="breadcrumb-current">{{ item.label }}</span>
      </template>
    </div>
    <div class="context-main">
      <div class="context-info">
        <h1 class="context-title">{{ title }}</h1>
        <p v-if="description" class="context-desc">{{ description }}</p>
        <div v-if="$slots.meta" class="context-meta">
          <slot name="meta" />
        </div>
      </div>
      <div v-if="$slots.actions" class="context-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface BreadcrumbItem {
  label: string
  to?: string
}

defineProps<{
  breadcrumbs: BreadcrumbItem[]
  title: string
  description?: string
}>()
</script>

<style scoped>
.context-header { margin-bottom: 24px; }
.context-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #909399; margin-bottom: 12px; }
.breadcrumb-sep { color: #c0c4cc; }
.breadcrumb-link { color: #909399; text-decoration: none; }
.breadcrumb-link:hover { color: #409eff; }
.breadcrumb-current { color: #303133; font-weight: 500; }
.context-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.context-title { font-size: 24px; font-weight: 600; margin: 0; line-height: 1.3; }
.context-desc { color: #606266; margin: 8px 0 0 0; font-size: 14px; }
.context-meta { display: flex; gap: 12px; align-items: center; margin-top: 8px; font-size: 13px; color: #909399; }
.context-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: flex-start; padding-top: 4px; }

@media (max-width: 640px) {
  .context-main { flex-direction: column; }
  .context-actions { width: 100%; }
}
</style>
