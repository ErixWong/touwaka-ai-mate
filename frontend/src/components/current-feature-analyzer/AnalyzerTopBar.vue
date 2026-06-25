<template>
  <div class="cfa-topbar">
    <div class="cfa-topbar-left">
      <div class="cfa-topbar-titles">
        <span class="cfa-topbar-title">电流采样特征分析</span>
        <span class="cfa-topbar-subtitle">基于规则集与 LLM 的电流阶段识别工作台</span>
      </div>
      <el-select
        v-model="selectedRuleSet"
        placeholder="选择规则集"
        size="default"
        style="width: 220px"
      >
        <el-option
          v-for="rs in ruleSets.filter(r => r.is_enabled)"
          :key="rs.id"
          :label="rs.rule_set_name"
          :value="rs.id"
        >
          <span>{{ rs.rule_set_name }}</span>
          <span v-if="rs.description" class="rs-option-desc">{{ rs.description }}</span>
        </el-option>
      </el-select>
    </div>
    <div class="cfa-topbar-actions">
      <el-button type="primary" @click="triggerUpload" :disabled="loading">上传 CSV</el-button>
      <el-button
        type="success"
        @click="$emit('runAnalysis')"
        :disabled="!canAnalyze || loading"
      >
        开始分析
      </el-button>
      <el-button
        type="warning"
        @click="$emit('export')"
        :disabled="!canExport"
      >
        导出 Excel
      </el-button>
      <el-tooltip v-if="isAdmin" content="系统配置" placement="bottom">
        <el-button @click="$emit('openConfig')" icon="Setting">配置</el-button>
      </el-tooltip>
      <el-tooltip v-if="isAdmin" content="规则集管理" placement="bottom">
        <el-button @click="$emit('openRulesetEditor')" icon="Edit">规则</el-button>
      </el-tooltip>
      <input
        ref="fileInputRef"
        type="file"
        multiple
        accept=".csv"
        style="display: none"
        @change="onFileChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { RuleSetItem } from '@/api/current-feature-analyzer'

const props = defineProps<{
  batchStatus: string
  loading: boolean
  ruleSets: RuleSetItem[]
  selectedRuleSetId: string | null
  isAdmin: boolean
}>()

const emit = defineEmits<{
  upload: [files: File[]]
  selectRuleSet: [id: string]
  runAnalysis: []
  export: []
  openConfig: []
  openRulesetEditor: []
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

const selectedRuleSet = computed({
  get: () => props.selectedRuleSetId || '',
  set: (val: string) => emit('selectRuleSet', val),
})

const canAnalyze = computed(() => {
  const hasFiles = props.batchStatus === 'ready' || props.batchStatus === 'completed' || props.batchStatus === 'partial_failed'
  return hasFiles && props.selectedRuleSetId && !props.loading
})

const canExport = computed(() => {
  return props.batchStatus === 'completed' || props.batchStatus === 'partial_failed'
})

function triggerUpload() {
  fileInputRef.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    emit('upload', Array.from(input.files))
  }
  input.value = ''
}
</script>

<style scoped>
.cfa-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.cfa-topbar-left {
  display: flex;
  align-items: center;
  gap: 20px;
}
.cfa-topbar-titles {
  display: flex;
  flex-direction: column;
}
.cfa-topbar-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.cfa-topbar-subtitle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.cfa-topbar-actions {
  display: flex;
  gap: 8px;
}
.rs-option-desc {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-left: 8px;
}
</style>
