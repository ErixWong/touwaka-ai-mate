/**
 * standard-mgr Pinia Store
 *
 * 状态管理规则（审计要求）：
 * - 不新增任何前端侧状态机
 * - 计数字段以服务端为唯一真相，禁止前端重算
 * - anchor_build_status 直接展示服务端字段
 *
 * R8-4: 多标准详情页签支持
 * - openTabs + activeTabId 管理页签生命周期
 * - tabCaches 按 standard_id 缓存详情/副本/锚点
 * - selectedStandardId / standardDetail 等保持向后兼容（computed from active tab）
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
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
import { i18n } from '@/i18n'

// ============================================================
// R8-4: 页签/缓存类型
// ============================================================

interface StandardTabDescriptor {
  standard_id: string
  standard_code: string
  standard_name: string
}

interface TabCache {
  detail: StandardItem | null
  sections: AnchoredSection[]
  anchors: RefAnchor[]
  gaps: GapItem[]
}

// ============================================================
// Store
// ============================================================

export const useStandardMgrStore = defineStore('standardMgr', () => {
  // ============================================================
  // 状态
  // ============================================================

  const standards = ref<StandardItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // R8-4: 多页签管理
  const openTabs = ref<StandardTabDescriptor[]>([])
  const activeTabId = ref<string | null>(null)
  const tabCaches = ref<Record<string, TabCache>>({})

  // UI 状态
  const selectedAnchorId = ref<string | null>(null)
  const rebuildLoading = ref(false)
  const rebuildError = ref<string | null>(null)

  // ============================================================
  // 向后兼容的计算属性（从 active tab 派生）
  // ============================================================

  /** @deprecated R8-4: 用 activeTabId 代替，保留兼容 */
  const selectedStandardId = computed(() => activeTabId.value)

  const selectedStandard = computed(() => {
    return standards.value.find(s => s.id === activeTabId.value) || null
  })

  /** 当前激活页签的详情 */
  const standardDetail = computed(() => {
    const id = activeTabId.value
    return id ? (tabCaches.value[id]?.detail ?? null) : null
  })

  /** 当前激活页签的副本 */
  const anchoredSections = computed(() => {
    const id = activeTabId.value
    return id ? (tabCaches.value[id]?.sections ?? []) : []
  })

  /** 当前激活页签的锚点 */
  const refAnchors = computed(() => {
    const id = activeTabId.value
    return id ? (tabCaches.value[id]?.anchors ?? []) : []
  })

  /** 当前激活页签的 gaps */
  const gaps = computed(() => {
    const id = activeTabId.value
    return id ? (tabCaches.value[id]?.gaps ?? []) : []
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
  // R8-4: 页签操作
  // ============================================================

  /** 确保缓存槽存在 */
  function ensureCache(standardId: string): TabCache {
    if (!tabCaches.value[standardId]) {
      tabCaches.value[standardId] = { detail: null, sections: [], anchors: [], gaps: [] }
    }
    return tabCaches.value[standardId]
  }

  /** 打开/切换到标准 */
  function openTab(standardId: string) {
    // 查找已有页签
    const existing = openTabs.value.find(t => t.standard_id === standardId)

    if (!existing) {
      const std = standards.value.find(s => s.id === standardId)
      if (!std) return
      openTabs.value.push({
        standard_id: standardId,
        standard_code: std.standard_code || '',
        standard_name: std.standard_name || '',
      })
    }

    // 切到该页签
    activeTabId.value = standardId
    selectedAnchorId.value = null
  }

  /** 关闭页签 */
  function closeTab(standardId: string) {
    const idx = openTabs.value.findIndex(t => t.standard_id === standardId)
    if (idx === -1) return

    openTabs.value.splice(idx, 1)
    // 清理缓存
    delete tabCaches.value[standardId]

    // 激活相邻页签
    if (activeTabId.value === standardId) {
      if (openTabs.value.length > 0) {
        const next = openTabs.value[Math.min(idx, openTabs.value.length - 1)]
        if (next) activeTabId.value = next.standard_id
      } else {
        activeTabId.value = null
      }
    }
  }

  /** 切换页签 */
  function switchTab(standardId: string) {
    activeTabId.value = standardId
    selectedAnchorId.value = null
  }

  // ============================================================
  // 操作
  // ============================================================

  async function fetchStandards() {
    loading.value = true
    error.value = null
    try {
      standards.value = await listStandards()
    } catch (err: any) {
      const msg = err?.message || i18n.global.t('apps.standardMgr.loadListFailed')
      error.value = msg
      useToastStore().error(msg)
    } finally {
      loading.value = false
    }
  }

  /** R8-4: 选择标准 → 打开页签 + 加载数据 */
  async function selectStandard(standardId: string) {
    openTab(standardId)
    await loadTabData(standardId)
  }

  /** 加载页签数据（若未缓存） */
  async function loadTabData(standardId: string) {
    const cache = ensureCache(standardId)

    // 若已缓存详情则跳过（但可手动刷新）
    const fetchTasks: Promise<void>[] = []

    if (!cache.detail) {
      fetchTasks.push(
        getStandard(standardId).then(d => { cache.detail = d }).catch(err => {
          useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.loadDetailFailed'))
        })
      )
    }
    if (cache.sections.length === 0) {
      fetchTasks.push(
        listAnchoredSections(standardId).then(s => { cache.sections = s }).catch(() => {
          cache.sections = []
        })
      )
    }
    if (cache.anchors.length === 0) {
      fetchTasks.push(
        listRefAnchors(standardId, { limit: 500 }).then(a => { cache.anchors = a }).catch(err => {
          useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.loadAnchorsFailed'))
        })
      )
    }

    await Promise.all(fetchTasks)
  }

  async function fetchStandardDetail(standardId: string) {
    try {
      const cache = ensureCache(standardId)
      cache.detail = await getStandard(standardId)
    } catch (err: any) {
      useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.loadDetailFailed'))
    }
  }

  async function fetchAnchoredSections(standardId: string) {
    try {
      const cache = ensureCache(standardId)
      cache.sections = await listAnchoredSections(standardId)
    } catch {
      ensureCache(standardId).sections = []
    }
  }

  async function fetchRefAnchors(standardId: string) {
    try {
      const cache = ensureCache(standardId)
      cache.anchors = await listRefAnchors(standardId, { limit: 500 })
    } catch (err: any) {
      useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.loadAnchorsFailed'))
    }
  }

  async function fetchGaps(standardId: string) {
    try {
      const cache = ensureCache(standardId)
      cache.gaps = await listGaps(standardId)
    } catch (err: any) {
      useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.loadGapsFailed'))
    }
  }

  /** 触发重建/清洗 */
  async function triggerRebuild(standardId: string) {
    rebuildLoading.value = true
    rebuildError.value = null
    try {
      await updateBuildStatus(standardId, 'processing')
      await fetchStandardDetail(standardId)

      const detail = await pollBuildStatus(standardId)
      if (detail.anchor_build_status === 'error') {
        rebuildError.value = detail.last_anchor_build_error || i18n.global.t('apps.standardMgr.cleanFailed')
        useToastStore().error(rebuildError.value!)
      } else {
        useToastStore().success(i18n.global.t('apps.standardMgr.cleanSuccess'))
        // 刷新所有缓存数据
        await loadTabData(standardId)
      }
    } catch (err: any) {
      const msg = err?.message || i18n.global.t('apps.standardMgr.rebuildFailed')
      rebuildError.value = msg
      useToastStore().error(msg)
      await fetchStandardDetail(standardId)
    } finally {
      rebuildLoading.value = false
    }
  }

  async function pollBuildStatus(standardId: string): Promise<StandardItem> {
    const maxAttempts = 120
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const detail = await getStandard(standardId)
      if (detail.anchor_build_status === 'done' || detail.anchor_build_status === 'error') {
        return detail
      }
    }
    throw new Error(i18n.global.t('apps.standardMgr.rebuildTimeout'))
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
      useToastStore().success(i18n.global.t('apps.standardMgr.manualFixSuccess'))
      if (activeTabId.value) {
        await loadTabData(activeTabId.value)
      }
    } catch (err: any) {
      useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.manualFixFailed'))
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
    // R8-4: 页签状态
    openTabs,
    activeTabId,
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
    // R8-4: 页签操作
    openTab,
    closeTab,
    switchTab,
    loadTabData,
  }
})
