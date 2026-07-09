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
        @export="store.exportReport()"
        @open-config="showConfigModal = true"
        @open-ruleset-editor="showRuleSetEditor = true"
      />

      <div v-if="['idle', 'ready', 'preparing_analysis'].includes(store.batchStatus)" class="cfa-session-hint">
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
          <transition name="cfa-analysis-stage-fade">
            <div v-if="store.analysisTransitionVisible" class="cfa-analysis-transition">
              <div class="cfa-analysis-transition-orb" />
              <div class="cfa-analysis-transition-grid" />
              <div class="cfa-analysis-transition-content">
                <span class="cfa-analysis-transition-kicker">当前特征分析</span>
                <p class="cfa-analysis-transition-title">{{ transitionTitle }}</p>
                <p class="cfa-analysis-transition-desc">{{ transitionDescription }}</p>
              </div>
            </div>
          </transition>

          <div v-if="!store.currentFile" class="cfa-empty-detail">
            <div class="cfa-empty-guide">
              <p class="cfa-empty-title">电流特征分析</p>
              <p class="cfa-empty-sub">批量上传 CSV，前端完成压缩，后端同步识别阶段并生成指标</p>
              <ul class="cfa-empty-steps">
                <li>1. 点击「上传 CSV」上传一个或多个文件</li>
                <li>2. 选择分析规则集</li>
                <li>3. 提交任务后自动开始识别</li>
                <li>4. 分析完成后点击「导出报告」</li>
              </ul>
              <div class="cfa-file-format-example">
                <p class="cfa-format-title">支持的文件格式：CSV（支持多种列名）</p>
                <div class="cfa-format-preview">
                  <pre>time,current
0.0,1.23
0.1,1.25
0.2,1.28
0.3,1.30
...</pre>
                </div>
                <ul class="cfa-format-rules">
                  <li>时间列：time(s)、time、timestamp、second、sec、s、t、时间、秒（任选其一）</li>
                  <li>电流列：current(A)、current、ampere、amp、a、i、电流、安培（任选其一）</li>
                  <li>自动识别前两列，如列名不匹配则按位置识别</li>
                </ul>
              </div>
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
import { computed, nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, RefreshRight } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import type { AppConfig, CompressionAlgorithmKey } from '../api/current-feature-analyzer'
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

const transitionTitle = computed(() => {
  if (store.analysisTransitionStage === 'syncing') {
    return '文件已上传，正在同步分析工作区'
  }
  if (store.analysisTransitionStage === 'compressing') {
    return '工作区就绪，正在执行前端压缩分析'
  }
  return '压缩结果已生成，正在提交 AI 阶段识别'
})

const transitionDescription = computed(() => {
  if (store.analysisTransitionStage === 'syncing') {
    return '先完成列表、图表和详情面板渲染，再进入分析流程，避免上传后界面瞬时卡住。'
  }
  if (store.analysisTransitionStage === 'compressing') {
    return '本地压缩会占用主线程，当前先展示过渡态并锁定视觉焦点。'
  }
  return '识别完成后会自动刷新阶段指标、LLM 结果和导出状态。'
})

async function onLaunchTask(payload: { files: File[]; ruleSetId: string; overwriteCurrentSession: boolean; compressionAlgorithm: CompressionAlgorithmKey }) {
  showLaunchModal.value = false
  void nextTick(() => {
    void (async () => {
      await store.selectRuleSet(payload.ruleSetId)
      await store.launchAnalysisTask(payload.files, payload.ruleSetId, payload.compressionAlgorithm, payload.overwriteCurrentSession)
    })()
  })
}

async function onSaveConfig(config: AppConfig) {
  try {
    await currentFeatureAnalyzerApi.saveConfig(config)
    await store.loadConfig()
    showConfigModal.value = false
    ElMessage.success('管理员配置已保存')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '保存管理员配置失败'
    ElMessage.error(message)
  }
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
  position: relative;
}
.cfa-analysis-transition {
  position: absolute;
  inset: 16px;
  z-index: 20;
  overflow: hidden;
  border: 1px solid rgba(78, 110, 255, 0.14);
  border-radius: 24px;
  background:
    radial-gradient(circle at 18% 18%, rgba(73, 120, 255, 0.24), transparent 34%),
    radial-gradient(circle at 82% 22%, rgba(0, 212, 170, 0.2), transparent 30%),
    linear-gradient(135deg, rgba(8, 17, 40, 0.94), rgba(19, 44, 94, 0.92));
  box-shadow: 0 24px 70px rgba(11, 23, 52, 0.22);
  backdrop-filter: blur(8px);
}
.cfa-analysis-transition-orb {
  position: absolute;
  width: 280px;
  height: 280px;
  right: -60px;
  bottom: -100px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(91, 214, 255, 0.46), rgba(91, 214, 255, 0));
  animation: cfa-orb-pulse 3.6s ease-in-out infinite;
}
.cfa-analysis-transition-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.2));
}
.cfa-analysis-transition-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  padding: 36px;
  color: #eef4ff;
}
.cfa-analysis-transition-kicker {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-bottom: 14px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cfa-analysis-transition-title {
  margin: 0;
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 700;
  line-height: 1.2;
}
.cfa-analysis-transition-desc {
  max-width: 560px;
  margin: 14px 0 0;
  font-size: 14px;
  line-height: 1.75;
  color: rgba(238, 244, 255, 0.82);
}
.cfa-analysis-stage-fade-enter-active,
.cfa-analysis-stage-fade-leave-active {
  transition: opacity 0.28s ease, transform 0.32s ease;
}
.cfa-analysis-stage-fade-enter-from,
.cfa-analysis-stage-fade-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
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
.cfa-file-format-example {
  margin: 16px 0;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  text-align: left;
}
.cfa-format-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--el-text-color-primary);
}
.cfa-format-preview {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 10px;
  overflow-x: auto;
}
.cfa-format-preview pre {
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
}
.cfa-format-rules {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
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
@media (max-width: 768px) {
  .cfa-analysis-transition {
    inset: 12px;
    border-radius: 18px;
  }
  .cfa-analysis-transition-content {
    padding: 24px;
  }
  .cfa-analysis-transition-title {
    font-size: 22px;
  }
}
@keyframes cfa-orb-pulse {
  0%, 100% {
    transform: scale(0.92);
    opacity: 0.72;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
</style>
