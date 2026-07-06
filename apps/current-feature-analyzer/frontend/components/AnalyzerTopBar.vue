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
        <el-button class="cfa-topbar-btn is-primary" :icon="FolderAdd" :disabled="loading" @click="$emit('openLaunch')" />
      </el-tooltip>
      <el-button
        class="cfa-topbar-btn"
        :icon="Download"
        :disabled="!canExport"
        @click="$emit('export')"
      />
      <el-dropdown v-if="isAdmin" trigger="click">
        <el-button class="cfa-topbar-btn" :icon="Setting" />
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
import { Download, Edit, FolderAdd, Setting } from '@element-plus/icons-vue'

const props = defineProps<{
  batchStatus: string
  loading: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{
  openLaunch: []
  export: []
  openConfig: []
  openRulesetEditor: []
}>()

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
  align-items: center;
  gap: 10px;
}
:deep(.cfa-topbar-btn) {
  width: 38px;
  height: 38px;
  margin: 0;
  padding: 0;
  border-radius: 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  box-shadow: none;
}
:deep(.cfa-topbar-btn:hover),
:deep(.cfa-topbar-btn:focus-visible) {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
:deep(.cfa-topbar-btn.is-primary) {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}
:deep(.cfa-topbar-btn.is-primary:hover),
:deep(.cfa-topbar-btn.is-primary:focus-visible) {
  border-color: var(--el-color-primary-light-3);
  background: var(--el-color-primary-light-3);
  color: #fff;
}
:deep(.cfa-topbar-btn.is-disabled),
:deep(.cfa-topbar-btn.is-disabled:hover) {
  border-color: var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
}
</style>
