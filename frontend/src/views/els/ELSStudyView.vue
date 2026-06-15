<template>
  <div class="els-view">
    <header class="hero-card">
      <div>
        <p class="hero-kicker">ELS STUDY WORKBENCH</p>
        <h1>ELS 学习工作台</h1>
        <p class="hero-summary">短阅读、加词、快速复习的一体化学习工作台。</p>
      </div>
      <div class="hero-metrics">
        <div class="metric-chip">
          <span>连续学习</span>
          <strong>{{ dashboard?.today_status.streak_days ?? '--' }} 天</strong>
        </div>
        <div class="metric-chip">
          <span>当前库</span>
          <strong>{{ dashboard?.selected_library.name ?? '加载中' }}</strong>
        </div>
      </div>
    </header>

    <nav class="panel-tabs">
      <button :class="['tab-btn', { active: currentPanel === 'dashboard' }]" @click="currentPanel = 'dashboard'">学习工作台</button>
      <button :class="['tab-btn', { active: currentPanel === 'reading' }]" @click="openReadingFromDashboard">阅读页</button>
      <button :class="['tab-btn', { active: currentPanel === 'review' }]" @click="openReviewPanel">复习页</button>
      <button class="tab-btn secondary" @click="toggleLibraryDrawer">学习库抽屉</button>
    </nav>

    <p v-if="errorMessage" class="page-error">{{ errorMessage }}</p>

    <section v-if="currentPanel === 'dashboard'" class="dashboard-grid">
      <article class="surface-card task-card">
        <header class="card-header">
          <h2>今日任务</h2>
          <span>{{ todayStatusLabel }}</span>
        </header>
        <div class="task-actions">
          <button class="primary-btn" @click="openReadingFromDashboard">开始阅读</button>
          <button class="secondary-btn" @click="openReviewPanel">去复习</button>
        </div>
        <div class="task-stats">
          <div>
            <span>今日到期</span>
            <strong>{{ dashboard?.review_stats.today_due ?? 0 }}</strong>
          </div>
          <div>
            <span>高频错误</span>
            <strong>{{ dashboard?.review_stats.wrong_words ?? 0 }}</strong>
          </div>
          <div>
            <span>今日新增</span>
            <strong>{{ dashboard?.review_stats.new_words ?? 0 }}</strong>
          </div>
        </div>
      </article>

      <article class="surface-card library-card">
        <header class="card-header">
          <h2>当前学习库</h2>
          <button class="link-btn" @click="toggleLibraryDrawer">查看这个库</button>
        </header>
        <p class="card-title">{{ dashboard?.selected_library.name ?? '加载中...' }}</p>
        <p class="muted-text">当前库材料数 {{ dashboard?.selected_library.material_count ?? 0 }}</p>
        <div class="recommended-box">
          <span class="mini-label">推荐阅读</span>
          <strong>{{ dashboard?.recommended_material?.title ?? '当前库暂无可学习材料' }}</strong>
          <p>{{ dashboard?.recommended_material?.summary ?? '切换学习库后，这里会展示对应推荐内容。' }}</p>
        </div>
      </article>

      <article class="surface-card recent-card">
        <header class="card-header">
          <h2>最近学习</h2>
          <span>{{ dashboard?.recent_materials.length ?? 0 }} 条</span>
        </header>
        <ul v-if="dashboard?.recent_materials.length" class="list-stack">
          <li v-for="item in dashboard?.recent_materials" :key="item.id">
            <strong>{{ item.title }}</strong>
            <span>{{ formatDate(item.last_opened_at) }}</span>
          </li>
        </ul>
        <p v-else class="empty-tip">你还没有开始学习</p>
      </article>
    </section>

    <section v-if="currentPanel === 'reading'" class="reading-layout surface-card">
      <header class="card-header reading-header">
        <div>
          <h2>{{ currentMaterial?.title ?? '阅读页' }}</h2>
          <p class="muted-text">{{ currentMaterial?.library_name ?? dashboard?.selected_library.name }} · {{ currentMaterial?.difficulty_level ?? '--' }}</p>
        </div>
        <div class="header-actions">
          <button class="secondary-btn" @click="currentPanel = 'dashboard'">返回工作台</button>
          <button v-if="selectedLibraryMaterial?.can_edit" class="secondary-btn" @click="startEditingMaterial(selectedLibraryMaterial)">编辑本人材料</button>
        </div>
      </header>

      <div v-if="currentMaterial" class="reading-body">
        <article class="article-panel">
          <p v-if="currentMaterial.processing_status !== 'ready'" class="status-warning">
            {{ materialStatusLabel }}
          </p>
          <template v-else>
            <p class="article-summary">{{ currentMaterial.summary }}</p>
            <p class="article-content">{{ currentMaterial.content }}</p>
          </template>
        </article>

        <aside class="reading-side-panel">
          <section class="side-box">
            <h3>划词浮层</h3>
            <p class="muted-text">选中单词后点击下方按钮即可加入词本。</p>
            <div class="word-actions">
              <button v-for="word in quickCollectWords" :key="word.word" class="tag-btn" @click="collectWord(word.word, word.sentence)">
                {{ word.word }}
              </button>
            </div>
            <p v-if="wordFeedback" class="success-tip">{{ wordFeedback }}</p>
          </section>

          <section class="side-box">
            <h3>材料状态</h3>
            <p class="muted-text">{{ materialStatusLabel }}</p>
          </section>

          <section class="side-box">
            <h3>TTS 实时朗读</h3>
            <p>{{ ttsStatusLabel }}</p>
          </section>

          <section class="side-box">
            <h3>阅读后小测</h3>
            <button class="primary-btn full-width" :disabled="!canStartQuiz" @click="loadQuiz">
              {{ quizButtonLabel }}
            </button>
            <div v-if="quiz" class="quiz-block">
              <div v-for="question in quiz.questions" :key="question.id" class="quiz-question">
                <strong>{{ question.prompt }}</strong>
                <label v-for="option in question.options" :key="option" class="option-row">
                  <input v-model="quizAnswers[question.id]" type="radio" :name="question.id" :value="option" />
                  <span>{{ option }}</span>
                </label>
              </div>
              <button class="secondary-btn full-width" @click="submitQuiz">提交小测</button>
              <p v-if="quizResultText" class="success-tip">{{ quizResultText }}</p>
            </div>
          </section>
        </aside>
      </div>
      <p v-else class="empty-tip">点击首页的“开始阅读”选择一篇材料开始学习。</p>
    </section>

    <section v-if="currentPanel === 'review'" class="review-layout surface-card">
      <header class="card-header review-header">
        <div>
          <h2>复习页</h2>
          <p class="muted-text">按词本切换复习范围，每轮可配题数。</p>
        </div>
      </header>

      <div class="review-controls">
        <select v-model="selectedNotebookId" @change="loadReviews">
          <option v-for="item in notebooks" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <div class="bucket-group">
          <button v-for="bucket in reviewBuckets" :key="bucket.value" :class="['bucket-btn', { active: reviewBucket === bucket.value }]" @click="switchReviewBucket(bucket.value)">
            {{ bucket.label }}
          </button>
        </div>
      </div>

      <div v-if="reviewData?.questions.length" class="review-question-block">
        <p class="review-counter">当前任务桶：{{ reviewData.bucket }} · 共 {{ reviewData.total }} 题</p>
        <div v-for="question in reviewData.questions" :key="question.word_id" class="quiz-question review-question">
          <strong>{{ question.prompt }}</strong>
          <label v-for="option in question.options" :key="option" class="option-row">
            <input v-model="reviewAnswers[question.word_id]" type="radio" :name="question.word_id" :value="option" />
            <span>{{ option }}</span>
          </label>
        </div>
        <button class="primary-btn" @click="submitReview">提交本轮反馈</button>
        <p v-if="reviewResultText" class="success-tip">{{ reviewResultText }}</p>
      </div>
      <p v-else class="empty-tip">当前词本还没有可复习内容</p>
    </section>

    <Teleport to="body">
      <div v-if="libraryDrawerOpen" class="drawer-mask" @click.self="libraryDrawerOpen = false">
        <aside class="drawer-panel">
          <header class="drawer-header">
            <div>
              <h2>学习库抽屉</h2>
              <p class="muted-text">切换库、查看当前库内容、上传短文、编辑本人短文</p>
            </div>
            <button class="icon-close" @click="libraryDrawerOpen = false">×</button>
          </header>

          <section class="drawer-section">
            <h3>学习库切换</h3>
            <div class="library-switch-list">
              <button v-for="item in libraries" :key="item.id" :class="['library-switch-btn', { active: selectedLibraryId === item.id }]" @click="selectLibrary(item.id)">
                <strong>{{ item.name }}</strong>
                <span>{{ item.material_count }} 篇</span>
              </button>
            </div>
          </section>

          <section class="drawer-section">
            <div class="section-heading">
              <h3>当前库内容</h3>
              <button class="link-btn" @click="startUpload">上传短文</button>
            </div>
            <ul v-if="libraryMaterials.length" class="material-list">
              <li v-for="item in libraryMaterials" :key="item.id">
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.summary || '暂无摘要' }}</p>
                  <small>{{ item.language }} · {{ getProcessingStatusLabel(item.processing_status) }} · {{ formatDate(item.updated_at) }}</small>
                  <p v-if="item.status_reason && item.processing_status !== 'ready'" class="status-reason">{{ item.status_reason }}</p>
                </div>
                <div class="item-actions">
                  <button class="secondary-btn" :disabled="!item.can_read" @click="openReading(item.id)">阅读</button>
                  <button v-if="item.can_edit" class="secondary-btn" @click="startEditingMaterial(item)">编辑</button>
                </div>
              </li>
            </ul>
            <p v-else class="empty-tip">当前库还没有材料</p>
          </section>

          <section class="drawer-section form-section">
            <h3>{{ editingMaterialId ? '编辑本人短文' : '上传短文' }}</h3>
            <div class="form-grid">
              <label>
                <span>标题</span>
                <input v-model="materialForm.title" type="text" />
              </label>
              <label>
                <span>语言</span>
                <select v-model="materialForm.language" :disabled="Boolean(editingMaterialId)">
                  <option value="en">en</option>
                  <option value="fr">fr</option>
                </select>
              </label>
              <label class="full-row">
                <span>摘要</span>
                <input v-model="materialForm.summary" type="text" />
              </label>
              <label class="full-row">
                <span>正文</span>
                <textarea v-model="materialForm.content" rows="6"></textarea>
              </label>
            </div>
            <div class="form-actions">
              <button class="secondary-btn" @click="resetMaterialForm">清空</button>
              <button class="primary-btn" @click="submitMaterialForm">{{ editingMaterialId ? '保存并重新处理' : '上传' }}</button>
            </div>
            <p v-if="materialFormFeedback" class="success-tip">{{ materialFormFeedback }}</p>
          </section>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type {
  ELSDashboard,
  ELSLibraryItem,
  ELSLibraryMaterial,
  ELSMaterialDetail,
  ELSNotebook,
  ELSQuizResponse,
  ELSReviewResponse,
} from '@/api/els'
import {
  collectELSWord,
  createELSMaterial,
  getELSDashboard,
  getELSLibraries,
  getELSLibraryMaterials,
  getELSMaterial,
  getELSMaterialQuiz,
  getELSNotebooks,
  getELSReviews,
  selectELSLibrary,
  submitELSMaterialQuiz,
  submitELSReviews,
  updateELSMaterial,
} from '@/api/els'

