<template>
  <div class="solutions-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('solutions.title', '解决方案') }}</h1>
      <button v-if="isAdmin" class="btn-create" @click="openCreateDialog">
        + {{ $t('solutions.create', '新建解决方案') }}
      </button>
    </div>

    <!-- Search and Filter -->
    <div class="solutions-filter">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="$t('solutions.searchPlaceholder', '搜索解决方案...')"
        @input="debouncedSearch"
      />
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-state">
      {{ $t('common.loading', '加载中...') }}
    </div>

    <!-- Empty State -->
    <div v-else-if="solutions.length === 0" class="empty-state">
      <div class="empty-icon">🎯</div>
      <p>{{ $t('solutions.empty', '暂无解决方案') }}</p>
      <button v-if="isAdmin" class="btn-primary" @click="openCreateDialog">
        {{ $t('solutions.createFirst', '创建第一个解决方案') }}
      </button>
    </div>

    <!-- Solutions Grid -->
    <template v-else>
      <div class="solutions-grid">
        <div
          v-for="solution in solutions"
          :key="solution.id"
          class="solution-card"
          @click="openSolutionDetail(solution)"
        >
          <div class="solution-card-header">
            <div class="solution-card-icon">🎯</div>
            <div class="solution-card-name">{{ solution.name }}</div>
            <button v-if="isAdmin" class="card-edit-btn" @click.stop="openEditDialog(solution)">
              ✏️
            </button>
          </div>
          <div class="solution-card-desc" v-if="solution.description">
            {{ solution.description }}
          </div>
          <div class="solution-card-tags" v-if="solution.tags && solution.tags.length > 0">
            <span
              v-for="tag in solution.tags.slice(0, 3)"
              :key="tag"
              class="solution-tag"
            >
              {{ tag }}
            </span>
            <span v-if="solution.tags.length > 3" class="solution-tag-more">
              +{{ solution.tags.length - 3 }}
            </span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div class="pagination" v-if="totalPages > 1">
        <button
          class="page-btn"
          :disabled="currentPage === 1"
          @click="changePage(currentPage - 1)"
        >
          ← {{ $t('pagination.prev', '上一页') }}
        </button>
        <div class="page-info">
          <span>{{ $t('pagination.info', { total: totalCount }, `共 ${totalCount} 条`) }}</span>
        </div>
        <button
          class="page-btn"
          :disabled="currentPage === totalPages"
          @click="changePage(currentPage + 1)"
        >
          {{ $t('pagination.next', '下一页') }} →
        </button>
      </div>
    </template>

    <!-- Create/Edit Dialog -->
    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ isEditing ? $t('solutions.editSolution', '编辑解决方案') : $t('solutions.createSolution', '新建解决方案') }}
        </h3>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">{{ $t('solutions.name', '名称') }} *</label>
            <input
              v-model="formData.name"
              type="text"
              class="form-input"
              :placeholder="$t('solutions.namePlaceholder', '输入解决方案名称')"
            />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('solutions.slug', 'URL标识') }}</label>
            <input
              v-model="formData.slug"
              type="text"
              class="form-input"
              :placeholder="$t('solutions.slugPlaceholder', '自动生成或自定义')"
            />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('solutions.description', '描述') }}</label>
            <textarea
              v-model="formData.description"
              class="form-textarea"
              rows="2"
              :placeholder="$t('solutions.descriptionPlaceholder', '简要描述该解决方案')"
            ></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('solutions.tags', '标签') }}</label>
            <input
              v-model="tagsInput"
              type="text"
              class="form-input"
              :placeholder="$t('solutions.tagsPlaceholder', '多个标签用逗号分隔')"
            />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('solutions.guide', '执行指南') }} (Markdown)</label>
            <textarea
              v-model="formData.guide"
              class="form-textarea form-textarea-large"
              rows="12"
              :placeholder="$t('solutions.guidePlaceholder', '使用 Markdown 格式编写执行指南...')"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDialog">
            {{ $t('common.cancel', '取消') }}
          </button>
          <button v-if="isEditing" class="btn-delete" @click="deleteSolution">
            {{ $t('common.delete', '删除') }}
          </button>
          <button class="btn-save" @click="saveSolution" :disabled="isSaving">
            {{ isSaving ? $t('common.saving', '保存中...') : $t('common.save', '保存') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import apiClient from '@/api/client'

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
const userStore = useUserStore()

// Admin check
const isAdmin = computed(() => userStore.isAdmin)

// State
const solutions = ref<Solution[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(12)
const totalCount = ref(0)
const totalPages = ref(0)

// Dialog state
const showDialog = ref(false)
const isEditing = ref(false)
const isSaving = ref(false)
const editingId = ref<number | null>(null)
const tagsInput = ref('')

const formData = ref({
  name: '',
  slug: '',
  description: '',
  guide: '',
  tags: [] as string[],
})

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout> | null = null
const debouncedSearch = () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    currentPage.value = 1
    loadSolutions()
  }, 300)
}

// Load solutions
const loadSolutions = async () => {
  isLoading.value = true
  try {
    const params: Record<string, unknown> = {
      page: currentPage.value,
      limit: pageSize.value,
    }
    if (searchQuery.value.trim()) {
      params.search = searchQuery.value.trim()
    }

    const response = await apiClient.get('/solutions', { params })
    
    if (response.data?.data) {
      solutions.value = response.data.data.items || []
      totalCount.value = response.data.data.total || 0
      totalPages.value = response.data.data.pages || 1
    }
  } catch (error) {
    console.error('Failed to load solutions:', error)
  } finally {
    isLoading.value = false
  }
}

