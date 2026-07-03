<template>
  <div class="cfa-view">
    <div v-if="store.sessionExpired" class="cfa-expired-banner">
      <el-result
        icon="warning"
        title="当前分析会话已失效"
        sub-title="分析结果不保留历史，请重新上传文件开始新一轮分析"
      >
        <template #extra>
          <el-tooltip content="重新开始" placement="top">
            <el-button type="primary" :icon="RefreshRight" @click="store.reset()" />
          </el-tooltip>
        </template>
      </el-result>
    </div>

    <template v-else>
      <AnalyzerTopBar
        :batch-status="store.batchStatus"
        :loading="store.loading"
        :is-admin="isAdmin"
        @open-launch="showLaunchModal = true"
        @run-analysis="store.runAnalysis()"
        @export="store.exportReport()"
        @open-config="showConfigModal = true"
        @open-ruleset-editor="showRuleSetEditor = true"
      />

      <div v-if="store.batchStatus === 'idle' || store.batchStatus === 'ready'" class="cfa-session-hint">
        <el-icon><InfoFilled /></el-icon>
        <span>分析结果不保留历史，请及时导出报告。上传文件需包含时间列和电流列。</span>
      </div>

      <div class="cfa-workspace">
        <FileListPanel
          :files="store.files"
          :selected-file-id="store.selectedFileId"
          :batch-status="store.batchStatus"
          @select="store.selectFile"
        />

        <div class="cfa-detail-area">
          <div v-if="!store.currentFile" class="cfa-empty-detail">
            <div class="cfa-empty-guide">
              <p class="cfa-empty-title">电流特征分析</p>
              <p class="cfa-empty-sub">批量上传 CSV，AI 自动识别电流阶段</p>
              <ul class="cfa-empty-steps">
                <li>1. 点击「上传 CSV」上传一个或多个文件</li>
                <li>2. 选择分析规则集</li>
                <li>3. 点击「启动分析」开始识别</li>
                <li>4. 分析完成后点击「导出报告」</li>
              </ul>
              <p class="cfa-empty-note">页面刷新后分析结果将失效，请及时导出</p>
            </div>
          </div>
          <FileDetailPanel
            v-else
            :file="store.currentFile"
            :app-config="store.appConfig"
            :rule-set-detail="store.selectedRuleSetDetail"
          />
        </div>
      </div>

      <div v-if="store.error" class="cfa-error-banner">
        <el-alert
          :title="store.error"
          type="error"
          :closable="true"
          show-icon
          @close="store.error = null"
        />
      </div>

      <AdminConfigModal
        v-if="showConfigModal && isAdmin"
        :config="store.appConfig"
        @close="showConfigModal = false"
        @save="onSaveConfig"
      />

      <TaskLaunchModal
        v-if="showLaunchModal"
        :current-batch-status="store.batchStatus"
        :default-rule-set-id="store.selectedRuleSetId"
        :rule-sets="store.ruleSets"
        @close="showLaunchModal = false"
        @submit="onLaunchTask"
      />

      <RuleSetEditorModal
        v-if="showRuleSetEditor && isAdmin"
        :rule-sets="store.ruleSets"
        @close="showRuleSetEditor = false"
        @reload="store.loadRuleSets()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { InfoFilled, RefreshRight } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import type { AppConfig } from '../api/current-feature-analyzer'
import { currentFeatureAnalyzerApi } from '../api/current-feature-analyzer'
import { useCurrentFeatureAnalyzerStore } from '../stores/currentFeatureAnalyzer'
import AnalyzerTopBar from '../components/AnalyzerTopBar.vue'
import FileListPanel from '../components/FileListPanel.vue'
import FileDetailPanel from '../components/FileDetailPanel.vue'
import AdminConfigModal from '../components/AdminConfigModal.vue'
import RuleSetEditorModal from '../components/RuleSetEditorModal.vue'
import TaskLaunchModal from '../components/TaskLaunchModal.vue'

const store = useCurrentFeatureAnalyzerStore()
const userStore = useUserStore()
const showConfigModal = ref(false)
const showRuleSetEditor = ref(false)
const showLaunchModal = ref(false)

const isAdmin = userStore.isAdmin

onMounted(async () => {
  await store.loadRuleSets()
  await store.loadConfig()
})

onBeforeUnmount(() => {
  store.stopPolling()
})

async function onLaunchTask(payload: { files: File[]; ruleSetId: string; overwriteCurrentSession: boolean }) {
  await store.selectRuleSet(payload.ruleSetId)
  await store.launchAnalysisTask(payload.files, payload.ruleSetId, payload.overwriteCurrentSession)
  showLaunchModal.value = false
}

async function onSaveConfig(config: AppConfig) {
  await currentFeatureAnalyzerApi.saveConfig(config)
  await store.loadConfig()
  showConfigModal.value = false
}
</script>

<style scoped>
.cfa-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}
.cfa-expired-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.cfa-session-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: var(--el-color-info-light-9);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.cfa-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.cfa-detail-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.cfa-empty-detail {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.cfa-empty-guide {
  text-align: center;
  color: var(--el-text-color-secondary);
  max-width: 480px;
}
.cfa-empty-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}
.cfa-empty-sub {
  font-size: 14px;
  margin-bottom: 20px;
}
.cfa-empty-steps {
  text-align: left;
  list-style: none;
  padding: 0;
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 2;
}
.cfa-empty-note {
  font-size: 12px;
  color: var(--el-color-warning);
}
.cfa-error-banner {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--el-color-danger-light-9, #fef0f0);
  color: var(--el-color-danger);
  padding: 8px 20px;
  border-radius: 4px;
  z-index: 2000;
}
</style>
