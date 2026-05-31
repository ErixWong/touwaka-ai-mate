import apiClient, { apiRequest } from './client'

export interface OcrAnalyzeResponse {
  task_id: string
  status: string
}

export interface OcrStatusResponse {
  task_id: string
  status: string
  result: string
  error: string
}

export interface OcrPromptPreset {
  id: string
  label: string
  prompt: string
}

export interface OcrPresetsResponse {
  presets: OcrPromptPreset[]
  defaultId: string
}

export function analyzeOcrImage(image: string, prompt?: string) {
  return apiRequest<OcrAnalyzeResponse>(
    apiClient.post('/ocr/analyze', { image, prompt })
  )
}

export function getOcrStatus(taskId: string) {
  return apiRequest<OcrStatusResponse>(
    apiClient.get(`/ocr/status/${taskId}`)
  )
}

export function getOcrPromptPresets() {
  return apiRequest<OcrPresetsResponse>(
    apiClient.get('/ocr/presets')
  )
}