// Open solution detail
const openSolutionDetail = (solution: Solution) => {
  router.push({ name: 'solution-detail', params: { id: solution.id } })
}

// Pagination
const changePage = (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadSolutions()
}

// Dialog operations
const openCreateDialog = () => {
  isEditing.value = false
  editingId.value = null
  formData.value = { name: '', slug: '', description: '', guide: '', tags: [] }
  tagsInput.value = ''
  showDialog.value = true
}

const openEditDialog = async (solution: Solution) => {
  isEditing.value = true
  editingId.value = solution.id
  
  // Load full solution data including guide
  try {
    const response = await apiClient.get(`/solutions/${solution.id}`)
    const fullSolution = response.data.data
    formData.value = {
      name: fullSolution.name,
      slug: fullSolution.slug,
      description: fullSolution.description || '',
      guide: fullSolution.guide || '',
      tags: fullSolution.tags || [],
    }
    tagsInput.value = (fullSolution.tags || []).join(', ')
  } catch (error) {
    console.error('Failed to load solution:', error)
    formData.value = {
      name: solution.name,
      slug: solution.slug,
      description: solution.description || '',
      guide: '',
      tags: solution.tags || [],
    }
    tagsInput.value = (solution.tags || []).join(', ')
  }
  
  showDialog.value = true
}

const closeDialog = () => {
  showDialog.value = false
  isEditing.value = false
  editingId.value = null
}

const saveSolution = async () => {
  if (!formData.value.name.trim()) {
    alert(t('solutions.nameRequired', '名称不能为空'))
    return
  }

  isSaving.value = true
  try {
    // Parse tags from comma-separated string
    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0)

    const data = {
      name: formData.value.name.trim(),
      slug: formData.value.slug.trim() || undefined,
      description: formData.value.description.trim() || null,
      guide: formData.value.guide.trim() || null,
      tags,
    }

    if (isEditing.value && editingId.value) {
      await apiClient.put(`/admin/solutions/${editingId.value}`, data)
    } else {
      await apiClient.post('/admin/solutions', data)
    }

    closeDialog()
    loadSolutions()
  } catch (error) {
    console.error('Failed to save solution:', error)
    alert(t('solutions.saveFailed', '保存失败'))
  } finally {
    isSaving.value = false
  }
}

const deleteSolution = async () => {
  if (!editingId.value) return
  
  if (!confirm(t('solutions.deleteConfirm', '确定要删除这个解决方案吗？'))) {
    return
  }

  try {
    await apiClient.delete(`/admin/solutions/${editingId.value}`)
    closeDialog()
    loadSolutions()
  } catch (error) {
    console.error('Failed to delete solution:', error)
    alert(t('solutions.deleteFailed', '删除失败'))
  }
}

// Lifecycle
onMounted(() => {
  loadSolutions()
})
</script>

<style scoped>
.solutions-view *,
.solutions-view *::before,
.solutions-view *::after {
  box-sizing: border-box;
}

.solutions-view {
  padding: 16px 24px;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.06);
}

.view-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
  letter-spacing: -0.02em;
}

/* Filter */
.solutions-filter {
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.search-input {
  width: 100%;
  max-width: 360px;
  padding: 10px 16px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  outline: none;
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

/* Solutions Grid */
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px;
  box-sizing: border-box;
  overflow-y: auto;
  flex: 1;
}

.solution-card {
  position: relative;
  padding: 16px;
  padding-left: 20px;
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  min-height: 120px;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03);
  overflow: hidden;
}

/* Left color bar */
.solution-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #10b981 0%, #059669 100%);
  border-radius: 10px 0 0 10px;
  transition: width 0.25s ease;
}

.solution-card:hover {
  box-shadow: 0 8px 25px rgba(16, 185, 129, 0.15);
  transform: translateY(-3px);
  border-color: rgba(16, 185, 129, 0.3);
}

.solution-card:hover::before {
  width: 5px;
}

.solution-card-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.solution-card-icon {
  font-size: 24px;
  margin-right: 10px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.solution-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.4;
  flex: 1;
}

.solution-card-desc {
  font-size: 13px;
  color: var(--text-secondary, #5a6a7a);
  margin-bottom: 8px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.solution-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.solution-tag {
  font-size: 11px;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 2px 8px;
  border-radius: 12px;
  white-space: nowrap;
}

.solution-tag-more {
  font-size: 11px;
  color: var(--text-tertiary, #9aa5b1);
  padding: 2px 6px;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.page-btn {
  padding: 8px 16px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 6px;
  background: white;
  color: var(--text-primary, #333);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #3b82f6;
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-size: 14px;
  color: var(--text-secondary, #666);
}

/* Responsive */
@media (max-width: 1024px) {
  .solutions-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .solutions-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .solutions-grid {
    grid-template-columns: 1fr;
  }
}

/* Admin Button */
.btn-create {
  padding: 8px 16px;
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

.btn-create:hover {
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
  transform: translateY(-1px);
}

.btn-primary {
  padding: 10px 20px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 16px;
}

.btn-primary:hover {
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
}

.card-edit-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.2s ease;
  flex-shrink: 0;
}

.solution-card:hover .card-edit-btn {
  opacity: 0.6;
}

.card-edit-btn:hover {
  opacity: 1 !important;
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
  max-width: 640px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
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
  flex: 1;
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
  outline: none;
}

.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.form-textarea:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
  outline: none;
}

.form-textarea-large {
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}

/* Dialog Buttons */
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
  background: #f8fafc;
}

.btn-delete {
  padding: 8px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  font-size: 14px;
  color: #dc2626;
  cursor: pointer;
  margin-right: auto;
}

.btn-delete:hover {
  background: #fee2e2;
}

.btn-save {
  padding: 8px 20px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>