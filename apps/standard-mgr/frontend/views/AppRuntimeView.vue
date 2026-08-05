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

    <!-- 三栏布局 -->
    <div v-else class="sm-layout">
      <!-- 左栏：标准列表 -->
      <div class="sm-left-panel" :class="{ collapsed: !showLeftPanel }">
        <StandardListPanel
          :standards="store.standards"
          :selected-id="store.selectedStandardId"
          :loading="store.loading"
          @select="handleSelectStandard"
          @upload-click="showUploadDialog = true"
        />
      </div>

      <!-- 中栏 + 右栏 -->
      <div v-if="store.selectedStandardId" class="sm-content-area">
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
            @anchor-click="handleAnchorClick"
            @rebuild="handleRebuild"
            @select-anchor="handleSelectAnchor"
          />
        </div>

        <!-- 右栏：锚点面板 -->
        <div class="sm-right-panel" :class="{ collapsed: !showRightPanel }">
          <AnchorPanel
            :anchors="store.refAnchors"
            :anchors-by-outline="store.anchorsByOutline"
            :selected-anchor-id="store.selectedAnchorId"
            :standard-id="store.selectedStandardId"
            :sections="store.anchoredSections"
            @anchor-click="handleSelectAnchor"
            @fix-anchor="handleOpenFixDialog"
          />
        </div>
      </div>

      <!-- 未选择标准时的引导 -->
      <div v-else class="sm-content-area sm-content-empty">
        <el-empty description="请从左侧列表选择标准查看详情" />
      </div>
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
        v-if="store.selectedStandardId"
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
import { ref, onMounted } from 'vue'
import { useStandardMgrStore } from '../stores/standardMgr'
import StandardListPanel from '../components/StandardListPanel.vue'
import StandardDetailView from '../components/StandardDetailView.vue'
import AnchorPanel from '../components/AnchorPanel.vue'
import UploadDialog from '../components/UploadDialog.vue'
import ManualFixDialog from '../components/ManualFixDialog.vue'
import type { RefAnchor } from '../api/standard-mgr'

const store = useStandardMgrStore()

const showLeftPanel = ref(true)
const showRightPanel = ref(true)
const showUploadDialog = ref(false)
const fixDialogTarget = ref<RefAnchor | null>(null)

onMounted(() => {
  store.fetchStandards()
})

function handleSelectStandard(standardId: string) {
  store.selectStandard(standardId)
}

function handleAnchorClick(anchorId: string) {
  store.selectedAnchorId = anchorId
}

function handleSelectAnchor(anchorId: string) {
  store.selectedAnchorId = anchorId
  // 触发正文滚动（通过 data-anchor-id 查找）
  const el = document.querySelector(`[data-anchor-id="${anchorId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('anchor-highlight')
    setTimeout(() => el.classList.remove('anchor-highlight'), 2000)
  }
}

function handleRebuild() {
  if (store.selectedStandardId) {
    store.triggerRebuild(store.selectedStandardId)
  }
}

function handleOnboarded() {
  showUploadDialog.value = false
  store.fetchStandards()
}

function handleOpenFixDialog(anchor: RefAnchor) {
  fixDialogTarget.value = anchor
}

function handleFixComplete() {
  fixDialogTarget.value = null
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
