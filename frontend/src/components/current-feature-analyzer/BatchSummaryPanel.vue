<template>
  <div class="cfa-batch-summary">
    <el-card shadow="never">
      <template #header><span class="card-title">批量汇总</span></template>
      <div class="cfa-summary-grid">
        <div class="cfa-summary-stat">
          <span class="cfa-summary-value">{{ fileStats.total }}</span>
          <span class="cfa-summary-label">文件总数</span>
        </div>
        <div
          class="cfa-summary-stat success"
          :class="{ 'cfa-zero': fileStats.completed === 0 }"
        >
          <span class="cfa-summary-value">{{ fileStats.completed }}</span>
          <span class="cfa-summary-label">成功</span>
        </div>
        <div
          class="cfa-summary-stat warning-stat clickable"
          v-if="fileStats.warning_count > 0"
          @click="$emit('jumpWarning')"
        >
          <span class="cfa-summary-value warning-val">{{ fileStats.warning_count }}</span>
          <span class="cfa-summary-label">有告警</span>
        </div>
        <div
          class="cfa-summary-stat failed clickable"
          :class="{ 'cfa-zero': fileStats.failed === 0 }"
          @click="fileStats.failed > 0 && $emit('jumpFailed')"
        >
          <span class="cfa-summary-value">{{ fileStats.failed }}</span>
          <span class="cfa-summary-label">失败</span>
        </div>
        <div v-if="fileStats.analyzing > 0" class="cfa-summary-stat analyzing">
          <span class="cfa-summary-value">{{ fileStats.analyzing }}</span>
          <span class="cfa-summary-label">分析中</span>
        </div>
      </div>
      <div class="cfa-export-hint" v-if="fileStats.completed > 0 && fileStats.failed === 0 && fileStats.analyzing === 0">
        本次分析已全部完成，请及时导出 Excel
        <el-button type="warning" size="small" @click="$emit('export')" style="margin-left: 8px">导出 Excel</el-button>
      </div>
      <div class="cfa-export-hint export-partial" v-else-if="fileStats.failed > 0 && fileStats.analyzing === 0">
        部分文件失败（{{ fileStats.failed }} 个），请先检查异常文件后再导出
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  summary: any
  fileStats: { total: number; completed: number; failed: number; warning_count: number; analyzing: number; pending: number }
}>()

defineEmits<{
  jumpFailed: []
  jumpWarning: []
  export: []
}>()
</script>

<style scoped>
.cfa-batch-summary { padding: 0 16px 16px; }
.cfa-summary-grid {
  display: flex;
  gap: 32px;
  justify-content: center;
  flex-wrap: wrap;
}
.cfa-summary-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.cfa-summary-stat.clickable {
  cursor: pointer;
  border-radius: 8px;
  padding: 4px 12px;
  transition: background 0.15s;
}
.cfa-summary-stat.clickable:hover:not(.cfa-zero) { background: var(--el-fill-color-light); }
.cfa-summary-stat.clickable.cfa-zero { cursor: default; opacity: 0.7; }
.cfa-summary-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-color-primary);
}
.cfa-summary-stat.failed .cfa-summary-value { color: var(--el-color-danger); }
.cfa-summary-stat.warning-stat .warning-val { color: var(--el-color-warning); }
.cfa-summary-stat.analyzing .cfa-summary-value { color: var(--el-color-info); }
.cfa-summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.cfa-export-hint {
  text-align: center;
  margin-top: 12px;
  color: var(--el-color-success);
  font-size: 14px;
}
.cfa-export-hint.export-partial {
  color: var(--el-color-warning);
}
</style>
