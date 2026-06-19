<template>
  <el-card shadow="never">
    <template #header><span class="card-title">辅助指标</span></template>
    <el-table :data="metrics" size="small" stripe border>
      <el-table-column prop="stage_name" label="阶段" width="120" />
      <el-table-column prop="ripple_rate" label="纹波率" width="120">
        <template #default="{ row }">
          {{ (row.ripple_rate * 100).toFixed(2) }}%
        </template>
      </el-table-column>
      <el-table-column prop="peak_to_peak" label="峰峰值(A)" width="110" :formatter="fmtNum" />
      <el-table-column label="提示" min-width="200">
        <template #default="{ row }">
          <span v-if="row._low_base_warning" class="cfa-warn-tip">{{ row._low_base_warning }}</span>
          <span v-else-if="row._warning" class="cfa-warn-tip">{{ row._warning }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{ metrics: any[] }>()
function fmtNum(_row: any, _col: any, val: any) {
  if (typeof val === 'number') return val.toFixed(4)
  return val ?? '-'
}
</script>

<style scoped>
.cfa-warn-tip { color: var(--el-color-warning); font-size: 12px; }
</style>
