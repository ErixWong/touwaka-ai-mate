<template>
  <el-dialog
    :model-value="true"
    title="新建分析任务"
    width="680px"
    class="task-launch-dialog"
    @close="$emit('close')"
  >
    <div class="task-launch-layout">
      <el-alert
        v-if="hasActiveSession"
        title="当前已有进行中的分析会话"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #default>
          <div class="task-launch-alert-body">
            开始新任务前，需要明确是否覆盖当前会话结果。
          </div>
        </template>
      </el-alert>

      <el-form label-width="110px">
        <el-form-item label="分析规则集" required>
          <el-select
            v-model="localRuleSetId"
            placeholder="请选择一套规则集"
            style="width: 100%"
          >
            <el-option
              v-for="ruleSet in enabledRuleSets"
              :key="ruleSet.id"
              :label="ruleSet.rule_set_name"
              :value="ruleSet.id"
            >
              <div class="task-launch-option">
                <span class="task-launch-option-name">{{ ruleSet.rule_set_name }}</span>
                <span v-if="ruleSet.description" class="task-launch-option-desc">{{ ruleSet.description }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="上传文件" required>
          <div class="task-launch-file-block">
            <div class="task-launch-file-actions">
              <el-tooltip content="选择 CSV 文件" placement="top">
                <el-button type="primary" plain :icon="FolderOpened" @click="triggerFileSelect" />
              </el-tooltip>
              <span class="task-launch-file-hint">支持一次选择多个 `.csv` 文件</span>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              accept=".csv"
              style="display: none"
              @change="onFileChange"
            >

            <div v-if="selectedFiles.length > 0" class="task-launch-file-list">
              <div class="task-launch-file-list-header">
                已选择 {{ selectedFiles.length }} 个文件
              </div>
              <div
                v-for="(file, index) in selectedFiles"
                :key="`${file.name}-${index}`"
                class="task-launch-file-item"
              >
                <div class="task-launch-file-meta">
                  <span class="task-launch-file-name">{{ file.name }}</span>
                  <span class="task-launch-file-size">{{ formatFileSize(file.size) }}</span>
                </div>
                <el-tooltip content="移除文件" placement="top">
                  <el-button text type="danger" :icon="Delete" @click="removeFile(index)" />
                </el-tooltip>
              </div>
            </div>
            <div v-else class="task-launch-empty">
              请选择至少一个 CSV 文件
            </div>
          </div>
        </el-form-item>

        <el-form-item label="压缩算法" required>
          <el-select
            v-model="localCompressionAlgorithm"
            placeholder="请选择压缩算法"
            style="width: 100%"
          >
            <el-option
              v-for="algorithm in compressionAlgorithms"
              :key="algorithm.value"
              :label="algorithm.label"
              :value="algorithm.value"
            >
              <div class="task-launch-option">
                <span class="task-launch-option-name">{{ algorithm.label }}</span>
                <span class="task-launch-option-desc">{{ algorithm.description }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item v-if="hasActiveSession" label="会话处理" required>
          <el-radio-group v-model="overwriteCurrentSession">
            <el-radio :value="false">继续当前会话，不覆盖现有结果</el-radio>
            <el-radio :value="true">覆盖当前会话并重新开始</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <div class="task-launch-summary">
        <div class="task-launch-summary-line">
          <span class="label">任务确认</span>
          <span class="value">文件数 {{ selectedFiles.length }}</span>
          <span class="value">算法 {{ compressionAlgorithmLabel }}</span>
          <span v-if="hasActiveSession" class="value">{{ overwriteCurrentSession ? '覆盖当前会话' : '保留当前会话' }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-tooltip content="开始分析" placement="top">
        <el-button type="primary" :icon="Promotion" :disabled="!canSubmit" @click="submitTask" />
      </el-tooltip>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Delete, FolderOpened, Promotion } from '@element-plus/icons-vue'
import type { CompressionAlgorithmKey, RuleSetItem } from '../api/current-feature-analyzer'

const props = defineProps<{
  currentBatchStatus: string
  defaultRuleSetId: string | null
  ruleSets: RuleSetItem[]
}>()

const emit = defineEmits<{
  close: []
  submit: [{ files: File[]; ruleSetId: string; overwriteCurrentSession: boolean; compressionAlgorithm: CompressionAlgorithmKey }]
}>()

const compressionAlgorithms: Array<{ value: CompressionAlgorithmKey; label: string; description: string }> = [
  {
    value: 'adaptive_v2',
    label: '自适应 V2（默认）',
    description: '当前项目实现，自适应搜索分辨率，段数更稳定。',
  },
  {
    value: 'legacy_v4',
    label: '原始 V4',
    description: '沿用 output_analysis_tool_fixed_v4.html 的原始压缩逻辑，便于对比。',
  },
  {
    value: 'adaptive_keypoints_v1',
    label: '关键点阈值 V1',
    description: '按相邻窗口变化幅度自适应筛选约 40-60 个关键点，适合交给 LLM 做阶段推断。',
  },
  {
    value: 'envelope_turning_points_v2',
    label: '包络转折点 V2',
    description: '在关键点阈值基础上额外保留均值/峰值转折，并增强堵转顶部短平台保真。',
  },
  {
    value: 'envelope_turning_points_v3',
    label: '包络转折点 V3',
    description: '在 V2 基础上把平台起止边界设为结构锚点，减少平台尾端和下降沿被压成尖峰。',
  },
  {
    value: 'structural_profile_v1',
    label: '结构轮廓压缩 V1',
    description: '先识别平台/斜坡/脉冲/陡边等结构单元，再按单元模板生成关键点，减少补丁式例外规则。',
  },
  {
    value: 'structural_profile_v2',
    label: '结构轮廓压缩 V2',
    description: '边界事件优先：先剥离强跳变，再对剩余区域做平台/斜坡采样，优先保近 90 度陡边。',
  },
  {
    value: 'structural_cusum_v1',
    label: '结构轮廓 CUSUM V1',
    description: '先用局部 CUSUM 检测候选跳变边界，再对剩余区域做平台/斜坡采样，减少纯阈值边界误判。',
  },
  {
    value: 'optimal_segmentation_v1',
    label: '最优分段 V1（实验）',
    description: '单一 L∞ 目标、预算约束的精确 minimax 分段，边界为真实采样点，无锚点无特例。',
  },
]

const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFiles = ref<File[]>([])
const localRuleSetId = ref(props.defaultRuleSetId || '')
const overwriteCurrentSession = ref(true)
const localCompressionAlgorithm = ref<CompressionAlgorithmKey>('adaptive_v2')

const enabledRuleSets = computed(() => props.ruleSets.filter(ruleSet => ruleSet.is_enabled))
const hasActiveSession = computed(() => props.currentBatchStatus !== 'idle')
const canSubmit = computed(() => !!localRuleSetId.value && selectedFiles.value.length > 0)
const compressionAlgorithmLabel = computed(() => {
  return compressionAlgorithms.find(item => item.value === localCompressionAlgorithm.value)?.label || '未选择'
})

function triggerFileSelect() {
  fileInputRef.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  selectedFiles.value = files
  input.value = ''
}

function removeFile(index: number) {
  selectedFiles.value.splice(index, 1)
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function submitTask() {
  if (!localRuleSetId.value || selectedFiles.value.length === 0) {
    return
  }
  emit('submit', {
    files: [...selectedFiles.value],
    ruleSetId: localRuleSetId.value,
    overwriteCurrentSession: overwriteCurrentSession.value,
    compressionAlgorithm: localCompressionAlgorithm.value,
  })
}
</script>

<style scoped>
.task-launch-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: min(68vh, 560px);
  overflow-y: auto;
  padding-right: 4px;
}
.task-launch-alert-body {
  font-size: 13px;
  line-height: 1.6;
}
.task-launch-file-block {
  width: 100%;
}
.task-launch-file-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.task-launch-file-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.task-launch-empty {
  padding: 18px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  background: var(--el-fill-color-lighter);
}
.task-launch-file-list {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  max-height: 240px;
  overflow-y: auto;
}
.task-launch-file-list-header {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}
.task-launch-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.task-launch-file-item:first-of-type {
  border-top: none;
}
.task-launch-file-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.task-launch-file-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-launch-file-size {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.task-launch-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.task-launch-option-name {
  color: var(--el-text-color-primary);
}
.task-launch-option-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.task-launch-summary {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.task-launch-summary-line {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.task-launch-summary-line .label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
.task-launch-summary-line .value {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
:deep(.task-launch-dialog .el-dialog__body) {
  max-height: min(76vh, 640px);
  overflow: hidden;
}
</style>
