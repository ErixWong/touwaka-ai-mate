<template>
  <div class="standard-mgr-app">
    <!-- 加载状态 -->
    <div v-if="store.loading && store.standards.length === 0" class="sm-loading">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="store.error && store.standards.length === 0" class="sm-error">
      <el-result icon="error" title="加载失败" :sub-title="store.error">
        <template #extra>
          <el-button type="primary" @click="store.fetchStandards()">重试</el-button>
        </template>
      </el-result>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!store.loading && store.standards.length === 0" class="sm-empty">
      <el-empty description="暂无纳管标准">
        <el-button type="primary" @click="showUploadDialog = true">纳管标准</el-button>
      </el-empty>
    </div>

    <!-- R8-3: 页签切换 —— 标准管理 | 标准筛选 -->
    <div v-else class="sm-layout">
      <el-tabs v-model="activePageTab" class="sm-page-tabs">
        <el-tab-pane name="manage">
          <template #label>
            {{ $t('apps.standardMgr.manageTab') }}
          </template>
          <div class="sm-layout-inner">
            <!-- 左栏：标准列表 -->
            <div class="sm-left-panel" :class="{ collapsed: !showLeftPanel }">
              <StandardListPanel
                :standards="store.standards"
                :selected-id="store.selectedStandardId"
                :loading="store.loading"
                :enterprises="store.enterprises"
                @select="handleSelectStandard"
                @upload-click="showUploadDialog = true"
              />
            </div>

            <!-- 中栏 + 右栏 -->
            <div v-if="store.activeStandardId" class="sm-content-area">
              <!-- R9-1: 多详情页签栏（key 用 tab_id） -->
              <div class="sm-detail-tabs">
                <div
                  v-for="tab in store.openTabs"
                  :key="tab.tab_id"
                  class="sm-detail-tab"
                  :class="{ active: tab.tab_id === store.activeTabId }"
                  @click="store.switchTab(tab.tab_id)"
                >
                  <span class="sm-detail-tab-label" :title="tab.standard_name || tab.standard_code">
                    {{ tab.standard_code || tab.standard_name || tab.standard_id.slice(0, 8) }}
                  </span>
                  <el-button
                    text
                    size="small"
                    class="sm-detail-tab-close"
                    @click.stop="handleCloseTab(tab.tab_id)"
                  >
                    <el-icon><Close /></el-icon>
                  </el-button>
                </div>
              </div>

              <!-- 中栏+右栏（水平） -->
              <div class="sm-content-row">
                <!-- 中栏：正文预览 -->
                <div class="sm-middle-panel">
                  <StandardDetailView
                    :standard="store.standardDetail"
                    :sections="store.anchoredSections"
                    :anchors="store.refAnchors"
                    :anchor-status-map="store.anchorStatusMap"
                    :selected-anchor-id="store.selectedAnchorId"
                    :rebuild-loading="store.rebuildLoading"
                    :rebuild-error="store.rebuildError"
                    :enterprises="store.enterprises"
                    @anchor-click="handleAnchorClick"
                    @rebuild="handleRebuild"
                    @select-anchor="handleSelectAnchor"
                    @edit-metadata="handleEditMetadata"
                  />
                </div>

                <!-- 右栏：锚点面板 -->
                <div class="sm-right-panel" :class="{ collapsed: !showRightPanel }">
                  <AnchorPanel
                    :anchors="store.refAnchors"
                    :selected-anchor-id="store.selectedAnchorId"
                    :standard-id="store.activeStandardId"
                    :sections="store.anchoredSections"
                    @anchor-click="handleSelectAnchor"
                    @jump-to-anchor="handleJumpToAnchor"
                    @fix-anchor="handleOpenFixDialog"
                  />
                </div>
              </div>
            </div>

            <!-- 未选择标准时的引导 -->
            <div v-else class="sm-content-area sm-content-empty">
              <el-empty :description="$t('apps.standardMgr.noDetailOpen')" />
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="filter">
          <template #label>
            {{ $t('apps.standardMgr.filterTab') }}
          </template>
          <FilterPanel />
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 面板折叠按钮 -->
    <div class="sm-toggle-buttons">
      <el-button
        v-if="store.standards.length > 0"
        circle
        size="small"
        @click="showLeftPanel = !showLeftPanel"
      >
        {{ showLeftPanel ? '◀' : '▶' }}
      </el-button>
      <el-button
        v-if="store.activeStandardId"
        circle
        size="small"
        @click="showRightPanel = !showRightPanel"
      >
        {{ showRightPanel ? '▶' : '◀' }}
      </el-button>
    </div>

    <!-- 上传/纳管对话框 -->
    <UploadDialog
      v-if="showUploadDialog"
      :onboarded-doc-ids="onboardedDocIds"
      @close="showUploadDialog = false"
      @onboarded="handleOnboarded"
    />

    <!-- 人工修正对话框 -->
    <ManualFixDialog
      v-if="fixDialogTarget"
      :anchor="fixDialogTarget"
      :standard-id="store.selectedStandardId || ''"
      @close="fixDialogTarget = null"
      @fixed="handleFixComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useStandardMgrStore } from '../stores/standardMgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'
