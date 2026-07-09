import { runLocalCurrentFeatureAnalysis } from '../utils/local-analysis'
import type { AppConfig, CompressionAlgorithmKey } from '../api/current-feature-analyzer'

type AnalysisWorkerRequest = {
  request_id: string
  raw_data: number[][]
  app_config: AppConfig | null
  algorithm_key?: CompressionAlgorithmKey
}

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const payload = event.data

  try {
    const result = runLocalCurrentFeatureAnalysis(payload.raw_data, payload.app_config, payload.algorithm_key)
    self.postMessage({
      request_id: payload.request_id,
      ok: true,
      result,
    })
  } catch (error) {
    self.postMessage({
      request_id: payload.request_id,
      ok: false,
      error_message: error instanceof Error ? error.message : '前端分析失败',
    })
  }
}
