<template>
  <div class="cfa-view">
    <div v-if="store.sessionExpired" class="cfa-expired-banner">
      <el-result
        icon="warning"
        title="当前分析会话已失效"
        sub-title="分析结果不保留历史，请重新上传文件开始新一轮分析"
      >
        <template #extra>
          <el-button type="primary" @click="store.reset()">重新开始</el-button>
        </template>
      </el-result>
    </div>

    <template v-else>
      <AnalyzerTopBar
        :batch-status="store.batchStatus"
        :loading="store.loading"
        :rule-sets="store.ruleSets"
        :selected-rule-set-id="store.selectedRuleSetId"
        :is-admin="isAdmin"
        @upload="onUpload"
        @select-rule-set="store.selectRuleSet"
        @run-analysis="store.runAnalysis()"
        @export="store.exportReport()"
        @open-config="showConfigModal = true"
        @open-ruleset-editor="showRuleSetEditor = true"
      />

      <div class="cfa-session-hint" v-if="store.batchStatus === 'idle' || store.batchStatus === 'ready'">
        <el-icon><InfoFilled /></el-icon>
        <span>分析结果不保留历史，请及时导出 Excel。上传文件需包含时间列和电流列。</span>
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
              <p class="cfa-empty-title">电流采样特征分析</p>
              <p class="cfa-empty-sub">基于规则集与 LLM 的电流阶段识别工作台</p>
              <ul class="cfa-empty-steps">
                <li>1. 上传一个或多个 CSV 文件（需含时间列和电流列）</li>
                <li>2. 选择一套分析规则集</li>
                <li>3. 点击「开始分析」启动批量识别</li>
                <li>4. 完成后及时导出 Excel 报告</li>
              </ul>
              <p class="cfa-empty-note">分析结果不保留历史，页面刷新后将失效</p>
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

      <BatchSummaryPanel
        v-if="store.batchStatus === 'completed' || store.batchStatus === 'partial_failed'"
        :summary="store.summary"
        :file-stats="store.fileStats"
        @jump-failed="store.jumpToFirstFailed()"
        @jump-warning="store.jumpToFirstWarning()"
        @export="store.exportReport()"
      />

      <div v-if="store.error" class="cfa-error-banner">
        {{ store.error }}
      </div>

      <AdminConfigModal
        v-if="showConfigModal && isAdmin"
        :config="store.appConfig"
        @close="showConfigModal = false"
        @save="onSaveConfig"
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
import { InfoFilled } from '@element-plus/icons-vue'
import { useCurrentFeatureAnalyzerStore } from '@/stores/currentFeatureAnalyzer'
import { useUserStore } from '@/stores/user'
import AnalyzerTopBar from '@/components/current-feature-analyzer/AnalyzerTopBar.vue'
import FileListPanel from '@/components/current-feature-analyzer/FileListPanel.vue'
import FileDetailPanel from '@/components/current-feature-analyzer/FileDetailPanel.vue'
import BatchSummaryPanel from '@/components/current-feature-analyzer/BatchSummaryPanel.vue'
import AdminConfigModal from '@/components/current-feature-analyzer/AdminConfigModal.vue'
import RuleSetEditorModal from '@/components/current-feature-analyzer/RuleSetEditorModal.vue'

const store = useCurrentFeatureAnalyzerStore()
const userStore = useUserStore()
const showConfigModal = ref(false)
const showRuleSetEditor = ref(false)

const isAdmin = (userStore as any).user?.role === 'admin' || (userStore as any).isAdmin

onMounted(async () => {
  await store.loadRuleSets()
  await store.loadConfig()
})

function onUpload(files: File[]) {
  store.uploadFiles(files, store.selectedRuleSetId || undefined)
}

async function onSaveConfig(config: any) {
  const { currentFeatureAnalyzerApi } = await import('@/api/current-feature-analyzer')
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
