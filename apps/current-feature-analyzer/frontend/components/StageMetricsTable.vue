<template>
  <el-card shadow="never">
    <template #header><span class="card-title">阶段指标明细</span></template>
    <el-table :data="metrics" size="small" stripe border>
      <el-table-column prop="stage_name" label="阶段" width="100" />
      <el-table-column prop="start_time" label="开始(s)" width="90" :formatter="fmtNum" />
      <el-table-column prop="end_time" label="结束(s)" width="90" :formatter="fmtNum" />
      <el-table-column prop="duration" label="时长(s)" width="90" :formatter="fmtNum" />
      <el-table-column prop="point_count" label="点数" width="70" />
      <el-table-column prop="avg_current" label="平均电流(A)" width="110" :formatter="fmtNum" />
      <el-table-column prop="jitter_rate" label="抖动率" width="100">
        <template #default="{ row }">
          {{ (row.jitter_rate * 100).toFixed(2) }}%
        </template>
      </el-table-column>
      <el-table-column prop="std_current" label="标准差" width="90" :formatter="fmtNum" />
      <el-table-column prop="min_current" label="最小值(A)" width="100" :formatter="fmtNum" />
      <el-table-column prop="max_current" label="最大值(A)" width="100" :formatter="fmtNum" />
      <el-table-column prop="confidence" label="置信度" width="80">
        <template #default="{ row }">
          {{ row.confidence != null ? (row.confidence * 100).toFixed(0) + '%' : '-' }}
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import type { StageMetric } from '../api/current-feature-analyzer'

defineProps<{ metrics: StageMetric[] }>()
function fmtNum(_row: any, _col: any, val: any) {
  if (typeof val === 'number') return val.toFixed(4)
  return val ?? '-'
}
</script>
