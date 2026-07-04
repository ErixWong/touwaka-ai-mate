<template>
  <div class="cfa-topbar">
    <div class="cfa-topbar-left">
      <div class="cfa-topbar-titles">
        <span class="cfa-topbar-title">电流特征分析</span>
        <span class="cfa-topbar-subtitle">批量上传 CSV 文件，在前端完成电流特征分析并导出结果</span>
      </div>
    </div>
    <div class="cfa-topbar-actions">
      <el-tooltip content="新建分析任务" placement="bottom">
        <el-button type="primary" :icon="FolderAdd" :disabled="loading" @click="$emit('openLaunch')" />
      </el-tooltip>
      <el-button
        type="success"
        :icon="Promotion"
        :disabled="!canAnalyze || loading"
        @click="$emit('runAnalysis')"
      />
      <el-button
        type="warning"
        :icon="Download"
        :disabled="!canExport"
        @click="$emit('export')"
      />
      <el-dropdown v-if="isAdmin" trigger="click">
        <el-button :icon="MoreFilled" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="$emit('openRulesetEditor')">
              <el-icon><Edit /></el-icon>分析规则管理
            </el-dropdown-item>
            <el-dropdown-item @click="$emit('openConfig')">
              <el-icon><Setting /></el-icon>分析参数设置
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Download, Edit, FolderAdd, MoreFilled, Promotion, Setting } from '@element-plus/icons-vue'

const props = defineProps<{
  batchStatus: string
  loading: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{
  openLaunch: []
  runAnalysis: []
  export: []
  openConfig: []
  openRulesetEditor: []
}>()

const canAnalyze = computed(() => {
  const hasFiles = props.batchStatus === 'ready'
  return hasFiles && !props.loading
})

const canExport = computed(() => props.batchStatus === 'completed' || props.batchStatus === 'partial_failed')
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
</style>
