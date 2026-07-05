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
        <div class="cfa-session-hint-title">
          <el-icon><InfoFilled /></el-icon>
          <span>重要提醒：分析结果仅保留在本次会话</span>
        </div>
        <p class="cfa-session-hint-desc">请在完成分析后立即导出报告，避免刷新页面后结果失效。</p>
        <p class="cfa-session-hint-desc">上传文件必须同时包含“时间列”和“电流列”。</p>
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
               <p class="cfa-empty-sub">批量上传 CSV，前端完成压缩，后端同步识别阶段并生成指标</p>
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
import { ref, onMounted } from 'vue'
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

async function onLaunchTask(payload: { files: File[]; ruleSetId: string; overwriteCurrentSession: boolean }) {
  showLaunchModal.value = false
  await store.selectRuleSet(payload.ruleSetId)
  await store.launchAnalysisTask(payload.files, payload.ruleSetId, payload.overwriteCurrentSession)
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
  margin: 10px 16px 0;
  padding: 10px 14px;
  background: linear-gradient(90deg, #fff8eb 0%, #fff3db 100%);
  border: 1px solid #f5d6a7;
  border-left: 4px solid var(--el-color-warning);
  border-radius: 8px;
}
.cfa-session-hint-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
  color: #9a5d00;
}
.cfa-session-hint-desc {
  margin: 6px 0 0 24px;
  font-size: 13px;
  line-height: 1.5;
  color: #8a5a14;
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
