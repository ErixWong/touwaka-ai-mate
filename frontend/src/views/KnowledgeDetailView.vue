<template>
  <div class="kb-detail-view">
    <!-- Header -->
    <div class="detail-header">
      <div class="header-left">
        <button class="btn-back" @click="goBack">
          <span class="back-icon">←</span>
          {{ $t('knowledgeBase.backToList') }}
        </button>
        <h1 class="kb-title">{{ kbStore.currentKb?.name }}</h1>
      </div>
      <div class="header-actions">
        <button class="btn-action" @click="showSearchDialog = true">
          <span>🔍</span>
          {{ $t('knowledgeBase.search') }}
        </button>
        <button class="btn-action" @click="showArticleDialog = true">
          <span>📝</span>
          {{ $t('knowledgeBase.newArticle') }}
        </button>
        <button class="btn-action btn-revectorize" @click="handleRevectorize" :disabled="isRevectorizing">
          <span>🔄</span>
          {{ isRevectorizing ? $t('knowledgeBase.revectorizing') : $t('knowledgeBase.revectorize') }}
        </button>
        <!-- 进度显示 -->
        <div v-if="isRevectorizing && revectorizeProgress.total > 0" class="revectorize-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (revectorizeProgress.current / revectorizeProgress.total * 100) + '%' }"></div>
          </div>
          <div class="progress-text">
            {{ revectorizeProgress.current }} / {{ revectorizeProgress.total }}
            (成功: {{ revectorizeProgress.success }}, 失败: {{ revectorizeProgress.failed }})
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- Main Content -->
    <div v-else class="detail-content">
      <!-- Left: Article Tree -->
      <div class="tree-panel">
        <div class="tree-header">
          <h3>{{ $t('knowledgeBase.articleTree') }}</h3>
          <div class="tree-actions">
            <button class="btn-icon" @click="expandAll" :title="$t('knowledgeBase.expandAll')">+⊟</button>
            <button class="btn-icon" @click="collapseAll" :title="$t('knowledgeBase.collapseAll')">⊟-</button>
          </div>
        </div>

        <!-- Tree -->
        <div class="tree-content">
          <div v-if="kbStore.knowledgeTree.length === 0" class="tree-empty">
            {{ $t('knowledgeBase.noArticles') }}
          </div>
          <div v-else class="knowledge-tree">
            <KnowledgeTreeNode
              v-for="node in kbStore.knowledgeTree"
              :key="treeKey + '-' + node.id"
              :node="node"
              :level="0"
              :selected-id="selectedKnowledge?.id"
              :force-expand="forceExpand"
              @select="selectKnowledge"
              @edit="editKnowledge"
              @delete="deleteKnowledge"
              @add-child="addChildKnowledge"
            />
          </div>
        </div>
      </div>

      <!-- Right: Content Panel -->
      <div class="content-panel">
        <!-- Empty State -->
        <div v-if="!selectedKnowledge" class="content-empty">
          <div class="empty-icon">📖</div>
          <p>{{ $t('knowledgeBase.selectArticleHint') || 'Select an article from the left' }}</p>
        </div>

        <!-- Knowledge Content -->
        <div v-else class="content-main">
          <div class="content-header">
            <h2 class="content-title">{{ selectedKnowledge.title }}</h2>
            <button class="btn-edit-title" @click="editCurrentKnowledge" :title="$t('knowledgeBase.article.edit')">
              ✏️
            </button>
            <div class="content-meta">
              <span class="meta-item">
                {{ $t('knowledgeBase.status.' + selectedKnowledge.status) }}
              </span>
              <span class="meta-item">
                {{ $t('knowledgeBase.sourceType.' + selectedKnowledge.source_type) }}
              </span>
              <span class="meta-item">
                {{ $t('knowledgeBase.point.tokenCount', { count: totalTokens }) }}
              </span>
            </div>
          </div>

          <!-- Summary -->
          <div v-if="selectedKnowledge.summary" class="content-section">
            <h4 class="section-title">{{ $t('expert.introduction') }}</h4>
            <p class="summary-text">{{ selectedKnowledge.summary }}</p>
          </div>

          <!-- Knowledge Points -->
          <div class="content-section">
            <div class="section-header">
              <h4 class="section-title">{{ $t('knowledgeBase.point.title') }}</h4>
              <button class="btn-sm" @click="showPointDialog = true">
                + {{ $t('knowledgeBase.point.create') }}
              </button>
            </div>

            <div v-if="kbStore.currentPoints.length === 0" class="points-empty">
              {{ $t('knowledgeBase.point.noPoints') }}
            </div>
            <div v-else class="points-list">
              <div
                v-for="point in kbStore.currentPoints"
                :key="point.id"
                class="point-card"
                :class="{ 'point-vectorized': (point as any).is_vectorized }"
                @click="selectPoint(point)"
              >
                <div class="point-header">
                  <div v-if="point.title" class="point-title">{{ point.title }}</div>
                  <div class="point-status">
                    <span v-if="(point as any).is_vectorized" class="status-badge vectorized" :title="$t('knowledgeBase.point.vectorized')">
                      ✅ {{ $t('knowledgeBase.point.vectorized') }}
                    </span>
                    <span v-else class="status-badge not-vectorized" :title="$t('knowledgeBase.point.notVectorized')">
                      ⏳ {{ $t('knowledgeBase.point.notVectorized') }}
                    </span>
                  </div>
                </div>
                <div class="point-content" v-html="renderMarkdown(point.content)"></div>
                <div class="point-meta">
                  <span>{{ $t('knowledgeBase.point.tokenCount', { count: point.token_count }) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Search Dialog -->
    <div v-if="showSearchDialog" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">{{ $t('knowledgeBase.search') }}</h3>
        <div class="dialog-body">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="$t('knowledgeBase.searchHint')"
            @keyup.enter="performSearch"
          />

          <div v-if="kbStore.isSearching" class="search-loading">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="kbStore.searchResults.length > 0" class="search-results">
            <h4>{{ $t('knowledgeBase.searchResult.title') }}</h4>
            <div
              v-for="result in kbStore.searchResults"
              :key="result.point.id"
              class="search-result-item"
            >
              <div class="result-score">
                {{ Math.round(result.score * 100) }}%
              </div>
              <div class="result-content">
                <div class="result-location">
                  {{ result.knowledge.title }}
                </div>
                <div class="result-text" v-html="renderMarkdown(result.point.content)"></div>
              </div>
            </div>
          </div>

          <div v-else-if="searchQuery && hasSearched" class="search-empty">
            {{ $t('knowledgeBase.searchResult.empty') }}
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeSearchDialog">{{ $t('common.close') }}</button>
          <button class="btn-primary" @click="performSearch" :disabled="!searchQuery.trim() || kbStore.isSearching">
            {{ $t('knowledgeBase.search') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Article Dialog -->
    <div v-if="showArticleDialog" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingKnowledge ? $t('knowledgeBase.article.edit') : $t('knowledgeBase.article.create') }}
        </h3>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.article.titlePlaceholder') }}</label>
            <input v-model="articleForm.title" type="text" class="form-input" />
          </div>
          <div v-if="!editingKnowledge" class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.article.parent') }}</label>
            <select v-model="articleForm.parent_id" class="form-select">
              <option :value="undefined">{{ $t('knowledgeBase.article.noParent') }}</option>
              <option v-for="k in flatKnowledgeList" :key="k.id" :value="k.id">
                {{ k.title }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.article.summary') }}</label>
            <textarea v-model="articleForm.summary" class="form-textarea" rows="3"></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeArticleDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-primary" @click="submitArticle" :disabled="!articleForm.title.trim()">
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Point Dialog -->
    <div v-if="showPointDialog" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">
          {{ editingPoint ? $t('knowledgeBase.point.edit') : $t('knowledgeBase.point.create') }}
        </h3>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.point.titleLabel') }}</label>
            <input v-model="pointForm.title" type="text" class="form-input" :placeholder="$t('knowledgeBase.point.titlePlaceholder')" />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.point.contentLabel') }}</label>
            <textarea
              v-model="pointForm.content"
              class="form-textarea"
              rows="8"
              :placeholder="$t('knowledgeBase.point.contentPlaceholder')"
            ></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.point.contextLabel') }}</label>
            <textarea
              v-model="pointForm.context"
              class="form-textarea"
              rows="2"
              :placeholder="$t('knowledgeBase.point.contextPlaceholder')"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closePointDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-primary" @click="submitPoint" :disabled="!pointForm.content.trim()">
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import KnowledgeTreeNode from '@/components/KnowledgeTreeNode.vue'
import type { Knowledge, KnowledgePoint } from '@/types'
import { marked } from 'marked'
import { knowledgeBaseApi } from '@/api/services'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const kbStore = useKnowledgeBaseStore()

// State
const isLoading = ref(true)
const selectedKnowledge = ref<Knowledge | null>(null)
const selectedPoint = ref<KnowledgePoint | null>(null)

// Tree expansion state
const forceExpand = ref<boolean | null>(null)
const treeKey = ref(0)

// Dialogs
const showSearchDialog = ref(false)
const showArticleDialog = ref(false)
const showPointDialog = ref(false)
const editingKnowledge = ref<Knowledge | null>(null)
const editingPoint = ref<KnowledgePoint | null>(null)
const isRevectorizing = ref(false)
const revectorizeProgress = ref({ total: 0, success: 0, failed: 0, current: 0, status: '' })
let revectorizeJobId = ''

// Search
const searchQuery = ref('')
const hasSearched = ref(false)

// Forms
const articleForm = ref({
  title: '',
  parent_id: undefined as string | undefined,
  summary: '',
})

const pointForm = ref({
  title: '',
  content: '',
  context: '',
})

// Helper function to get route param as string
const getRouteParam = (param: string | string[] | undefined): string | undefined => {
  if (param === undefined) return undefined
  return Array.isArray(param) ? param[0] : param
}

// Computed
// 支持字符串(UUID)和数字类型的 kbId
// 注意：kbId 可能为 undefined（直接访问 URL 时），但组件会在 onMounted 中处理
const kbId = computed(() => getRouteParam(route.params.kbId))

// 获取确保非空的 kbId，用于 API 调用
const requireKbId = (): string => {
  const id = kbId.value
  if (!id) {
    throw new Error('Knowledge base ID is required')
  }
  return id
}

const flatKnowledgeList = computed(() => {
  const flatten = (nodes: Knowledge[]): Knowledge[] => {
    return nodes.reduce<Knowledge[]>((acc, node) => {
      acc.push(node)
      if (node.children) {
        acc.push(...flatten(node.children))
      }
      return acc
    }, [])
  }
  return flatten(kbStore.knowledgeTree)
})

const totalTokens = computed(() => {
  return kbStore.currentPoints.reduce((sum, p) => sum + p.token_count, 0)
})

// Methods
const handleRevectorize = async () => {
  if (!kbId.value) return

  if (!confirm('确定要重新向量化所有知识点吗？这将使用当前配置的嵌入模型重新生成所有向量。')) {
    return
  }

  isRevectorizing.value = true
  revectorizeProgress.value = { total: 0, success: 0, failed: 0, current: 0, status: 'starting' }

  try {
    // 启动重新向量化任务
    const result = await knowledgeBaseApi.revectorize(kbId.value)
    revectorizeJobId = result.job_id

    // 轮询获取进度
    const pollProgress = async () => {
      if (!revectorizeJobId) return

      try {
        const progress = await knowledgeBaseApi.getRevectorizeProgress(requireKbId(), revectorizeJobId)
        revectorizeProgress.value = progress

        if (progress.status === 'running') {
          // 继续轮询
          setTimeout(pollProgress, 1000)
        } else if (progress.status === 'completed') {
          // 完成
          alert(`重新向量化完成！\n总计: ${progress.total}\n成功: ${progress.success}\n失败: ${progress.failed}\n向量维度: ${progress.embedding_dim}`)
          // 刷新知识点列表（如果有选中文章）
          if (selectedKnowledge.value?.id) {
            await kbStore.loadKnowledgePoints(requireKbId(), selectedKnowledge.value.id)
          }
          isRevectorizing.value = false
          revectorizeJobId = ''
        }
      } catch (e) {
        console.error('获取进度失败:', e)
      }
    }

    // 开始轮询
    pollProgress()
  } catch (error: any) {
    alert('重新向量化失败: ' + (error.message || '未知错误'))
    isRevectorizing.value = false
    revectorizeJobId = ''
  }
}

const goBack = () => {
  router.push({ name: 'knowledge' })
}

const renderMarkdown = (content: string) => {
  try {
    return marked(content)
  } catch {
    return content
  }
}

const selectKnowledge = async (knowledge: Knowledge) => {
  selectedKnowledge.value = knowledge
  selectedPoint.value = null
  // Load points for this knowledge
  await kbStore.loadKnowledge(requireKbId(), knowledge.id)
}

const selectPoint = (point: KnowledgePoint) => {
  selectedPoint.value = point
}

const expandAll = () => {
  forceExpand.value = true
  treeKey.value++ // Force re-render
}

const collapseAll = () => {
  forceExpand.value = false
  treeKey.value++ // Force re-render
}

// Article operations
const editCurrentKnowledge = () => {
  if (selectedKnowledge.value) {
    editKnowledge(selectedKnowledge.value)
  }
}

const editKnowledge = (knowledge: Knowledge) => {
  editingKnowledge.value = knowledge
  articleForm.value = {
    title: knowledge.title,
    parent_id: knowledge.parent_id ?? undefined,
    summary: knowledge.summary || '',
  }
  showArticleDialog.value = true
}

const addChildKnowledge = (parent: Knowledge) => {
  editingKnowledge.value = null
  articleForm.value = {
    title: '',
    parent_id: parent.id ?? undefined,
    summary: '',
  }
  showArticleDialog.value = true
}

const deleteKnowledge = async (knowledge: Knowledge) => {
  if (!confirm(t('knowledgeBase.article.deleteConfirm', { title: knowledge.title }))) return

  try {
    await kbStore.deleteKnowledge(requireKbId(), knowledge.id)
    if (selectedKnowledge.value?.id === knowledge.id) {
      selectedKnowledge.value = null
    }
  } catch (error) {
    console.error('Failed to delete knowledge:', error)
  }
}

const closeArticleDialog = () => {
  showArticleDialog.value = false
  editingKnowledge.value = null
  articleForm.value = { title: '', parent_id: undefined as string | undefined, summary: '' }
}

const submitArticle = async () => {
  if (!articleForm.value.title.trim()) return

  try {
    if (editingKnowledge.value) {
      const updated = await kbStore.updateKnowledge(requireKbId(), editingKnowledge.value.id, {
        title: articleForm.value.title,
        summary: articleForm.value.summary,
      })
      // 更新当前选中的文章
      if (selectedKnowledge.value?.id === editingKnowledge.value.id) {
        selectedKnowledge.value = updated
      }
    } else {
      await kbStore.createKnowledge(requireKbId(), {
        title: articleForm.value.title,
        parent_id: articleForm.value.parent_id,
        summary: articleForm.value.summary,
      })
    }
    closeArticleDialog()
  } catch (error) {
    console.error('Failed to save knowledge:', error)
  }
}

// Point operations
const closePointDialog = () => {
  showPointDialog.value = false
  editingPoint.value = null
  pointForm.value = { title: '', content: '', context: '' }
}

const submitPoint = async () => {
  if (!pointForm.value.content.trim() || !selectedKnowledge.value) return

  try {
    if (editingPoint.value) {
      await kbStore.updateKnowledgePoint(
        requireKbId(),
        selectedKnowledge.value.id,
        editingPoint.value.id,
        {
          title: pointForm.value.title,
          content: pointForm.value.content,
          context: pointForm.value.context,
        }
      )
    } else {
      await kbStore.createKnowledgePoint(requireKbId(), selectedKnowledge.value.id, {
        title: pointForm.value.title,
        content: pointForm.value.content,
        context: pointForm.value.context,
      })
    }
    closePointDialog()
  } catch (error) {
    console.error('Failed to save knowledge point:', error)
  }
}

// Search
const performSearch = async () => {
  if (!searchQuery.value.trim()) return

  hasSearched.value = true
  await kbStore.search(requireKbId(), searchQuery.value)
}

const closeSearchDialog = () => {
  showSearchDialog.value = false
  searchQuery.value = ''
  hasSearched.value = false
  kbStore.clearSearchResults()
}

// Initialize
onMounted(async () => {
  try {
    const id = requireKbId()
    await kbStore.loadKnowledgeBase(id)
    await kbStore.loadKnowledgeTree(id)
  } catch (error) {
    console.error('Failed to load knowledge base:', error)
    goBack()
  } finally {
    isLoading.value = false
  }
})
</script>

<style scoped>
.kb-detail-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.btn-back {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-secondary, #666);
}

.btn-back:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.kb-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--secondary-bg, #f5f5f5);
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-secondary, #666);
}

.btn-action:hover {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.btn-revectorize {
  background: var(--accent-bg, #fff3e0);
  color: var(--accent-color, #ff9800);
}

.btn-revectorize:hover {
  background: var(--accent-light, #ffe0b2);
  color: var(--accent-dark, #f57c00);
}

.btn-revectorize:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 重新向量化进度 */
.revectorize-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  padding: 8px;
  background: var(--secondary-bg, #f5f5f5);
  border-radius: 6px;
}

.progress-bar {
  height: 8px;
  background: var(--border-color, #e0e0e0);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-color, #ff9800);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--text-secondary, #666);
  text-align: center;
}

/* Main Content */
.detail-content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* Tree Panel */
.tree-panel {
  width: 280px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
}

.tree-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.tree-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.tree-actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-icon:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.tree-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary, #999);
  font-size: 14px;
}

/* Content Panel */
.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--secondary-bg, #f8f9fa);
}

.content-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary, #999);
}

.content-empty .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.content-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.content-header {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.content-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary, #333);
}

.btn-edit-title {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 16px;
  opacity: 0.6;
  transition: opacity 0.2s, transform 0.2s;
  margin-left: 8px;
}

.btn-edit-title:hover {
  opacity: 1;
  transform: scale(1.1);
}

.content-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.content-section {
  background: var(--card-bg, #fff);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--text-primary, #333);
}

.section-header .section-title {
  margin: 0;
}

.summary-text {
  color: var(--text-secondary, #666);
  line-height: 1.6;
  margin: 0;
}

.btn-sm {
  padding: 6px 12px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-sm:hover {
  opacity: 0.9;
}

.points-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary, #999);
}

.points-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.point-card {
  padding: 16px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.point-card:hover {
  background: var(--primary-light, #e3f2fd);
}

.point-card.point-vectorized {
  border-left-color: #4caf50;
}

.point-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.point-title {
  font-weight: 600;
  color: var(--text-primary, #333);
  flex: 1;
}

.point-status {
  flex-shrink: 0;
  margin-left: 12px;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  white-space: nowrap;
}

.status-badge.vectorized {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.not-vectorized {
  background: #fff3e0;
  color: #e65100;
}

.point-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary, #666);
}

.point-content :deep(p) {
  margin: 0 0 8px 0;
}

.point-content :deep(code) {
  background: var(--border-color, #e0e0e0);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.point-meta {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}

.dialog-large {
  max-width: 640px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  max-height: 60vh;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* Search */
.search-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 16px;
}

.search-loading,
.search-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary, #666);
}

.search-results h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.search-result-item {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  margin-bottom: 12px;
}

.result-score {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color, #2196f3);
  min-width: 48px;
}

.result-content {
  flex: 1;
}

.result-location {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 4px;
}

.result-text {
  font-size: 14px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
}

/* Form */
.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--text-primary, #333);
}

.form-input,
.form-textarea,
.form-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
}

/* Buttons */
.btn-primary {
  padding: 8px 16px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--secondary-bg, #f5f5f5);
}

/* Loading */
.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
}
</style>