import StandardListPanel from '../components/StandardListPanel.vue'
import StandardDetailView from '../components/StandardDetailView.vue'
import AnchorPanel from '../components/AnchorPanel.vue'
import UploadDialog from '../components/UploadDialog.vue'
import ManualFixDialog from '../components/ManualFixDialog.vue'
import FilterPanel from '../components/FilterPanel.vue'
import type { RefAnchor } from '../api/standard-mgr'

const store = useStandardMgrStore()

/** R8-3: 页签切换 */
const activePageTab = ref('manage')

const showLeftPanel = ref(true)
const showRightPanel = ref(true)
const showUploadDialog = ref(false)
const fixDialogTarget = ref<RefAnchor | null>(null)

/** R8-1: 已纳管文档 ID 集合，传给 UploadDialog 标记可纳管/不可纳管 */
const onboardedDocIds = computed(() => new Set(store.standards.map(s => s.document_id).filter(Boolean)))

onMounted(() => {
  store.fetchStandards()
  store.fetchEnterprises()
})

function handleSelectStandard(standardId: string) {
  store.selectStandard(standardId)
}

function handleAnchorClick(anchorId: string) {
  store.selectedAnchorId = anchorId
}

function handleSelectAnchor(anchorId: string) {
  store.selectedAnchorId = anchorId
  // 定位到锚点标记的具体位置（📌），而非整个章节
  const markerEl = document.querySelector(`[data-anchor-id="${anchorId}"]`)
  if (markerEl) {
    markerEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    markerEl.classList.add('anchor-highlight')
    setTimeout(() => markerEl.classList.remove('anchor-highlight'), 2000)
    return
  }
  // 无标记（gap/未落版）→ 降级滚动到所在章节
  const anchor = store.refAnchors.find(a => a.id === anchorId)
  if (anchor?.source_outline_id) {
    const sectionEl = document.querySelector(`[data-outline-id="${anchor.source_outline_id}"]`)
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}

function handleRebuild() {
  const stdId = store.activeStandardId
  if (stdId) {
    store.triggerRebuild(stdId)
  }
}

function handleOnboarded() {
  showUploadDialog.value = false
  store.fetchStandards()
}

/** R9-1: 关闭页签（按 tab_id） */
function handleCloseTab(tabId: string) {
  store.closeTab(tabId)
}

/** R9-1: 跳转——始终打开目标文档新页签（即使是同一文档也用 allowDuplicate） */
async function handleJumpToAnchor(anchor: RefAnchor) {
  if (anchor.status === 'gap') return

  const targetDocId = anchor.target_document_id

  // 确定目标 standard_id
  let targetStandardId: string | null = null
  if (targetDocId) {
    // 跨文档：查找目标文档对应的标准
    const ts = store.standards.find(s => s.document_id === targetDocId)
    if (!ts) {
      useToastStore().warning(i18n.global.t('apps.standardMgr.targetNotOnboarded'))
      return
    }
    targetStandardId = ts.id
  } else {
    // 无 target_document_id → 同文档跳转，用当前 standard
    targetStandardId = store.activeStandardId
    if (!targetStandardId) return
  }

  // 始终 allowDuplicate，打开新页签
  const tabId = store.openTab(targetStandardId, { allowDuplicate: true })
  await store.loadTabData(targetStandardId)
  store.switchTab(tabId)

  // 滚动到目标章节
  const outlineId = targetDocId ? anchor.target_outline_id : anchor.source_outline_id
  if (outlineId) {
    await nextTick()
    await new Promise(r => requestAnimationFrame(r))
    const el = document.querySelector(`[data-outline-id="${outlineId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('anchor-highlight')
      setTimeout(() => el.classList.remove('anchor-highlight'), 2000)
    }
  }
}

function handleOpenFixDialog(anchor: RefAnchor) {
  fixDialogTarget.value = anchor
}

function handleFixComplete() {
  fixDialogTarget.value = null
}

/** R11-5: 元数据编辑 — 调用 store 更新后刷新详情 */
async function handleEditMetadata(
  standardId: string,
  data: { standard_type?: string; standard_code?: string; standard_name?: string; enterprise_id?: string | null },
) {
  await store.updateStandardMeta(standardId, data)
}
</script>

<style scoped>
.standard-mgr-app {
  height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 400px;
}

.sm-loading,
.sm-error,
.sm-empty {
  padding: 40px;
}

.sm-layout {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

/* R8-3: 页签容器 */
.sm-page-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sm-page-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
}
.sm-page-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.sm-layout-inner {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

.sm-left-panel {
  width: 320px;
  min-width: 240px;
  border-right: 1px solid #ebeef5;
  overflow-y: auto;
  background: #fafafa;
  transition: width 0.3s;
}

.sm-left-panel.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
}

.sm-content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* R8-4: 详情页签栏 */
.sm-detail-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  background: #f0f2f5;
  border-bottom: 1px solid #e4e7ed;
  overflow-x: auto;
  flex-shrink: 0;
}
.sm-detail-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px 6px 0 0;
  background: #e4e7ed;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  max-width: 200px;
  transition: background .15s;
}
.sm-detail-tab:hover { background: #dcdfe6; }
.sm-detail-tab.active { background: #fff; font-weight: 500; }
.sm-detail-tab-label { overflow: hidden; text-overflow: ellipsis; }
.sm-detail-tab-close { opacity: 0.5; }
.sm-detail-tab-close:hover { opacity: 1; color: #f56c6c; }

/* 中栏+右栏水平布局 */
.sm-content-row {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sm-content-empty {
  justify-content: center;
  align-items: center;
}

.sm-middle-panel {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.sm-right-panel {
  width: 360px;
  min-width: 280px;
  border-left: 1px solid #ebeef5;
  overflow-y: auto;
  background: #fafafa;
  transition: width 0.3s;
}

.sm-right-panel.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
}

.sm-toggle-buttons {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

/* 锚点样式（全局，因为正文渲染在内层） */
:deep(.ref-anchor) {
  display: inline;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
  transition: background-color 0.2s;
  font-size: 0.85em;
}

:deep(.ref-anchor.anchor-valid) {
  color: #67c23a;
}

:deep(.ref-anchor.anchor-gap) {
  color: #f56c6c;
}

:deep(.ref-anchor.anchor-suspected) {
  color: #e6a23c;
}

:deep(.ref-anchor.anchor-invalid) {
  color: #909399;
  text-decoration: line-through;
}

:deep(.ref-anchor:hover) {
  background-color: #ecf5ff;
}

:deep(.ref-anchor.anchor-highlight) {
  background-color: #fdf6ec;
  outline: 2px solid #e6a23c;
}
</style>