const currentPanel = ref<'dashboard' | 'reading' | 'review'>('dashboard')
const libraryDrawerOpen = ref(false)
const dashboard = ref<ELSDashboard | null>(null)
const libraries = ref<ELSLibraryItem[]>([])
const libraryMaterials = ref<ELSLibraryMaterial[]>([])
const currentMaterial = ref<ELSMaterialDetail | null>(null)
const notebooks = ref<ELSNotebook[]>([])
const quiz = ref<ELSQuizResponse | null>(null)
const reviewData = ref<ELSReviewResponse | null>(null)
const selectedLibraryId = ref('lib_public_default')
const selectedNotebookId = ref('nb_en_default')
const reviewBucket = ref<'today' | 'new' | 'wrong'>('today')
const quizAnswers = reactive<Record<string, string>>({})
const reviewAnswers = reactive<Record<string, string>>({})
const errorMessage = ref('')
const wordFeedback = ref('')
const quizResultText = ref('')
const reviewResultText = ref('')
const materialFormFeedback = ref('')
const editingMaterialId = ref('')
const materialForm = reactive({
  title: '',
  summary: '',
  content: '',
  language: 'en',
})

const quickCollectWords = [
  { word: 'develop', sentence: 'Children develop language quickly.' },
  { word: 'routine', sentence: 'A stable routine improves learning quality.' },
  { word: 'memory', sentence: 'Sleep helps the brain store memories.' },
]

