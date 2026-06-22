import logger from '../../../lib/logger.js';

const EPSILON = 0.001;

class StageMetricsService {
  constructor(db) {
    this.db = db;
  }

  calculate(points, llmResult) {
    const stages = llmResult.stages || [];
    const metrics = [];

    for (const stage of stages) {
      const stagePoints = points.filter(
        ([t]) => t >= stage.start_time && t <= stage.end_time
      );

      if (stagePoints.length === 0) {
        metrics.push({
          ...stage,
          point_count: 0,
          duration: parseFloat((stage.end_time - stage.start_time).toFixed(6)),
          min_current: 0,
          max_current: 0,
          avg_current: 0,
          jitter_rate: 0,
          std_current: 0,
          peak_to_peak: 0,
          ripple_rate: 0,
          _warning: '阶段点数为 0，无法计算统计指标',
        });
        continue;
      }

      const currents = stagePoints.map(p => p[1]);
      const n = currents.length;
      const minCurrent = Math.min(...currents);
      const maxCurrent = Math.max(...currents);
      const sum = currents.reduce((a, b) => a + b, 0);
      const avgCurrent = sum / n;

      const variance = currents.reduce((s, c) => s + (c - avgCurrent) * (c - avgCurrent), 0) / n;
      const stdCurrent = Math.sqrt(variance);

      const absAvg = Math.max(Math.abs(avgCurrent), EPSILON);
      const jitterRate = parseFloat((stdCurrent / absAvg).toFixed(6));
      const rippleRate = parseFloat(((maxCurrent - minCurrent) / absAvg).toFixed(6));
      const peakToPeak = parseFloat((maxCurrent - minCurrent).toFixed(6));

      metrics.push({
        stage_code: stage.stage_code,
        stage_name: stage.stage_name,
        start_time: stage.start_time,
        end_time: stage.end_time,
        duration: parseFloat((stage.end_time - stage.start_time).toFixed(6)),
        point_count: n,
        min_current: parseFloat(minCurrent.toFixed(6)),
        max_current: parseFloat(maxCurrent.toFixed(6)),
        avg_current: parseFloat(avgCurrent.toFixed(6)),
        jitter_rate: jitterRate,
        std_current: parseFloat(stdCurrent.toFixed(6)),
        peak_to_peak: peakToPeak,
        ripple_rate: rippleRate,
        confidence: stage.confidence ?? null,
        reason: stage.reason ?? null,
        _low_base_warning: absAvg <= 0.02 ? '低基值阶段，抖动率仅供参考' : null,
      });
    }

    return metrics;
  }

  buildFileMetrics(points, segments, stageMetrics, llmResult) {
    return {
      point_total: points.length,
      valid_point_count: points.length,
      segment_count: segments.length,
      polyline_point_count: segments.reduce((s, seg) => s + (seg.polyline_points || []).length, 0),
      stage_count: stageMetrics.length,
      warning_count: (llmResult.warnings || []).length,
      warnings: llmResult.warnings || [],
    };
  }
}

export default StageMetricsService;
