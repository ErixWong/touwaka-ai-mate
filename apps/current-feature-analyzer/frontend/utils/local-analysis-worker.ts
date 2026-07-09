import type { AppConfig, CompressionAlgorithmKey, FileAnalysisResult } from '../api/current-feature-analyzer'
import { runLocalCurrentFeatureAnalysis } from './local-analysis'

type PendingTask = {
  resolve: (value: FileAnalysisResult) => void
  reject: (reason?: unknown) => void
}

let workerInstance: Worker | null = null
const pendingTasks = new Map<string, PendingTask>()

function cloneRawData(rawData: number[][]) {
  return rawData.map((point) => [Number(point?.[0] ?? 0), Number(point?.[1] ?? 0)])
}

function cloneAppConfig(appConfig: AppConfig | null): AppConfig | null {
  if (!appConfig) {
    return null
  }

  return {
    ...appConfig,
    ui: { ...appConfig.ui },
    export: { ...appConfig.export },
  }
}

function getWorker() {
  if (typeof Worker === 'undefined') {
    return null
  }

  if (!workerInstance) {
    workerInstance = new Worker(new URL('../workers/local-analysis.worker.ts', import.meta.url), { type: 'module' })
    workerInstance.onmessage = (event: MessageEvent<{ request_id: string; ok: boolean; result?: FileAnalysisResult; error_message?: string }>) => {
      const payload = event.data
      const task = pendingTasks.get(payload.request_id)
      if (!task) {
        return
      }

      pendingTasks.delete(payload.request_id)
      if (payload.ok && payload.result) {
        task.resolve(payload.result)
        return
      }

      task.reject(new Error(payload.error_message || '前端分析失败'))
    }
  }

  return workerInstance
}

export async function runLocalCurrentFeatureAnalysisAsync(rawData: number[][], appConfig: AppConfig | null, algorithmKey: CompressionAlgorithmKey = 'envelope_turning_points_v3') {
  const worker = getWorker()
  if (!worker) {
    return runLocalCurrentFeatureAnalysis(rawData, appConfig, algorithmKey)
  }

  const safeRawData = cloneRawData(rawData)
  const safeAppConfig = cloneAppConfig(appConfig)

  return await new Promise<FileAnalysisResult>((resolve, reject) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    pendingTasks.set(requestId, { resolve, reject })

    try {
      worker.postMessage({
        request_id: requestId,
        raw_data: safeRawData,
        app_config: safeAppConfig,
        algorithm_key: algorithmKey,
      })
    } catch (error) {
      pendingTasks.delete(requestId)
      try {
        resolve(runLocalCurrentFeatureAnalysis(safeRawData, safeAppConfig, algorithmKey))
      } catch (fallbackError) {
        reject(fallbackError instanceof Error ? fallbackError : error)
      }
    }
  })
}