const reviewBuckets = [
  { value: 'today' as const, label: '今天要复习' },
  { value: 'new' as const, label: '今天新词' },
  { value: 'wrong' as const, label: '高频错误词' },
]

const selectedLibraryMaterial = computed(() => {
  if (!currentMaterial.value) return null
  return libraryMaterials.value.find((item) => item.id === currentMaterial.value?.id) || null
})

const todayStatusLabel = computed(() => {
  if (!dashboard.value) return '加载中'
  if (dashboard.value.today_status.completed_reading && dashboard.value.today_status.completed_review) {
    return '今天已完成'
  }
  if (dashboard.value.today_status.completed_reading) {
    return '待复习'
  }
  return '未完成'
})

const ttsStatusLabel = computed(() => {
  if (!currentMaterial.value) return '等待选择材料'
  if (currentMaterial.value.tts.available) return '实时朗读已就绪（支持男声/女声切换）'
  return '当前不支持朗读'
})

const materialStatusLabel = computed(() => {
  if (!currentMaterial.value) return '等待选择材料'
  const status = currentMaterial.value.processing_status
  if (status === 'processing') return '内容处理中，暂不可学习'
  if (status === 'rejected') {
    const reason = currentMaterial.value.status_reason || '内容不适合学习'
    return `内容被驳回：${reason}`
  }
  if (status === 'failed') {
    const reason = currentMaterial.value.status_reason || '处理失败'
    return `处理失败：${reason}`
  }
  return '内容已就绪，可以学习'
})

