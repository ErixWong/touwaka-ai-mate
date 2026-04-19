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
        <el-button @click="showSearchDialog = true">
          <span class="btn-icon">🔍</span>
          {{ $t('knowledgeBase.search') }}
        </el-button>
        <el-button v-if="userStore.isAdmin" type="warning" @click="handleTransferOwner">
          <span class="btn-icon">👤</span>
          {{ $t('knowledgeBase.transferOwner.button') }}
        </el-button>
        <el-button type="primary" @click="handleRevectorize" :loading="isRevectorizing">
          <span class="btn-icon">🔄</span>
          {{ isRevectorizing ? $t('knowledgeBase.revectorizing') : $t('knowledgeBase.revectorize') }}
        </el-button>
        <!-- 进度显示 -->
        <div v-if="isRevectorizing && revectorizeProgress.total > 0" class="revectorize-progress">
          <el-progress 
            :percentage="Math.round((revectorizeProgress.current / revectorizeProgress.total) * 100)" 
            :status="revectorizeProgress.failed > 0 ? 'exception' : ''"
            :stroke-width="12"
            class="progress-bar"
          />
          <div class="progress-text">
            {{ revectorizeProgress.current }} / {{ revectorizeProgress.total }}
            ({{ $t('knowledgeBase.success') || '成功' }}: {{ revectorizeProgress.success }}, {{ $t('knowledgeBase.failed') || '失败' }}: {{ revectorizeProgress.failed }})
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
      <!-- Left: Article List -->
      <div class="article-panel">
        <div class="panel-header">
          <h3>{{ $t('knowledgeBase.articles') || '文章列表' }}</h3>
          <el-button size="small" circle @click="showArticleDialog = true" :title="$t('knowledgeBase.article.create')">
            <span class="btn-icon">+</span>
          </el-button>
        </div>

        <!-- Tag Filter -->
        <div v-if="kbStore.tags.length > 0" class="tag-filter">
          <div class="tag-filter-header">
            <span class="tag-filter-label">{{ $t('knowledgeBase.tagFilter') }}</span>
            <el-button v-if="selectedTagIds.length > 0" size="small" text @click="clearTagFilter">{{ $t('knowledgeBase.clearTagFilter') }}</el-button>
          </div>
          <div class="tag-list">
            <span
              v-for="tag in kbStore.tags"
              :key="tag.id"
              class="tag-chip"
              :class="{ selected: selectedTagIds.includes(tag.id) }"
              @click="toggleTag(tag.id)"
            >
              {{ tag.name }}({{ tag.article_count || 0 }})
            </span>
          </div>
        </div>

        <!-- Article List -->
        <div class="article-list">
          <div v-if="kbStore.articles.length === 0" class="list-empty">
            {{ $t('knowledgeBase.noArticles') }}
          </div>
          <div
            v-else
            v-for="article in kbStore.articles"
            :key="article.id"
            class="article-item"
            :class="{ selected: selectedArticle?.id === article.id }"
            @click="selectArticle(article)"
          >
            <div class="article-item-content">
              <span class="article-icon">📄</span>
              <div class="article-info">
                <span class="article-title">{{ article.title }}</span>
                <div v-if="article.tags && article.tags.length > 0" class="article-tags">
                  <span v-for="tag in article.tags" :key="tag.id" class="article-tag">{{ tag.name }}</span>
                </div>
              </div>
              <span v-if="article.status === 'error'" class="status-badge failed">
                {{ $t('knowledgeBase.article.status.failed') }}
              </span>
            </div>
            <div class="article-item-actions">
              <el-button size="small" text @click.stop="editArticle(article)" :title="$t('common.edit')">
                <span class="btn-icon">✏️</span>
              </el-button>
              <el-button size="small" text type="danger" @click.stop="deleteArticle(article)" :title="$t('common.delete')">
                <span class="btn-icon">🗑️</span>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Middle: Section Tree -->
      <div class="section-panel">
        <div class="panel-header">
          <h3>{{ $t('knowledgeBase.sections') || '章节结构' }}</h3>
          <div class="panel-actions">
            <el-button size="small" circle @click="expandAllSections" :title="$t('knowledgeBase.expandAll')">
              <span class="btn-icon">+⊟</span>
            </el-button>
            <el-button size="small" circle @click="collapseAllSections" :title="$t('knowledgeBase.collapseAll')">
              <span class="btn-icon">⊟-</span>
            </el-button>
            <el-button
              size="small"
              circle
              @click="showSectionDialog = true"
              :title="$t('knowledgeBase.section.create') || '创建章节'"
              :disabled="!selectedArticle"
            >
              <span class="btn-icon">+</span>
            </el-button>
          </div>
        </div>

        <!-- Section Tree -->
        <div class="section-tree">
          <div v-if="!selectedArticle" class="tree-empty">
            {{ $t('knowledgeBase.selectArticleHint') || '请先选择一篇文章' }}
          </div>
          <div v-else-if="kbStore.sectionTree.length === 0" class="tree-empty">
            {{ $t('knowledgeBase.noSections') || '暂无章节，点击 + 创建' }}
          </div>
          <div v-else class="section-list">
            <SectionTreeNode
              v-for="section in kbStore.sectionTree"
              :key="sectionKey + '-' + section.id"
              :node="section"
              :level="0"
              :selected-id="selectedSection?.id"
              :force-expand="forceExpandSections"
              @select="selectSection"
              @edit="editSection"
              @delete="deleteSection"
              @add-child="addChildSection"
            />
          </div>
        </div>
      </div>

      <!-- Right: Paragraph Content -->
      <div class="content-panel">
        <!-- Empty State -->
        <div v-if="!selectedSection" class="content-empty">
          <div class="empty-icon">📖</div>
          <p>{{ $t('knowledgeBase.selectSectionHint') || '请从中间选择一个章节查看内容' }}</p>
        </div>

        <!-- Section Content -->
        <div v-else class="content-main">
          <div class="content-header">
            <div class="title-row">
              <h2 class="content-title">{{ selectedSection.title || '未命名章节' }}</h2>
              <div class="title-actions">
                <Pagination
                  v-if="paragraphTotalPages > 1"
                  :current-page="paragraphPage"
                  :total-pages="paragraphTotalPages"
                  :total="kbStore.paragraphTotal"
                  @change="handleParagraphPageChange"
                />
                <el-button size="small" circle @click="editSection(selectedSection)" :title="$t('common.edit')">
                  <span class="btn-icon">✏️</span>
                </el-button>
                <el-button size="small" circle type="danger" @click="deleteSection(selectedSection)" :title="$t('common.delete')">
                  <span class="btn-icon">🗑️</span>
                </el-button>
              </div>
            </div>
            <div class="content-meta">
              <span class="meta-item">
                {{ $t('knowledgeBase.paragraphCount', { count: kbStore.paragraphTotal }) || `${kbStore.paragraphTotal} 个段落` }}
              </span>
              <span class="meta-item">
                {{ $t('knowledgeBase.tokenCount', { count: totalTokens }) || `${totalTokens} tokens` }}
              </span>
            </div>
          </div>

          <!-- Paragraphs -->
          <div class="content-section">
            <div class="section-header">
              <h4 class="section-title">{{ $t('knowledgeBase.paragraphs') || '段落列表' }}</h4>
              <div class="section-header-actions">
                <el-button size="small" @click="showParagraphDialog = true">
                  + {{ $t('knowledgeBase.paragraph.create') || '添加段落' }}
                </el-button>
              </div>
            </div>

            <div v-if="kbStore.paragraphs.length === 0" class="points-empty">
              {{ $t('knowledgeBase.paragraph.noParagraphs') || '暂无段落，点击 + 添加' }}
            </div>
            <div v-else class="paragraphs-list">
              <div
                v-for="paragraph in kbStore.paragraphs"
                :key="paragraph.id"
                class="paragraph-card"
                :class="{ 'paragraph-vectorized': paragraph.is_vectorized }"
                @click="selectParagraph(paragraph)"
              >
                <div class="paragraph-header">
                  <div v-if="paragraph.title" class="paragraph-title">{{ paragraph.title }}</div>
                  <div class="paragraph-actions">
                    <el-button size="small" text @click.stop="editParagraph(paragraph)" :title="$t('common.edit')">
                      <span class="btn-icon">✏️</span>
                    </el-button>
                    <el-button size="small" text type="danger" @click.stop="deleteParagraph(paragraph)" :title="$t('common.delete')">
                      <span class="btn-icon">🗑️</span>
                    </el-button>
                  </div>
                </div>
                <div class="paragraph-content" v-html="renderMarkdown(paragraph.content)"></div>
                <div class="paragraph-meta">
                  <span>{{ $t('knowledgeBase.paragraph.tokenCount', { count: paragraph.token_count }) }}</span>
                  <div class="paragraph-status-actions">
                    <span v-if="paragraph.is_vectorized" class="status-badge vectorized" :title="$t('knowledgeBase.paragraph.vectorized')">
                      ✅ {{ $t('knowledgeBase.paragraph.vectorized') }}
                    </span>
                    <span v-else class="status-badge not-vectorized" :title="$t('knowledgeBase.paragraph.notVectorized')">
                      ⏳ {{ $t('knowledgeBase.paragraph.notVectorized') }}
                    </span>
                    <button
                      v-if="paragraph.is_vectorized"
                      class="status-badge revectorize-btn"
                      @click.stop="handleParagraphRevectorize(paragraph)"
                      :title="$t('knowledgeBase.paragraph.revectorizeHint')"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Search Dialog -->
    <el-dialog
      v-model="showSearchDialog"
      :title="$t('knowledgeBase.search')"
      width="720px"
      destroy-on-close
    >
      <div class="search-dialog-body">
        <el-input
          v-model="searchQuery"
          :placeholder="$t('knowledgeBase.searchHint')"
          @keyup.enter="searchQuery.trim() && performSearch()"
        >
          <template #append>
            <el-button @click="performSearch" :loading="kbStore.isSearching" :disabled="!searchQuery.trim()">
              {{ $t('knowledgeBase.search') }}
            </el-button>
          </template>
        </el-input>

        <div v-if="kbStore.isSearching" class="search-loading">
          <el-skeleton :rows="3" animated />
        </div>

        <div v-else-if="kbStore.searchResults.length > 0" class="search-results">
          <h4>{{ $t('knowledgeBase.searchResult.title') }}</h4>
          <el-card
            v-for="result in kbStore.searchResults"
            :key="result.paragraph.id"
            class="search-result-item"
            shadow="hover"
          >
            <div class="result-score">
              {{ Math.round(result.score * 100) }}%
            </div>
            <div class="result-content">
              <div class="result-location">
                <el-breadcrumb separator=">">
                  <el-breadcrumb-item>{{ result.article?.title || 'Unknown' }}</el-breadcrumb-item>
                  <el-breadcrumb-item v-if="result.section">{{ result.section.title }}</el-breadcrumb-item>
                </el-breadcrumb>
              </div>
              <div class="result-text" v-html="renderMarkdown(result.paragraph.content)"></div>
            </div>
          </el-card>
        </div>

        <el-empty v-else-if="searchQuery && hasSearched" :description="$t('knowledgeBase.searchResult.empty')" />
      </div>
      <template #footer>
        <el-button @click="closeSearchDialog">{{ $t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- Article Dialog -->
    <el-dialog
      v-model="showArticleDialog"
      :title="editingArticle ? $t('knowledgeBase.article.edit') : $t('knowledgeBase.article.create')"
      width="480px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item :label="$t('knowledgeBase.article.titleLabel') || '标题'">
          <el-input v-model="articleForm.title" :placeholder="$t('knowledgeBase.article.titlePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('knowledgeBase.article.summaryLabel') || '摘要'">
          <el-input v-model="articleForm.summary" type="textarea" :rows="3" :placeholder="$t('knowledgeBase.article.summaryPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeArticleDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitArticle" :loading="savingArticle" :disabled="!articleForm.title.trim()">
          {{ $t('common.save') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Section Dialog -->
    <el-dialog
      v-model="showSectionDialog"
      :title="editingSection ? $t('knowledgeBase.section.edit') || '编辑章节' : $t('knowledgeBase.section.create') || '创建章节'"
      width="480px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item :label="$t('knowledgeBase.section.titleLabel') || '标题'">
          <el-input v-model="sectionForm.title" :placeholder="$t('knowledgeBase.section.titlePlaceholder') || '输入章节标题'" />
        </el-form-item>
        <el-form-item v-if="!editingSection" :label="$t('knowledgeBase.section.parent') || '父章节'">
          <el-select v-model="sectionForm.parent_id" :placeholder="$t('knowledgeBase.section.noParent') || '无（顶级章节）'" clearable style="width: 100%">
            <el-option v-for="s in flatSectionList" :key="s.id" :label="s.title" :value="s.id">
              <span :style="{ paddingLeft: (s.level || 0) * 16 + 'px' }">{{ s.title }}</span>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeSectionDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitSection" :disabled="!sectionForm.title.trim()">
          {{ $t('common.save') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Paragraph Dialog -->
    <el-dialog
      v-model="showParagraphDialog"
      :title="editingParagraph ? $t('knowledgeBase.paragraph.edit') || '编辑段落' : $t('knowledgeBase.paragraph.create') || '创建段落'"
      width="720px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item :label="$t('knowledgeBase.paragraph.titleLabel') || '标题（可选）'">
          <el-input v-model="paragraphForm.title" :placeholder="$t('knowledgeBase.paragraph.titlePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('knowledgeBase.paragraph.contentLabel') || '内容'">
          <el-input v-model="paragraphForm.content" type="textarea" :rows="8" :placeholder="$t('knowledgeBase.paragraph.contentPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('knowledgeBase.paragraph.contextLabel') || '上下文（可选）'">
          <el-input v-model="paragraphForm.context" type="textarea" :rows="2" :placeholder="$t('knowledgeBase.paragraph.contextPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeParagraphDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitParagraph" :disabled="!paragraphForm.content.trim()">
          {{ $t('common.save') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Transfer Owner Dialog -->
    <el-dialog
      v-model="showTransferDialog"
      :title="$t('knowledgeBase.transferOwner.title')"
      width="480px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-text type="info" class="transfer-hint">{{ $t('knowledgeBase.transferOwner.hint') }}</el-text>
        <el-form-item :label="$t('knowledgeBase.transferOwner.newOwner')">
          <UserPicker
            v-model="selectedNewOwnerId"
            :placeholder="$t('knowledgeBase.transferOwner.selectUser')"
            @change="handleOwnerSelect"
          />
        </el-form-item>
        <el-alert v-if="selectedNewOwner" type="warning" :closable="false">
          {{ $t('knowledgeBase.transferOwner.confirm', { name: selectedNewOwner.nickname || selectedNewOwner.username }) }}
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="closeTransferDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitTransferOwner" :loading="isTransferring" :disabled="!selectedNewOwnerId">
          {{ $t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import SectionTreeNode from '@/components/SectionTreeNode.vue'
import UserPicker from '@/components/common/UserPicker.vue'
import Pagination from '@/components/Pagination.vue'
import type { KbArticle, KbSection, KbParagraph, UserListItem } from '@/types'
import { marked } from 'marked'
import { knowledgeBaseApi } from '@/api/services'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const kbStore = useKnowledgeBaseStore()
const toast = useToastStore()
const userStore = useUserStore()

// State
const isLoading = ref(true)
const selectedArticle = ref<KbArticle | null>(null)
const selectedSection = ref<KbSection | null>(null)
const selectedParagraph = ref<KbParagraph | null>(null)

// Tag filter state
const selectedTagIds = ref<string[]>([])

// Tree expansion state
const forceExpandSections = ref<boolean | null>(null)
const sectionKey = ref(0)

// Paragraph pagination
const paragraphPage = ref(1)
const paragraphPageSize = ref(10)

// Dialogs
const showSearchDialog = ref(false)
const showArticleDialog = ref(false)
const showSectionDialog = ref(false)
const showParagraphDialog = ref(false)
const editingArticle = ref<KbArticle | null>(null)
const editingSection = ref<KbSection | null>(null)
const editingParagraph = ref<KbParagraph | null>(null)
const isRevectorizing = ref(false)
const revectorizeProgress = ref({ total: 0, success: 0, failed: 0, current: 0, status: '' })
let revectorizeJobId = ''

// Search
const searchQuery = ref('')
const hasSearched = ref(false)

// Transfer Owner
const showTransferDialog = ref(false)
const selectedNewOwnerId = ref<string | null>(null)
const selectedNewOwner = ref<UserListItem | null>(null)
const isTransferring = ref(false)

// Forms
const articleForm = ref({
  title: '',
  summary: '',
})

const sectionForm = ref({
  title: '',
  parent_id: undefined as string | undefined,
})

const paragraphForm = ref({
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
const kbId = computed(() => getRouteParam(route.params.kbId))

// 获取确保非空的 kbId，用于 API 调用
const requireKbId = (): string => {
  const id = kbId.value
  if (!id) {
    throw new Error('Knowledge base ID is required')
  }
  return id
}

// 扁平化章节列表（用于父章节选择器）
const flatSectionList = computed(() => {
  const flatten = (sections: KbSection[], level = 0): (KbSection & { level: number })[] => {
    return sections.reduce<(KbSection & { level: number })[]>((acc, section) => {
      acc.push({ ...section, level })
      if (section.children && section.children.length > 0) {
        acc.push(...flatten(section.children, level + 1))
      }
      return acc
    }, [])
  }
  return flatten(kbStore.sectionTree)
})

const totalTokens = computed(() => {
  return kbStore.paragraphs.reduce((sum, p) => sum + (p.token_count || 0), 0)
})

const paragraphTotalPages = computed(() => {
  return Math.ceil(kbStore.paragraphTotal / paragraphPageSize.value)
})

// Methods
const handleRevectorize = async () => {
  if (!kbId.value) return

  if (!confirm('确定要重新向量化所有段落吗？这将使用当前配置的嵌入模型重新生成所有向量。')) {
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
          toast.success(`重新向量化完成！总计: ${progress.total}，成功: ${progress.success}，失败: ${progress.failed}，向量维度: ${progress.embedding_dim}`)
          // 刷新段落列表（如果有选中章节）
          if (selectedSection.value?.id) {
            await kbStore.loadParagraphs(requireKbId(), selectedSection.value.id)
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
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    toast.error('重新向量化失败: ' + errorMsg)
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

// Article operations
const selectArticle = async (article: KbArticle) => {
  selectedArticle.value = article
  selectedSection.value = null
  selectedParagraph.value = null
  // Load sections for this article
  await kbStore.loadSectionTree(requireKbId(), article.id)
}

const editArticle = (article: KbArticle) => {
  editingArticle.value = article
  articleForm.value = {
    title: article.title,
    summary: article.summary || '',
  }
  showArticleDialog.value = true
}

const deleteArticle = async (article: KbArticle) => {
  if (!confirm(t('knowledgeBase.article.deleteConfirm', { title: article.title }))) return

  try {
    await kbStore.deleteArticle(requireKbId(), article.id)
    if (selectedArticle.value?.id === article.id) {
      selectedArticle.value = null
      selectedSection.value = null
    }
  } catch (error) {
    console.error('Failed to delete article:', error)
  }
}

const closeArticleDialog = () => {
  showArticleDialog.value = false
  editingArticle.value = null
  articleForm.value = { title: '', summary: '' }
}

const submitArticle = async () => {
  if (!articleForm.value.title.trim()) return

  try {
    if (editingArticle.value) {
      const updated = await kbStore.updateArticle(requireKbId(), editingArticle.value.id, {
        title: articleForm.value.title,
        summary: articleForm.value.summary,
      })
      // 更新当前选中的文章
      if (selectedArticle.value?.id === editingArticle.value.id) {
        selectedArticle.value = updated
      }
    } else {
      await kbStore.createArticle(requireKbId(), {
        title: articleForm.value.title,
        summary: articleForm.value.summary,
      })
    }
    closeArticleDialog()
  } catch (error) {
    console.error('Failed to save article:', error)
  }
}

// Section operations
const selectSection = async (section: KbSection) => {
  selectedSection.value = section
  selectedParagraph.value = null
  paragraphPage.value = 1
  // Load paragraphs for this section with pagination
  await kbStore.loadParagraphs(requireKbId(), section.id, {
    page: paragraphPage.value,
    pageSize: paragraphPageSize.value,
  })
}

const handleParagraphPageChange = async (page: number) => {
  paragraphPage.value = page
  if (selectedSection.value) {
    await kbStore.loadParagraphs(requireKbId(), selectedSection.value.id, {
      page: paragraphPage.value,
      pageSize: paragraphPageSize.value,
    })
  }
}

const editSection = (section: KbSection) => {
  editingSection.value = section
  sectionForm.value = {
    title: section.title,
    parent_id: section.parent_id ?? undefined,
  }
  showSectionDialog.value = true
}

const deleteSection = async (section: KbSection) => {
  if (!confirm(t('knowledgeBase.section.deleteConfirm', { title: section.title }))) return

  try {
    await kbStore.deleteSection(requireKbId(), section.id)
    if (selectedSection.value?.id === section.id) {
      selectedSection.value = null
    }
  } catch (error) {
    console.error('Failed to delete section:', error)
  }
}

const addChildSection = (parent: KbSection) => {
  editingSection.value = null
  sectionForm.value = {
    title: '',
    parent_id: parent.id,
  }
  showSectionDialog.value = true
}

const closeSectionDialog = () => {
  showSectionDialog.value = false
  editingSection.value = null
  sectionForm.value = { title: '', parent_id: undefined }
}

const submitSection = async () => {
  if (!sectionForm.value.title.trim() || !selectedArticle.value) return

  try {
    if (editingSection.value) {
      const updated = await kbStore.updateSection(requireKbId(), editingSection.value.id, {
        title: sectionForm.value.title,
      })
      // 更新当前选中的章节
      if (selectedSection.value?.id === editingSection.value.id) {
        selectedSection.value = updated
      }
    } else {
      await kbStore.createSection(requireKbId(), {
        article_id: selectedArticle.value.id,
        title: sectionForm.value.title,
        parent_id: sectionForm.value.parent_id,
      })
    }
    closeSectionDialog()
  } catch (error) {
    console.error('Failed to save section:', error)
  }
}

const expandAllSections = () => {
  forceExpandSections.value = true
  sectionKey.value++
}

const collapseAllSections = () => {
  forceExpandSections.value = false
  sectionKey.value++
}

// Paragraph operations
const selectParagraph = (paragraph: KbParagraph) => {
  selectedParagraph.value = paragraph
}

const editParagraph = (paragraph: KbParagraph) => {
  editingParagraph.value = paragraph
  paragraphForm.value = {
    title: paragraph.title || '',
    content: paragraph.content,
    context: paragraph.context || '',
  }
  showParagraphDialog.value = true
}

const deleteParagraph = async (paragraph: KbParagraph) => {
  if (!confirm(t('knowledgeBase.paragraph.deleteConfirm'))) return

  try {
    await kbStore.deleteParagraph(requireKbId(), paragraph.id)
  } catch (error) {
    console.error('Failed to delete paragraph:', error)
  }
}

const closeParagraphDialog = () => {
  showParagraphDialog.value = false
  editingParagraph.value = null
  paragraphForm.value = { title: '', content: '', context: '' }
}

const submitParagraph = async () => {
  if (!paragraphForm.value.content.trim() || !selectedSection.value) return

  try {
    if (editingParagraph.value) {
      await kbStore.updateParagraph(
        requireKbId(),
        editingParagraph.value.id,
        {
          title: paragraphForm.value.title,
          content: paragraphForm.value.content,
          context: paragraphForm.value.context,
        }
      )
    } else {
      await kbStore.createParagraph(requireKbId(), {
        section_id: selectedSection.value.id,
        title: paragraphForm.value.title,
        content: paragraphForm.value.content,
        context: paragraphForm.value.context,
      })
    }
    closeParagraphDialog()
  } catch (error) {
    console.error('Failed to save paragraph:', error)
  }
}

// 单个段落重新向量化（通过更新段落触发）
const handleParagraphRevectorize = async (paragraph: KbParagraph) => {
  if (!selectedSection.value) return

  try {
    // 通过更新段落内容（不变）来触发重新向量化
    // 后台任务会自动处理未向量化的段落
    await kbStore.updateParagraph(requireKbId(), paragraph.id, {
      content: paragraph.content, // 保持内容不变
    })
    // 刷新段落列表
    await kbStore.loadParagraphs(requireKbId(), selectedSection.value.id)
    toast.info('已触发段落重新向量化，请稍后刷新查看结果')
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    toast.error('重新向量化失败: ' + errorMsg)
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

// Tag filter methods
const toggleTag = (tagId: string) => {
  const index = selectedTagIds.value.indexOf(tagId)
  if (index === -1) {
    selectedTagIds.value.push(tagId)
  } else {
    selectedTagIds.value.splice(index, 1)
  }
  // Reload articles with tag filter
  loadArticlesWithFilter()
}

const clearTagFilter = () => {
  selectedTagIds.value = []
  // Reload articles without tag filter
  loadArticlesWithFilter()
}

const loadArticlesWithFilter = async () => {
  try {
    const id = requireKbId()
    await kbStore.loadArticles(id, {
      tag_ids: selectedTagIds.value.length > 0 ? selectedTagIds.value : undefined,
    })
  } catch (error) {
    console.error('Failed to load articles:', error)
  }
}

// Transfer Owner methods
const handleTransferOwner = () => {
  showTransferDialog.value = true
}

const handleOwnerSelect = (user: UserListItem | null) => {
  selectedNewOwner.value = user
}

const closeTransferDialog = () => {
  showTransferDialog.value = false
  selectedNewOwnerId.value = null
  selectedNewOwner.value = null
}

const submitTransferOwner = async () => {
  if (!selectedNewOwnerId.value || !kbId.value) return

  isTransferring.value = true
  try {
    await knowledgeBaseApi.transferOwner(kbId.value, selectedNewOwnerId.value)
    toast.success(t('knowledgeBase.transferOwner.success'))
    // Reload KB to get updated owner info
    await kbStore.loadKnowledgeBase(requireKbId())
    closeTransferDialog()
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : t('knowledgeBase.transferOwner.failed')
    toast.error(errorMsg)
  } finally {
    isTransferring.value = false
  }
}

// Initialize
onMounted(async () => {
  try {
    const id = requireKbId()
    await kbStore.loadKnowledgeBase(id)
    // 同时加载 tags 和 articles
    await Promise.all([
      kbStore.loadTags(id),
      kbStore.loadArticles(id),
    ])
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
  align-items: center;
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

.btn-transfer {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.btn-transfer:hover {
  background: var(--primary-color, #2196f3);
  color: white;
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

/* Main Content - Three Column Layout */
.detail-content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* Article Panel (Left) */
.article-panel {
  width: 220px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
}

/* Section Panel (Middle) */
.section-panel {
  width: 280px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
}

/* Content Panel (Right) */
.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--secondary-bg, #fafafa);
}

/* Panel Header */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.panel-actions {
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

.btn-icon:hover:not(:disabled) {
  background: var(--secondary-bg, #f5f5f5);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Tag Filter */
.tag-filter {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #fafafa);
}

.tag-filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.tag-filter-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.tag-clear-btn {
  font-size: 11px;
  color: var(--primary-color, #2196f3);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

.tag-clear-btn:hover {
  text-decoration: underline;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-chip {
  display: inline-block;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-secondary, #666);
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tag-chip:hover {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.tag-chip.selected {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  color: white;
}

/* Article List */
.article-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.list-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary, #999);
  font-size: 14px;
}

.article-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 4px;
}

.article-item:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.article-item.selected {
  background: var(--primary-light, #e3f2fd);
}

.article-item-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.article-icon {
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}

.article-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.article-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  max-height: 32px;
  overflow: hidden;
}

.article-tag {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--secondary-bg, #f0f0f0);
  color: var(--text-tertiary, #999);
  border-radius: 3px;
  white-space: nowrap;
}

.article-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
}

.article-item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.article-item:hover .article-item-actions {
  opacity: 1;
}

.btn-sm-icon {
  padding: 2px 6px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.btn-sm-icon:hover {
  background: var(--border-color, #e0e0e0);
}

.btn-sm-icon.danger:hover {
  background: var(--danger-light, #ffebee);
}

/* Section Tree */
.section-tree {
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

.section-list {
  user-select: none;
}

/* Content Panel */
.content-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary, #999);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.content-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.content-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.title-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-icon-action {
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-icon-action:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.btn-icon-action.btn-delete:hover {
  background: var(--danger-light, #ffebee);
}

.content-meta {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}

.meta-item {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* Content Section */
.content-section {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
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
  background: var(--primary-dark, #1976d2);
}

/* Paragraphs */
.points-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary, #999);
}

.paragraphs-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.paragraph-card {
  padding: 16px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.paragraph-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.paragraph-card.paragraph-vectorized {
  border-left: 3px solid var(--success-color, #4caf50);
}

.paragraph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.paragraph-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #333);
}

.paragraph-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.paragraph-card:hover .paragraph-actions {
  opacity: 1;
}

.paragraph-content {
  font-size: 14px;
  color: var(--text-secondary, #666);
  line-height: 1.6;
}

.paragraph-content :deep(p) {
  margin: 0 0 8px 0;
}

.paragraph-content :deep(code) {
  background: var(--border-color, #e0e0e0);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.paragraph-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

.paragraph-status-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}

.status-badge.pending {
  background: #fff3e0;
  color: #ef6c00;
}

.status-badge.processing {
  background: #e3f2fd;
  color: #1976d2;
}

.status-badge.failed {
  background: #ffebee;
  color: #c62828;
}

.status-badge.vectorized {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.not-vectorized {
  background: #fff8e1;
  color: #f57c00;
}

.revectorize-btn {
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 2px 4px;
}

.revectorize-btn:hover {
  background: var(--secondary-bg, #f5f5f5);
  border-radius: 4px;
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
  background: var(--card-bg, #fff);
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dialog-large {
  max-width: 640px;
}

.dialog-title {
  margin: 0;
  padding: 16px 20px;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  background: var(--card-bg, #fff);
  color: var(--text-primary, #333);
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.btn-cancel {
  padding: 10px 20px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-secondary, #666);
}

.btn-cancel:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.btn-primary {
  padding: 10px 20px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-dark, #1976d2);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger {
  padding: 10px 20px;
  background: var(--danger-color, #f44336);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-danger:hover {
  background: var(--danger-dark, #d32f2f);
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

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
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

.result-text :deep(p) {
  margin: 0 0 8px 0;
}

/* Loading */
.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
}

/* Transfer Owner Dialog */
.transfer-hint {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin-bottom: 16px;
}

.transfer-confirm {
  font-size: 13px;
  color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
  padding: 10px 14px;
  border-radius: 6px;
  margin-top: 8px;
}
</style>
