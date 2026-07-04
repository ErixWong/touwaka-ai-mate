<template>
  <div class="cfa-batch-overview">
    <div class="cfa-overview-title">批次概览</div>
    <div class="cfa-overview-stats">
      <div class="cfa-overview-stat">
        <span class="stat-value">{{ stats.total }}</span>
        <span class="stat-label">总文件</span>
      </div>
      <div class="cfa-overview-stat success" :class="{ zero: stats.completed === 0 }">
        <span class="stat-value">{{ stats.completed }}</span>
        <span class="stat-label">已完成</span>
      </div>
      <div class="cfa-overview-stat failed" :class="{ zero: stats.failed === 0 }">
        <span class="stat-value">{{ stats.failed }}</span>
        <span class="stat-label">失败</span>
      </div>
      <div v-if="stats.analyzing > 0" class="cfa-overview-stat analyzing">
        <span class="stat-value">{{ stats.analyzing }}</span>
        <span class="stat-label">分析中</span>
      </div>
      <div v-if="stats.warning_count > 0" class="cfa-overview-stat warning">
        <span class="stat-value">{{ stats.warning_count }}</span>
        <span class="stat-label">有告警</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  stats: {
    total: number
    completed: number
    failed: number
    warning_count: number
    analyzing: number
    pending: number
  }
}>()
</script>

<style scoped>
.cfa-batch-overview {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.cfa-overview-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}
.cfa-overview-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.cfa-overview-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  background: var(--el-bg-color);
  border-radius: 6px;
}
.cfa-overview-stat .stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}
.cfa-overview-stat .stat-label {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.cfa-overview-stat.success .stat-value { color: var(--el-color-success); }
.cfa-overview-stat.failed .stat-value { color: var(--el-color-danger); }
.cfa-overview-stat.analyzing .stat-value { color: var(--el-color-primary); }
.cfa-overview-stat.warning .stat-value { color: var(--el-color-warning); }
.cfa-overview-stat.zero { opacity: 0.5; }
</style>