const canStartQuiz = computed(() => {
  if (!currentMaterial.value) return false
  return currentMaterial.value.processing_status === 'ready' && currentMaterial.value.quiz_status === 'ready'
})

const quizButtonLabel = computed(() => {
  if (!currentMaterial.value) return '等待选择材料'
  if (currentMaterial.value.processing_status !== 'ready') return '内容暂不可学习'
  if (currentMaterial.value.quiz_status === 'pending') return '小测生成中'
  if (currentMaterial.value.quiz_status === 'failed') return '小测生成失败'
  return '开始小测'
})

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function getProcessingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    processing: '处理中',
    ready: '已就绪',
    rejected: '已驳回',
    failed: '处理失败',
  }
  return labels[status] || status
}

function toggleLibraryDrawer() {
  libraryDrawerOpen.value = !libraryDrawerOpen.value
  if (libraryDrawerOpen.value) {
    void loadLibraryMaterials(selectedLibraryId.value)
  }
}

async function bootstrap() {
  try {
    errorMessage.value = ''
    const [dashboardData, libraryData, notebookData] = await Promise.all([
      getELSDashboard(),
      getELSLibraries(),
      getELSNotebooks(),
    ])

    dashboard.value = dashboardData
    libraries.value = libraryData.items
    selectedLibraryId.value = libraryData.selected_library_id
    notebooks.value = notebookData.items
    selectedNotebookId.value = notebookData.selected_notebook_id

    await loadLibraryMaterials(selectedLibraryId.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败，请重试'
  }
}

async function loadLibraryMaterials(libraryId: string) {
  const data = await getELSLibraryMaterials(libraryId)
  libraryMaterials.value = data.items
}

async function selectLibrary(libraryId: string) {
  await selectELSLibrary(libraryId)
  selectedLibraryId.value = libraryId
  await Promise.all([bootstrap(), loadLibraryMaterials(libraryId)])
}

async function openReading(materialId: string) {
  currentPanel.value = 'reading'
  quiz.value = null
  quizResultText.value = ''
  wordFeedback.value = ''
  currentMaterial.value = await getELSMaterial(materialId)
}

async function openReadingFromDashboard() {
  const targetId = dashboard.value?.recommended_material?.id || libraryMaterials.value.find((item) => item.can_read)?.id
  if (!targetId) {
    errorMessage.value = '当前库暂无可学习材料'
    return
  }
  await openReading(targetId)
}

async function loadQuiz() {
  if (!currentMaterial.value) return
  quiz.value = await getELSMaterialQuiz(currentMaterial.value.id)
  quizResultText.value = ''
  Object.keys(quizAnswers).forEach((key) => delete quizAnswers[key])
}

async function submitQuiz() {
  if (!currentMaterial.value || !quiz.value) return
  const answers = quiz.value.questions.map((question) => ({
    question_id: question.id,
    answer: quizAnswers[question.id] || '',
  }))
  const result = await submitELSMaterialQuiz(currentMaterial.value.id, answers)
  quizResultText.value = `小测完成：${result.correct_count}/${result.total}，下一步 ${result.next_action}`
}

async function collectWord(word: string, sentence: string) {
  if (!currentMaterial.value) return
  const result = await collectELSWord({
    material_id: currentMaterial.value.id,
    word_text: word,
    sentence,
  })
  wordFeedback.value = `已加入 ${result.word.language} 词本：${result.word.notebook_id}`
}

async function openReviewPanel() {
  currentPanel.value = 'review'
  await loadReviews()
}

async function loadReviews() {
  reviewResultText.value = ''
  reviewData.value = await getELSReviews({
    bucket: reviewBucket.value,
    notebook_id: selectedNotebookId.value,
    size: 5,
  })
  Object.keys(reviewAnswers).forEach((key) => delete reviewAnswers[key])
}

async function switchReviewBucket(bucket: 'today' | 'new' | 'wrong') {
  reviewBucket.value = bucket
  await loadReviews()
}

async function submitReview() {
  if (!reviewData.value) return
  const results: Parameters<typeof submitELSReviews>[0]['results'] = reviewData.value.questions.map((question) => ({
    word_id: question.word_id,
    review_type: question.review_type,
    answer: reviewAnswers[question.word_id] || '',
    is_correct: Boolean(reviewAnswers[question.word_id]),
    self_rating: 'easy',
  }))
  const result = await submitELSReviews({
    session_id: reviewData.value.session_id,
    bucket: reviewData.value.bucket,
    results,
  })
  reviewResultText.value = `本轮总结：${result.session_summary.correct_count}/${result.session_summary.total}，剩余待复习 ${result.review_stats.today_due_remaining}`
}

function startUpload() {
  editingMaterialId.value = ''
  materialForm.title = ''
  materialForm.summary = ''
  materialForm.content = ''
  materialForm.language = 'en'
  materialFormFeedback.value = ''
}

function startEditingMaterial(item: ELSLibraryMaterial) {
  editingMaterialId.value = item.id
  materialForm.title = item.title
  materialForm.summary = item.summary || ''
  materialForm.content = 'Updated content...'
  materialForm.language = item.language
  materialFormFeedback.value = ''
  libraryDrawerOpen.value = true
}

function resetMaterialForm() {
  startUpload()
}

async function submitMaterialForm() {
  if (!materialForm.title || !materialForm.content) {
    materialFormFeedback.value = '标题和正文不能为空'
    return
  }

  if (editingMaterialId.value) {
    await updateELSMaterial(editingMaterialId.value, {
      title: materialForm.title,
      summary: materialForm.summary,
      content: materialForm.content,
    })
    materialFormFeedback.value = '已重新进入处理'
  } else {
    await createELSMaterial({
      library_id: selectedLibraryId.value,
      title: materialForm.title,
      summary: materialForm.summary,
      content: materialForm.content,
      language: materialForm.language,
      tags: [],
    })
    materialFormFeedback.value = '上传成功，内容处理中'
  }

  await loadLibraryMaterials(selectedLibraryId.value)
}

onMounted(() => {
  void bootstrap()
})
</script>

<style scoped>
.els-view {
  min-height: 100%;
  padding: 24px;
  background: linear-gradient(180deg, #f6f8ff 0%, #f8fafc 40%, #eef4ff 100%);
  color: #1f2937;
}

.hero-card,
.surface-card {
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
}

.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 28px;
  margin-bottom: 20px;
}

.hero-kicker {
  margin: 0 0 8px;
  color: #4f46e5;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.hero-card h1 {
  margin: 0;
  font-size: 32px;
}

.hero-summary {
  max-width: 680px;
  margin: 10px 0 0;
  color: #475569;
}

.hero-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 12px;
  min-width: 280px;
}

