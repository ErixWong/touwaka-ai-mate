<template>
  <div class="solutions-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('solutions.title', '解决方案') }}</h1>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import apiClient from '@/api/client'

interface Solution {
  id: number
  name: string
  slug: string
  description: string | null
  tags: string[] | null
  is_active: boolean
  created_at: string
  updated_at: string
}

const { t } = useI18n()
const router = useRouter()

// State
const solutions = ref<Solution[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(12)
const totalCount = ref(0)
const totalPages = ref(0)

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
</style>