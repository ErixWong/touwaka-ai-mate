<template>
  <el-card class="compressed-segments-table" shadow="never">
    <template #header>
      <div class="table-header">
        <div>
          <div class="table-title">压缩段明细</div>
          <div class="table-note">直接观察每段的平台、斜坡、尖峰和拟合情况，判断是否符合人眼直觉</div>
        </div>
      </div>
    </template>

    <el-table :data="segments" stripe size="small" max-height="420">
      <el-table-column label="#" min-width="60">
        <template #default="scope">
          {{ scope.row.segment_index ?? scope.$index }}
        </template>
      </el-table-column>
      <el-table-column label="类型" min-width="120">
        <template #default="scope">
          <el-tag size="small" effect="plain">{{ scope.row.kind || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="开始时间" min-width="110">
        <template #default="scope">{{ formatNumber(scope.row.start_time) }}</template>
      </el-table-column>
      <el-table-column label="结束时间" min-width="110">
        <template #default="scope">{{ formatNumber(scope.row.end_time) }}</template>
      </el-table-column>
      <el-table-column label="持续时长" min-width="110">
        <template #default="scope">{{ formatNumber(scope.row.duration) }}</template>
      </el-table-column>
      <el-table-column prop="point_count" label="点数" min-width="90" />
      <el-table-column label="代表电流" min-width="110">
        <template #default="scope">{{ formatNumber(scope.row.representative_current) }}</template>
      </el-table-column>
      <el-table-column label="带宽" min-width="100">
        <template #default="scope">{{ formatNumber(scope.row.bandwidth) }}</template>
      </el-table-column>
      <el-table-column label="斜率" min-width="100">
        <template #default="scope">{{ formatNumber(scope.row.slope) }}</template>
      </el-table-column>
      <el-table-column label="折点数" min-width="100">
        <template #default="scope">{{ scope.row.polyline_points?.length ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="拟合误差" min-width="110">
        <template #default="scope">{{ formatNumber(scope.row.line_fit_error) }}</template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import type { SegmentItem } from '../api/current-feature-analyzer'

defineProps<{ segments: SegmentItem[] }>()

function formatNumber(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return value.toFixed(4)
}
</script>

<style scoped>
.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.table-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.table-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
