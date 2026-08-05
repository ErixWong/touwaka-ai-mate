/**
 * standard-mgr Pinia Store
 *
 * 状态管理规则（审计要求）：
 * - 不新增任何前端侧状态机
 * - 计数字段以服务端为唯一真相，禁止前端重算
 * - anchor_build_status 直接展示服务端字段
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  listStandards,
  getStandard,
  listAnchoredSections,
  listRefAnchors,
  listGaps,
  updateBuildStatus,
  writeAnchorResult,
  type StandardItem,
  type RefAnchor,
  type GapItem,
  type AnchoredSection,
} from '../api/standard-mgr'
import { useToastStore } from '@/stores/toast'

export const useStandardMgrStore = defineStore('standardMgr', () => {
  // ============================================================
  // 状态
  // ============================================================

  const standards = ref<StandardItem[]>([])
  const selectedStandardId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 详情数据
  const standardDetail = ref<StandardItem | null>(null)
  const anchoredSections = ref<AnchoredSection[]>([])
  const refAnchors = ref<RefAnchor[]>([])
  const gaps = ref<GapItem[]>([])

  // UI 状态
  const selectedAnchorId = ref<string | null>(null)
  const rebuildLoading = ref(false)
  const rebuildError = ref<string | null>(null)

  // ============================================================
  // 计算属性
  // ============================================================

  const selectedStandard = computed(() => {
    return standards.value.find(s => s.id === selectedStandardId.value) || null
  })

  /** 锚点 ID → 状态映射（供正文渲染着色） */
  const anchorStatusMap = computed(() => {
    const map = new Map<string, string>()
    for (const a of refAnchors.value) {
      map.set(a.id, a.status)
    }
    return map
  })

  /** 按 outline_id 分组的锚点 */
  const anchorsByOutline = computed(() => {
    const groups: Record<string, RefAnchor[]> = {}
    for (const a of refAnchors.value) {
      const key = a.source_outline_id
      if (!groups[key]) groups[key] = []
      groups[key].push(a)
    }
    return groups
  })

  // ============================================================
  // 操作
  // ============================================================

  async function fetchStandards() {
    loading.value = true
    error.value = null
    try {
      standards.value = await listStandards()
    } catch (err: any) {
      const msg = err?.message || '加载标准列表失败'
      error.value = msg
      useToastStore().error(msg)
    } finally {
      loading.value = false
    }
  }

  async function selectStandard(standardId: string) {
    selectedStandardId.value = standardId
    standardDetail.value = null
    anchoredSections.value = []
    refAnchors.value = []
    gaps.value = []
    selectedAnchorId.value = null

    await Promise.all([
      fetchStandardDetail(standardId),
      fetchAnchoredSections(standardId),
      fetchRefAnchors(standardId),
    ])
  }

  async function fetchStandardDetail(standardId: string) {
    try {
      standardDetail.value = await getStandard(standardId)
    } catch (err: any) {
      useToastStore().error(err?.message || '加载标准详情失败')
    }
  }

  async function fetchAnchoredSections(standardId: string) {
    try {
      anchoredSections.value = await listAnchoredSections(standardId)
    } catch (err: any) {
      // 副本可能不存在（尚未清洗），静默处理
      anchoredSections.value = []
    }
  }

  async function fetchRefAnchors(standardId: string) {
    try {
      refAnchors.value = await listRefAnchors(standardId, { limit: 500 })
    } catch (err: any) {
      useToastStore().error(err?.message || '加载引用锚点失败')
    }
  }

  async function fetchGaps(standardId: string) {
    try {
      gaps.value = await listGaps(standardId)
    } catch (err: any) {
      useToastStore().error(err?.message || '加载 gap 列表失败')
    }
  }

  /** 触发重建/清洗 */
  async function triggerRebuild(standardId: string) {
    rebuildLoading.value = true
    rebuildError.value = null
    try {
      // 先设为 processing
      await updateBuildStatus(standardId, 'processing')
      // 刷新详情获取最新状态
      await fetchStandardDetail(standardId)

      // 轮询直到 done 或 error
      const result = await pollBuildStatus(standardId)
      if (result.anchor_build_status === 'error') {
        rebuildError.value = result.last_anchor_build_error || '清洗失败'
        useToastStore().error(rebuildError.value!)
      } else {
        useToastStore().success('清洗完成')
        // 刷新所有数据
        await selectStandard(standardId)
      }
    } catch (err: any) {
      const msg = err?.message || '触发清洗失败'
      rebuildError.value = msg
      useToastStore().error(msg)
      await fetchStandardDetail(standardId)
    } finally {
      rebuildLoading.value = false
    }
  }

  async function pollBuildStatus(standardId: string): Promise<StandardItem> {
    const maxAttempts = 120 // 最多等 10 分钟（每 5 秒一次）
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const detail = await getStandard(standardId)
      if (detail.anchor_build_status === 'done' || detail.anchor_build_status === 'error') {
        return detail
      }
    }
    throw new Error('清洗超时（超过 10 分钟）')
  }

  /** 人工修正：写入锚点结果 */
  async function submitManualFix(data: {
    standard_id: string
    source_revision_id: string
    source_outline_id: string
    occurrence_index: number
    source_text: string
    ref_type: string
    status: 'valid' | 'invalid'
    target_document_id?: string
    target_revision_id?: string
    target_outline_id?: string
    status_reason?: string
  }) {
    try {
      await writeAnchorResult({
        ...data,
        source: 'manual',
      })
      useToastStore().success('修正已保存')
      // 刷新数据
      if (selectedStandardId.value) {
        await selectStandard(selectedStandardId.value)
      }
    } catch (err: any) {
      useToastStore().error(err?.message || '保存修正失败')
      throw err
    }
  }

  // ============================================================
  // 返回
  // ============================================================

  return {
    // 状态
    standards,
    selectedStandardId,
    loading,
    error,
    standardDetail,
    anchoredSections,
    refAnchors,
    gaps,
    selectedAnchorId,
    rebuildLoading,
    rebuildError,
    // 计算
    selectedStandard,
    anchorStatusMap,
    anchorsByOutline,
    // 操作
    fetchStandards,
    selectStandard,
    fetchGaps,
    triggerRebuild,
    submitManualFix,
  }
})
