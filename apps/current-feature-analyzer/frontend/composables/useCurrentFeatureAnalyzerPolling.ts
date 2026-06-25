import { onBeforeUnmount, getCurrentInstance, type Ref } from 'vue'
import { currentFeatureAnalyzerApi } from '../api/current-feature-analyzer'
import { APIError } from '@/api/client'
import type { BatchStatus, BatchSession, SessionFileItem, BatchSummary } from '../api/current-feature-analyzer'

export function useCurrentFeatureAnalyzerPolling(
  batchId: Ref<string | null>,
  batchStatus: Ref<BatchStatus>,
  files: Ref<SessionFileItem[]>,
  summary: Ref<BatchSummary | null>,
  loading: Ref<boolean>,
  handlers?: {
    onBatchLoaded?: (batch: BatchSession) => void
    mergeFiles?: (incomingFiles: SessionFileItem[]) => void
    onSessionExpired?: () => void
    onError?: (message: string) => void
  },
) {
  let timerId: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let generation = 0
  const POLLING_INTERVAL_MS = 2000
  const instance = getCurrentInstance()

  function stopPolling() {
    generation++
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  async function pollOnce(myGen: number) {
    if (!batchId.value || batchStatus.value !== 'analyzing') {
      stopPolling()
      return
    }
    if (inFlight) return

    inFlight = true
    try {
      const batch = await currentFeatureAnalyzerApi.getBatch(batchId.value)
      if (myGen !== generation) return

      if (handlers?.mergeFiles) {
        handlers.mergeFiles(batch.files || [])
      } else {
        files.value = batch.files || []
      }
      batchStatus.value = batch.batch_status || 'analyzing'
      summary.value = batch.summary
      handlers?.onBatchLoaded?.(batch)

      if (batchStatus.value !== 'analyzing') {
        stopPolling()
        loading.value = false
        return
      }
    } catch (err: unknown) {
      if (err instanceof APIError && [400, 403, 404].includes(err.status ?? 0)) {
        stopPolling()
        loading.value = false
        if (err.status === 404) {
          handlers?.onSessionExpired?.()
        } else {
          batchStatus.value = 'failed'
          handlers?.onError?.(err.message || '分析状态获取失败')
        }
        return
      }
    } finally {
      inFlight = false
    }

    if (batchId.value && batchStatus.value === 'analyzing' && generation === myGen) {
      timerId = setTimeout(() => {
        timerId = null
        pollOnce(myGen)
      }, POLLING_INTERVAL_MS)
    }
  }

  function startPolling() {
    stopPolling()
    const myGen = generation
    pollOnce(myGen)
  }

  if (instance) {
    onBeforeUnmount(() => {
      stopPolling()
    })
  }

  return { startPolling, stopPolling }
}