.metric-chip {
  padding: 18px;
  border-radius: 16px;
  background: linear-gradient(135deg, #312e81, #4f46e5);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-chip span {
  font-size: 13px;
  opacity: 0.78;
}

.metric-chip strong {
  font-size: 18px;
}

.panel-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.tab-btn,
.primary-btn,
.secondary-btn,
.link-btn,
.bucket-btn,
.library-switch-btn,
.tag-btn,
.icon-close {
  border: none;
  cursor: pointer;
  transition: 0.2s ease;
}

.tab-btn {
  padding: 12px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: #334155;
}

.tab-btn.active {
  background: #1d4ed8;
  color: #fff;
}

.tab-btn.secondary {
  background: #e2e8f0;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.surface-card {
  padding: 22px;
}

.task-card,
.library-card,
.recent-card {
  min-height: 250px;
}

.card-header,
.section-heading,
.drawer-header,
.reading-header,
.review-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-header h2,
.drawer-header h2,
.section-heading h3,
.side-box h3 {
  margin: 0;
  font-size: 18px;
}

.task-actions,
.task-stats,
.form-actions,
.header-actions,
.item-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.primary-btn,
.secondary-btn,
.link-btn,
.bucket-btn,
.tag-btn,
.library-switch-btn {
  padding: 10px 14px;
  border-radius: 12px;
}

.primary-btn {
  background: #2563eb;
  color: #fff;
}

.secondary-btn,
.library-switch-btn {
  background: #e2e8f0;
  color: #1e293b;
}

.link-btn {
  padding: 0;
  background: transparent;
  color: #2563eb;
}

.bucket-btn.active,
.library-switch-btn.active,
.tag-btn {
  background: #dbeafe;
  color: #1d4ed8;
}

.task-stats {
  margin-top: 18px;
}

.task-stats div,
.recommended-box {
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
}

.task-stats div {
  min-width: 92px;
}

.task-stats span,
.mini-label,
.muted-text,
.option-row span,
.drawer-section small {
  color: #64748b;
}

.task-stats strong,
.card-title {
  display: block;
  margin-top: 6px;
  font-size: 22px;
  color: #0f172a;
}

.recommended-box {
  margin-top: 16px;
}

.recommended-box p,
.article-summary,
.empty-tip,
.drawer-section p,
.hero-summary {
  line-height: 1.6;
}

.list-stack {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
  display: grid;
  gap: 14px;
}

.list-stack li,
.material-list li {
  padding: 14px 16px;
  border-radius: 14px;
  background: #f8fafc;
}

.list-stack span,
.review-counter,
.page-error,
.success-tip,
.empty-tip {
  font-size: 14px;
}

.page-error {
  margin: 0 0 16px;
  color: #b91c1c;
}

.reading-layout,
.review-layout {
  display: grid;
  gap: 20px;
}

.reading-body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
  gap: 20px;
}

