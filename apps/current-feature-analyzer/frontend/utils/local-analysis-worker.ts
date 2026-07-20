import type { AppConfig, CompressionAlgorithmKey, FileAnalysisResult } from '../api/current-feature-analyzer'
import { runLocalCurrentFeatureAnalysis } from './local-analysis'

type PendingTask = {
  resolve: (value: FileAnalysisResult) => void
  reject: (reason?: unknown) => void
  raw_data: number[][]
  app_config: AppConfig | null
  algorithm_key: CompressionAlgorithmKey
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
    workerInstance.onerror = () => {
      // Worker 脚本加载失败（如 dev 环境静态服务拦截）时，回退到同步分析，避免任务悬挂
      const tasks = [...pendingTasks.values()]
      pendingTasks.clear()
      workerInstance = null
      for (const task of tasks) {
        try {
          task.resolve(runLocalCurrentFeatureAnalysis(task.raw_data, task.app_config, task.algorithm_key))
        } catch (error) {
          task.reject(error)
        }
      }
    }
  }

  return workerInstance
}

export async function runLocalCurrentFeatureAnalysisAsync(rawData: number[][], appConfig: AppConfig | null, algorithmKey: CompressionAlgorithmKey = 'adaptive_v2') {
  const worker = getWorker()
  if (!worker) {
    return runLocalCurrentFeatureAnalysis(rawData, appConfig, algorithmKey)
  }

  const safeRawData = cloneRawData(rawData)
  const safeAppConfig = cloneAppConfig(appConfig)

  return await new Promise<FileAnalysisResult>((resolve, reject) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    pendingTasks.set(requestId, {
      resolve,
      reject,
      raw_data: safeRawData,
      app_config: safeAppConfig,
      algorithm_key: algorithmKey,
    })

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
