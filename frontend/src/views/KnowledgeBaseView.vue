<template>
  <div class="kb-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('knowledgeBase.title') }}</h1>
      <button class="btn-primary" @click="showCreateDialog = true">
        <span class="icon">+</span>
        {{ $t('knowledgeBase.createNew') }}
      </button>
    </div>

    <!-- Search -->
    <div class="kb-filter">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="$t('knowledgeBase.searchPlaceholder')"
      />
    </div>

    <!-- Loading -->
    <div v-if="kbStore.isLoading && kbStore.knowledgeBases.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- Empty State -->
    <div v-else-if="kbStore.knowledgeBases.length === 0" class="empty-state">
      <div class="empty-icon">📚</div>
      <p>{{ $t('knowledgeBase.empty') }}</p>
      <button class="btn-primary" @click="showCreateDialog = true">
        {{ $t('knowledgeBase.addFirst') }}
      </button>
    </div>

    <!-- Knowledge Base Grid -->
    <div v-else class="kb-grid">
      <!-- New KB Card -->
      <div class="kb-card kb-card-new" @click="showCreateDialog = true">
        <div class="kb-card-icon">➕</div>
        <div class="kb-card-name">{{ $t('knowledgeBase.createNew') }}</div>
      </div>

      <!-- KB Cards -->
      <div
        v-for="kb in filteredKnowledgeBases"
        :key="kb.id"
        class="kb-card"
        @click="openKbDetail(kb)"
        @contextmenu.prevent="showContextMenu($event, kb)"
      >
        <div class="kb-card-icon">{{ getKbIcon(kb) }}</div>
        <div class="kb-card-name">{{ kb.name }}</div>
        <div class="kb-card-stats">
          <span>{{ $t('knowledgeBase.pointCount', { count: kb.point_count || 0 }) }}</span>
        </div>
        <div class="kb-card-time">
          {{ formatUpdatedTime(kb.updated_at) }}
        </div>
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <div v-if="showCreateDialog || editingKb" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingKb ? $t('knowledgeBase.editTitle') : $t('knowledgeBase.createTitle') }}
        </h3>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.nameLabel') }}</label>
            <input
              v-model="formData.name"
              type="text"
              class="form-input"
              :placeholder="$t('knowledgeBase.namePlaceholder')"
            />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.descriptionLabel') }}</label>
            <textarea
              v-model="formData.description"
              class="form-textarea"
              :placeholder="$t('knowledgeBase.descriptionPlaceholder')"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDialog">{{ $t('common.cancel') }}</button>
          <button
            class="btn-primary"
            :disabled="!formData.name.trim() || isSubmitting"
            @click="submitForm"
          >
            {{ isSubmitting ? $t('common.saving') : $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div class="context-menu-item" @click="editKb(contextMenu.kb!)">
        {{ $t('common.edit') }}
      </div>
      <div class="context-menu-item danger" @click="deleteKb(contextMenu.kb!)">
        {{ $t('common.delete') }}
      </div>
    </div>

    <!-- Delete Confirm Dialog -->
    <div v-if="deletingKb" class="dialog-overlay">
      <div class="dialog dialog-small">
        <h3 class="dialog-title">{{ $t('knowledgeBase.deleteConfirm') }}</h3>
        <div class="dialog-body">
          <p>{{ $t('knowledgeBase.deleteConfirmMessage', { name: deletingKb.name }) }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="deletingKb = null">{{ $t('common.cancel') }}</button>
          <button class="btn-danger" @click="confirmDelete">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { KnowledgeBase } from '@/types'

const { t } = useI18n()
const router = useRouter()
const kbStore = useKnowledgeBaseStore()

// State
const searchQuery = ref('')
const showCreateDialog = ref(false)
const editingKb = ref<KnowledgeBase | null>(null)
const deletingKb = ref<KnowledgeBase | null>(null)
const isSubmitting = ref(false)
const formData = ref({
  name: '',
  description: '',
})

// Context menu
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  kb: null as KnowledgeBase | null,
})

// Computed
const filteredKnowledgeBases = computed(() => {
  if (!searchQuery.value) return kbStore.knowledgeBases
  const query = searchQuery.value.toLowerCase()
  return kbStore.knowledgeBases.filter(
    kb =>
      kb.name.toLowerCase().includes(query) ||
      kb.description?.toLowerCase().includes(query)
  )
})

// Methods
const getKbIcon = (kb: KnowledgeBase) => {
  // 可以根据知识库名称或类型返回不同图标
  const icons = ['📚', '📖', '📁', '📝', '🔧', '💡', '📊', '🎯']
  const index = kb.id % icons.length
  return icons[index]
}

const formatUpdatedTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return t('tasks.today')
  if (days === 1) return t('tasks.yesterday')
  return t('knowledgeBase.updatedAgo', { time: t('tasks.daysAgo', { count: days }) })
}

