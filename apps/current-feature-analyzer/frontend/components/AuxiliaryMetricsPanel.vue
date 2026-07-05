<template>
  <el-card shadow="never">
    <template #header><span class="card-title">指标说明</span></template>
    <div class="metric-help-list">
      <div class="metric-help-item">
        <div class="metric-help-name">开始 / 结束 / 时长</div>
        <div class="metric-help-desc">开始和结束来自阶段识别结果，时长 = `end_time - start_time`。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">点数</div>
        <div class="metric-help-desc">原始电流数据中，时间落在该阶段区间内的采样点数量。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">平均电流</div>
        <div class="metric-help-desc">该阶段所有采样点电流值的算术平均值。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">标准差</div>
        <div class="metric-help-desc">该阶段电流围绕平均电流的离散程度，越大说明波动越明显。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">抖动率</div>
        <div class="metric-help-desc">`标准差 / max(|平均电流|, 0.001)`，用于描述相对波动幅度。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">纹波率</div>
        <div class="metric-help-desc">`(最大电流 - 最小电流) / max(|平均电流|, 0.001)`，反映峰谷摆动相对平均电流的比例。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">峰峰值</div>
        <div class="metric-help-desc">`最大电流 - 最小电流`，表示该阶段电流摆幅的绝对值。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">置信度</div>
        <div class="metric-help-desc">来自阶段识别结果，用于表达该阶段识别的可信程度。</div>
      </div>
      <div class="metric-help-item">
        <div class="metric-help-name">提示</div>
        <div class="metric-help-desc">当阶段内无有效点，或平均电流过低导致抖动率参考意义有限时，会在表中显示提示信息。</div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
</script>

<style scoped>
.metric-help-list {
  display: grid;
  gap: 12px;
}
.metric-help-item {
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.metric-help-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}
.metric-help-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
