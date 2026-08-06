/**
 * standard-mgr Pinia Store
 *
 * 状态管理规则（审计要求）：
 * - 不新增任何前端侧状态机
 * - 计数字段以服务端为唯一真相，禁止前端重算
 * - anchor_build_status 直接展示服务端字段
 *
 * R9-1: 页签用唯一 tab_id 标识（允许同标准多页签）
 * - openTabs 的 key 从 standard_id 改为 tab_id
 * - openTab(standardId, {allowDuplicate}) 支持强制新建
 * - 数据缓存仍按 standard_id 共享（tabCaches 不动）
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
  updateStandard,
  listEnterprises,
  type StandardItem,
  type StandardType,
  type RefAnchor,
  type GapItem,
  type AnchoredSection,
  type EnterpriseItem,
} from '../api/standard-mgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'

// ============================================================
// R9-1: 页签/缓存类型
// ============================================================

interface StandardTabDescriptor {
  tab_id: string
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

let _tabSeq = 0
function generateTabId(): string {
  return `tab_${Date.now()}_${++_tabSeq}`
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

  // R9-1: 多页签管理 — 以 tab_id 为身份
  const openTabs = ref<StandardTabDescriptor[]>([])
  const activeTabId = ref<string | null>(null) // tab_id
  const tabCaches = ref<Record<string, TabCache>>({}) // keyed by standard_id

  // UI 状态
  const selectedAnchorId = ref<string | null>(null)
  const rebuildLoading = ref(false)
  const rebuildError = ref<string | null>(null)

  // R11: 企业花名册
  const enterprises = ref<EnterpriseItem[]>([])
  const enterprisesLoading = ref(false)

  // ============================================================
  // R9-1: activeTabId → standard_id 映射
  // ============================================================

  /** 当前激活页签对应的 standard_id */
  const activeStandardId = computed(() => {
    const tab = openTabs.value.find(t => t.tab_id === activeTabId.value)
    return tab?.standard_id ?? null
  })

  /** @deprecated R9-1: 用 activeStandardId 代替，保留兼容 */
  const selectedStandardId = computed(() => activeStandardId.value)

  const selectedStandard = computed(() => {
    return standards.value.find(s => s.id === activeStandardId.value) || null
  })

  /** 当前激活页签的详情 */
  const standardDetail = computed(() => {
    const id = activeStandardId.value
    return id ? (tabCaches.value[id]?.detail ?? null) : null
  })

  /** 当前激活页签的副本 */
  const anchoredSections = computed(() => {
    const id = activeStandardId.value
    return id ? (tabCaches.value[id]?.sections ?? []) : []
  })

  /** 当前激活页签的锚点 */
  const refAnchors = computed(() => {
    const id = activeStandardId.value
    return id ? (tabCaches.value[id]?.anchors ?? []) : []
  })

  /** 当前激活页签的 gaps */
  const gaps = computed(() => {
    const id = activeStandardId.value
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
  // R9-1: 页签操作
  // ============================================================

  /** 确保缓存槽存在 */
  function ensureCache(standardId: string): TabCache {
    if (!tabCaches.value[standardId]) {
      tabCaches.value[standardId] = { detail: null, sections: [], anchors: [], gaps: [] }
    }
    return tabCaches.value[standardId]
  }

  /** R9-1: 打开/切换到标准。allowDuplicate=true 时总是新建页签 */
  function openTab(standardId: string, opts?: { allowDuplicate?: boolean }): string {
    const existing = !opts?.allowDuplicate
      ? openTabs.value.find(t => t.standard_id === standardId)
      : undefined

    if (existing) {
      activeTabId.value = existing.tab_id
      selectedAnchorId.value = null
      return existing.tab_id
    }

    const std = standards.value.find(s => s.id === standardId)
    if (!std) return ''

    const tab_id = generateTabId()
    openTabs.value.push({
      tab_id,
      standard_id: standardId,
      standard_code: std.standard_code || '',
      standard_name: std.standard_name || '',
    })

    activeTabId.value = tab_id
    selectedAnchorId.value = null
    return tab_id
  }

  /** 关闭页签（按 tab_id） */
  function closeTab(tabId: string) {
    const idx = openTabs.value.findIndex(t => t.tab_id === tabId)
    if (idx === -1) return

    const removed = openTabs.value.splice(idx, 1)[0]
    if (!removed) return

    // 清理缓存（仅当没有其他页签引用此 standard_id 时）
    const stillOpen = openTabs.value.some(t => t.standard_id === removed.standard_id)
    if (!stillOpen) {
      delete tabCaches.value[removed.standard_id]
    }

    // 激活相邻页签
    if (activeTabId.value === tabId) {
      if (openTabs.value.length > 0) {
        const next = openTabs.value[Math.min(idx, openTabs.value.length - 1)]
        if (next) activeTabId.value = next.tab_id
      } else {
        activeTabId.value = null
      }
    }
  }

  /** 切换页签（按 tab_id） */
  function switchTab(tabId: string) {
    activeTabId.value = tabId
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

  /** R11: 加载企业花名册 */
  async function fetchEnterprises() {
    enterprisesLoading.value = true
    try {
      enterprises.value = await listEnterprises()
    } catch (err: any) {
      useToastStore().error(err?.message || '加载企业列表失败')
    } finally {
      enterprisesLoading.value = false
    }
  }

  /** R11-5: 更新标准元数据（含 enterprise_id） */
  async function updateStandardMeta(
    standardId: string,
    data: { standard_type?: string; standard_code?: string; standard_name?: string; enterprise_id?: string | null },
  ) {
    try {
      const updated = await updateStandard(standardId, {
        ...data,
        standard_type: data.standard_type as StandardType | undefined,
      })
      // 刷新列表 & 缓存
      const listIdx = standards.value.findIndex(s => s.id === standardId)
      if (listIdx !== -1) {
        standards.value[listIdx] = updated
      }
      const cache = tabCaches.value[standardId]
      if (cache) {
        cache.detail = updated
      }
      useToastStore().success(i18n.global.t('common.saved'))
    } catch (err: any) {
      useToastStore().error(err?.message || i18n.global.t('common.saveFailed'))
    }
  }

  /** R9-1: 选择标准 → 始终开新页签 + 加载数据 */
  async function selectStandard(standardId: string) {
    openTab(standardId, { allowDuplicate: true })
    await loadTabData(standardId)
  }

  /** 加载页签数据（若未缓存） */
  async function loadTabData(standardId: string) {
    const cache = ensureCache(standardId)

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
      const stdId = activeStandardId.value || data.standard_id
      if (stdId) {
        await loadTabData(stdId)
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
    // R11: 企业花名册
    enterprises,
    enterprisesLoading,
    // 计算
    selectedStandard,
    activeStandardId,
    anchorStatusMap,
    anchorsByOutline,
    // 操作
    fetchStandards,
    fetchEnterprises,
    updateStandardMeta,
    selectStandard,
    fetchGaps,
    triggerRebuild,
    submitManualFix,
    // R9-1: 页签操作
    openTab,
    closeTab,
    switchTab,
    loadTabData,
  }
})