.article-panel,
.side-box,
.review-question-block {
  border-radius: 18px;
  background: #f8fafc;
  padding: 18px;
}

.article-content {
  white-space: pre-line;
  line-height: 1.9;
  color: #1e293b;
}

.status-warning {
  padding: 16px;
  border-radius: 12px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}

.status-reason {
  margin-top: 6px;
  font-size: 12px;
  color: #dc2626;
}

.reading-side-panel {
  display: grid;
  gap: 16px;
}

.word-actions,
.bucket-group,
.library-switch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.full-width {
  width: 100%;
}

.quiz-block,
.review-controls,
.drawer-section,
.form-grid {
  display: grid;
  gap: 14px;
}

.quiz-question {
  display: grid;
  gap: 10px;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  justify-content: flex-end;
  z-index: 30;
}

.drawer-panel {
  width: min(720px, 100%);
  height: 100%;
  background: #fff;
  padding: 24px;
  overflow-y: auto;
  box-shadow: -24px 0 40px rgba(15, 23, 42, 0.16);
}

.icon-close {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #e2e8f0;
  font-size: 24px;
}

.material-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}

.material-list li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid label {
  display: grid;
  gap: 8px;
  color: #334155;
}

.form-grid input,
.form-grid select,
.review-controls select,
.form-grid textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #cbd5e1;
  font: inherit;
  box-sizing: border-box;
}

.full-row {
  grid-column: 1 / -1;
}

@media (max-width: 1080px) {
  .dashboard-grid,
  .reading-body {
    grid-template-columns: 1fr;
  }

  .hero-card {
    flex-direction: column;
  }

  .hero-metrics {
    min-width: 0;
  }
}

@media (max-width: 720px) {
  .els-view {
    padding: 16px;
  }

  .form-grid,
  .hero-metrics {
    grid-template-columns: 1fr;
  }

  .material-list li,
  .card-header,
  .drawer-header,
  .reading-header,
  .review-header,
  .section-heading {
    flex-direction: column;
  }

  .drawer-panel {
    width: 100%;
    padding: 18px;
  }
}
</style>
