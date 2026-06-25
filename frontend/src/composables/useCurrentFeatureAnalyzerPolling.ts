import { ref, onBeforeUnmount, getCurrentInstance, type Ref } from 'vue'
import { currentFeatureAnalyzerApi } from '@/api/current-feature-analyzer'
import type { BatchStatus, SessionFileItem, BatchSummary } from '@/api/current-feature-analyzer'

/**
 * current-feature-analyzer 轮询 composable
 *
 * 职责：管理分析进度轮询生命周期，将轮询逻辑从 store 中分离。
 *
 * 并发控制：
 * - 使用 setTimeout 串行轮询，确保同一时刻最多 1 个在途请求
 * - inFlight 锁防止并发启动
 * - generation 代际标记防止旧响应覆盖新状态
 *
 * **生命周期约束：**
 * - 在组件 setup 中调用时，会自动注册 onBeforeUnmount 清理（无需手动 stopPolling）
 * - 在 Pinia store 等非组件上下文中调用时，调用方必须确保在适当时机调用 stopPolling()
 */
export function useCurrentFeatureAnalyzerPolling(
  batchId: Ref<string | null>,
  batchStatus: Ref<BatchStatus>,
  files: Ref<SessionFileItem[]>,
  summary: Ref<BatchSummary | null>,
  loading: Ref<boolean>,
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
    // 不重置 inFlight：让在途请求自然完成，generation 检查会阻止旧数据写入
  }

  async function pollOnce(myGen: number) {
    // 前置条件检查
    if (!batchId.value || batchStatus.value !== 'analyzing') {
      stopPolling()
      return
    }
    // 并发锁：已有在途请求则跳过本次
    if (inFlight) return

    inFlight = true
    try {
      const batch = await currentFeatureAnalyzerApi.getBatch(batchId.value)
      // 代际检查：stopPolling 被调用后旧响应不再写入
      if (myGen !== generation) return

      files.value = batch.files || []
      batchStatus.value = batch.batch_status || 'analyzing'
      summary.value = batch.summary

      if (batchStatus.value !== 'analyzing') {
        stopPolling()
        loading.value = false
        return
      }
    } catch {
      // 轮询失败不报错，下次重试
    } finally {
      inFlight = false
    }

    // 串行调度下一轮：仅在当前代际仍有效时继续
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

  // 组件上下文自动清理：当在组件 setup 中调用时，组件卸载自动停止轮询
  if (instance) {
    onBeforeUnmount(() => {
      stopPolling()
    })
  }

  return { startPolling, stopPolling }
}
