<template>
  <div class="solution-detail-view">
    <!-- Loading -->
    <div v-if="isLoading" class="loading-state">
      {{ $t('common.loading', '加载中...') }}
    </div>

    <!-- Not Found -->
    <div v-else-if="!solution" class="empty-state">
      <div class="empty-icon">🔍</div>
      <p>{{ $t('solutions.notFound', '解决方案不存在') }}</p>
      <button class="btn-primary" @click="goBack">
        {{ $t('common.back', '返回') }}
      </button>
    </div>

    <!-- Solution Detail -->
    <template v-else>
      <div class="detail-header">
        <div class="header-left">
          <button class="back-btn" @click="goBack" :title="$t('common.back', '返回')">
            ←
          </button>
          <div class="header-info">
            <h1 class="detail-title">{{ solution.name }}</h1>
            <div class="detail-meta">
              <span v-if="solution.slug" class="meta-slug">{{ solution.slug }}</span>
              <span class="meta-time">{{ formatTime(solution.updated_at) }}</span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <button class="btn-primary" @click="createTaskFromSolution" :disabled="isCreatingTask">
            {{ isCreatingTask ? $t('common.creating', '创建中...') : $t('solutions.createTask', '创建任务') }}
          </button>
        </div>
      </div>

      <!-- Tags -->
      <div class="detail-tags" v-if="solution.tags && solution.tags.length > 0">
        <span
          v-for="tag in solution.tags"
          :key="tag"
          class="detail-tag"
        >
          {{ tag }}
        </span>
      </div>

      <!-- Description -->
      <div class="detail-section" v-if="solution.description">
        <h3 class="section-title">{{ $t('solutions.description', '描述') }}</h3>
        <p class="section-content">{{ solution.description }}</p>
      </div>

      <!-- Guide (Markdown Content) -->
      <div class="detail-section guide-section">
        <h3 class="section-title">{{ $t('solutions.guide', '执行指南') }}</h3>
        <div class="guide-content markdown-body" v-html="renderedGuide"></div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import apiClient from '@/api/client'
import { useToastStore } from '@/stores/toast'

interface Solution {
  id: number
  name: string
  slug: string
  description: string | null
  guide: string | null
  tags: string[] | null
  is_active: boolean
  created_at: string
  updated_at: string
}

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useToastStore()

// State
const solution = ref<Solution | null>(null)
const isLoading = ref(true)
const isCreatingTask = ref(false)

// Computed
const renderedGuide = computed(() => {
  if (!solution.value?.guide) return ''
  try {
    const rawHtml = marked(solution.value.guide) as string
    return DOMPurify.sanitize(rawHtml)
  } catch {
    return solution.value.guide
  }
})

// Methods
const loadSolution = async () => {
  const id = route.params.id as string
  if (!id) {
    isLoading.value = false
    return
  }

  isLoading.value = true
  try {
    const response = await apiClient.get(`/solutions/${id}`)
    solution.value = response.data.data
  } catch (error) {
    console.error('Failed to load solution:', error)
    solution.value = null
    toast.error(t('solutions.loadFailed', '加载解决方案失败'))
  } finally {
    isLoading.value = false
  }
}

const goBack = () => {
  router.push({ name: 'solutions' })
}

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const createTaskFromSolution = async () => {
  if (!solution.value) return

  isCreatingTask.value = true
  try {
    const response = await apiClient.post(`/solutions/${solution.value.id}/tasks`, {
      title: `任务: ${solution.value.name}`,
    })
    
    // Navigate to the created task
    const taskId = response.data.data?.task?.id
    if (taskId) {
      router.push({ name: 'task-detail', params: { id: taskId } })
    } else {
      // Fallback to task list
      router.push({ name: 'tasks' })
    }
  } catch (error) {
    console.error('Failed to create task:', error)
    toast.error(t('solutions.createTaskFailed', '创建任务失败'))
  } finally {
    isCreatingTask.value = false
  }
}

// Lifecycle
onMounted(() => {
  loadSolution()
})
</script>

<style scoped>
.solution-detail-view {
  padding: 16px 24px;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
}

/* Loading and Empty */
.loading-state,
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-secondary, #666);
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin-bottom: 24px;
}

/* Header */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: 16px;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.back-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: #f1f5f9;
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
  color: var(--text-secondary, #666);
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.back-btn:hover {
  background: #e2e8f0;
  color: var(--text-primary, #333);
}

.header-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: #1e293b;
  line-height: 1.3;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.meta-slug {
  font-family: monospace;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
}

.meta-time {
  color: var(--text-tertiary, #9aa5b1);
}

.header-actions {
  flex-shrink: 0;
}

/* Tags */
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.detail-tag {
  font-size: 12px;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 16px;
  white-space: nowrap;
}

/* Sections */
.detail-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title::before {
  content: '';
  width: 3px;
  height: 16px;
  background: #10b981;
  border-radius: 2px;
}

.section-content {
  font-size: 14px;
  color: var(--text-secondary, #5a6a7a);
  line-height: 1.6;
  margin: 0;
}

/* Guide Section */
.guide-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.guide-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.04);
}

/* Markdown Styles */
.markdown-body {
  font-size: 14px;
  line-height: 1.7;
  color: #374151;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
  color: #1e293b;
}

.markdown-body :deep(h1) { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
.markdown-body :deep(h2) { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
.markdown-body :deep(h3) { font-size: 1.25em; }
.markdown-body :deep(h4) { font-size: 1em; }

.markdown-body :deep(p) {
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin-top: 0;
  margin-bottom: 16px;
  padding-left: 2em;
}

.markdown-body :deep(li) {
  margin-bottom: 4px;
}

.markdown-body :deep(code) {
  padding: .2em .4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
}

.markdown-body :deep(pre) {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
  margin-bottom: 16px;
}

.markdown-body :deep(pre code) {
  background-color: transparent;
  padding: 0;
  font-size: 100%;
}

.markdown-body :deep(blockquote) {
  padding: 0 1em;
  color: #57606a;
  border-left: .25em solid #d0d7de;
  margin: 0 0 16px 0;
}

.markdown-body :deep(table) {
  border-spacing: 0;
  border-collapse: collapse;
  display: block;
  width: 100%;
  max-width: 100%;
  margin-bottom: 16px;
  overflow: auto;
}

.markdown-body :deep(table th),
.markdown-body :deep(table td) {
  padding: 6px 13px;
  border: 1px solid #d0d7de;
}

.markdown-body :deep(table th) {
  font-weight: 600;
  background-color: #f6f8fa;
}

.markdown-body :deep(table tr) {
  background-color: #ffffff;
  border-top: 1px solid #d0d7de;
}

.markdown-body :deep(table tr:nth-child(2n)) {
  background-color: #f6f8fa;
}

.markdown-body :deep(hr) {
  height: .25em;
  padding: 0;
  margin: 24px 0;
  background-color: #e1e4e8;
  border: 0;
}

.markdown-body :deep(a) {
  color: #0969da;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(img) {
  max-width: 100%;
  box-sizing: content-box;
  background-color: #fff;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
}

.btn-primary:hover:not(:disabled) {
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}
</style>