const openKbDetail = (kb: KnowledgeBase) => {
  router.push({ name: 'knowledge-detail', params: { kbId: kb.id } })
}

const closeDialog = () => {
  showCreateDialog.value = false
  editingKb.value = null
  formData.value = { name: '', description: '' }
}

const submitForm = async () => {
  if (!formData.value.name.trim()) return

  isSubmitting.value = true
  try {
    if (editingKb.value) {
      await kbStore.updateKnowledgeBase(editingKb.value.id, {
        name: formData.value.name,
        description: formData.value.description,
      })
    } else {
      await kbStore.createKnowledgeBase({
        name: formData.value.name,
        description: formData.value.description,
      })
    }
    closeDialog()
  } catch (error) {
    console.error('Failed to save knowledge base:', error)
  } finally {
    isSubmitting.value = false
  }
}

const showContextMenu = (event: MouseEvent, kb: KnowledgeBase) => {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    kb,
  }
}

const hideContextMenu = () => {
  contextMenu.value.visible = false
  contextMenu.value.kb = null
}

const editKb = (kb: KnowledgeBase) => {
  hideContextMenu()
  editingKb.value = kb
  formData.value = {
    name: kb.name,
    description: kb.description || '',
  }
}

const deleteKb = (kb: KnowledgeBase) => {
  hideContextMenu()
  deletingKb.value = kb
}

const confirmDelete = async () => {
  if (!deletingKb.value) return

  try {
    await kbStore.deleteKnowledgeBase(deletingKb.value.id)
    deletingKb.value = null
  } catch (error) {
    console.error('Failed to delete knowledge base:', error)
  }
}

// Click outside to close context menu
const handleClickOutside = () => {
  hideContextMenu()
}

// Lifecycle
onMounted(() => {
  kbStore.loadKnowledgeBases()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.kb-view {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

/* Filter */
.kb-filter {
  margin-bottom: 20px;
}

.search-input {
  width: 100%;
  max-width: 400px;
  padding: 10px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
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

/* Knowledge Base Grid */
.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}

.kb-card {
  padding: 24px 16px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-height: 160px;
}

.kb-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.kb-card-new {
  background: var(--secondary-bg, #f8f9fa);
  border-style: dashed;
}

.kb-card-new:hover {
  background: var(--primary-light, #e3f2fd);
}

.kb-card-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.kb-card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin-bottom: 8px;
  word-break: break-word;
}

.kb-card-stats {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.kb-card-time {
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

/* Dialog */
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

.dialog-small {
  max-width: 400px;
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
.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
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

.btn-danger {
  padding: 8px 16px;
  background: #f44336;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.btn-danger:hover {
  background: #d32f2f;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 1001;
  min-width: 120px;
}

.context-menu-item {
  padding: 10px 16px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #333);
}

.context-menu-item:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.context-menu-item.danger {
  color: #f44336;
}

/* Responsive */
@media (max-width: 768px) {
  .kb-view {
    padding: 16px;
  }

  .kb-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .view-header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }
}

/* Scrollbar */
.kb-grid::-webkit-scrollbar {
  width: 6px;
}

.kb-grid::-webkit-scrollbar-track {
  background: transparent;
}

.kb-grid::-webkit-scrollbar-thumb {
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
}
</style>
