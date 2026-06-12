import apiClient, { apiRequest } from './client'

export interface ELSTodayStatus {
  is_checked_in: boolean
  completed_reading: boolean
  completed_review: boolean
  streak_days: number
}

export interface ELSLibrarySummary {
  id: string
  name: string
  material_count: number
}

export interface ELSRecommendedMaterial {
  id: string
  title: string
  difficulty_level?: string
  summary?: string
}

export interface ELSDashboard {
  today_status: ELSTodayStatus
  selected_library: ELSLibrarySummary
  recommended_material: ELSRecommendedMaterial | null
  review_stats: {
    today_due: number
    new_words?: number
    wrong_words: number
  }
  recent_materials: Array<{
    id: string
    title: string
    last_opened_at: string
  }>
}

export interface ELSLibraryItem {
  id: string
  name: string
  type: 'public' | 'personal' | 'shared'
  material_count: number
  is_selected: boolean
}

export interface ELSLibraryListResponse {
  selected_library_id: string
  items: ELSLibraryItem[]
}

export interface ELSLibraryMaterial {
  id: string
  title: string
  summary?: string
  language: string
  processing_status: string
  safety_status: string
  quiz_status: string
  tts_status: string
  can_read: boolean
  can_edit: boolean
  updated_at: string
}

export interface ELSLibraryMaterialsResponse {
  library: {
    id: string
    name: string
    type: 'public' | 'personal' | 'shared'
  }
  items: ELSLibraryMaterial[]
}

export interface ELSMaterialDetail {
  id: string
  library_id: string
  library_name: string
  title: string
  difficulty_level?: string
  content: string
  summary?: string
  language: string
  processing_status: string
  quiz_status: string
  tts_status: string
  tts: {
    available: boolean
    audio_url: string | null
    speeds: number[]
  }
  progress: {
    is_read: boolean
    collected_word_count: number
  }
}

export interface ELSNotebook {
  id: string
  language: string
  name: string
  word_count: number
  is_selected: boolean
}

export interface ELSNotebookListResponse {
  selected_notebook_id: string
  items: ELSNotebook[]
}

export interface ELSWordCollectResponse {
  word: {
    id: string
    word_text: string
    meaning: string
    phonetic?: string
    pronunciation_audio?: string
    sentence: string
    notebook_id: string
    language: string
    review_stage: string
  }
  already_exists: boolean
}

export interface ELSQuizQuestion {
  id: string
  type: string
  prompt: string
  options: string[]
}

export interface ELSQuizResponse {
  material_id: string
  questions: ELSQuizQuestion[]
}

export interface ELSQuizSubmitResponse {
  correct_count: number
  total: number
  explanations: Array<{
    question_id: string
    is_correct: boolean
    explanation: string
  }>
  reading_completed: boolean
  next_action: string
}

export interface ELSReviewQuestion {
  word_id: string
  review_type: string
  audio_url: string | null
  prompt: string
  options: string[]
}

export interface ELSReviewResponse {
  bucket: string
  notebook_id: string
  session_id: string
  questions: ELSReviewQuestion[]
  total: number
}

export interface ELSReviewSubmitResponse {
  session_summary: {
    correct_count: number
    total: number
    needs_repeat: number
  }
  review_stats: {
    today_due_remaining: number
    wrong_words: number
  }
  today_review_completed: boolean
}

export interface ELSCheckinResponse {
  is_checked_in: boolean
  completed_reading: boolean
  completed_review: boolean
  streak_days: number
  day_type: string
}

export function getELSDashboard() {
  return apiRequest<ELSDashboard>(apiClient.get('/els/dashboard'))
}

export function getELSLibraries() {
  return apiRequest<ELSLibraryListResponse>(apiClient.get('/els/libraries'))
}

export function selectELSLibrary(libraryId: string) {
  return apiRequest<{ selected_library_id: string; selected_library_name: string }>(
    apiClient.post('/els/libraries/select', { library_id: libraryId }),
  )
}

export function getELSLibraryMaterials(libraryId: string) {
  return apiRequest<ELSLibraryMaterialsResponse>(apiClient.get(`/els/libraries/${libraryId}/materials`))
}

export function getELSRecommendedMaterials(libraryId?: string) {
  return apiRequest<{ items: Array<ELSMaterialDetail & { estimated_minutes?: number }> }>(
    apiClient.get('/els/materials/recommended', { params: libraryId ? { library_id: libraryId } : {} }),
  )
}

export function getELSMaterial(materialId: string) {
  return apiRequest<ELSMaterialDetail>(apiClient.get(`/els/materials/${materialId}`))
}

export function createELSMaterial(payload: {
  library_id: string
  title: string
  summary?: string
  content: string
  language: string
  tags?: string[]
}) {
  return apiRequest(apiClient.post('/els/materials', payload))
}

export function updateELSMaterial(materialId: string, payload: {
  title?: string
  summary?: string
  content?: string
  tags?: string[]
}) {
  return apiRequest(apiClient.put(`/els/materials/${materialId}`, payload))
}

export function getELSNotebooks() {
  return apiRequest<ELSNotebookListResponse>(apiClient.get('/els/notebooks'))
}

export function selectELSNotebook(notebookId: string) {
  return apiRequest<{ selected_notebook_id: string; selected_notebook_name: string }>(
    apiClient.post('/els/notebooks/select', { notebook_id: notebookId }),
  )
}

export function collectELSWord(payload: {
  material_id: string
  word_text: string
  sentence: string
  offset_start?: number
  offset_end?: number
}) {
  return apiRequest<ELSWordCollectResponse>(apiClient.post('/els/words', payload))
}

export function getELSMaterialQuiz(materialId: string) {
  return apiRequest<ELSQuizResponse>(apiClient.get(`/els/materials/${materialId}/quiz`))
}

export function submitELSMaterialQuiz(materialId: string, answers: Array<{ question_id: string; answer: string }>) {
  return apiRequest<ELSQuizSubmitResponse>(apiClient.post(`/els/materials/${materialId}/quiz/submit`, { answers }))
}

export function getELSReviews(params: { bucket: string; notebook_id: string; size?: number }) {
  return apiRequest<ELSReviewResponse>(apiClient.get('/els/reviews', { params }))
}

export function submitELSReviews(payload: {
  session_id: string
  bucket: string
  results: Array<{
    word_id: string
    review_type: string
    answer: string
    is_correct: boolean
    self_rating: string
  }>
}) {
  return apiRequest<ELSReviewSubmitResponse>(apiClient.post('/els/reviews/submit', payload))
}

export function getELSCheckin() {
  return apiRequest<ELSCheckinResponse>(apiClient.get('/els/checkin'))
}
