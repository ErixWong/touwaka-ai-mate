import logger from '../../../../lib/logger.js';

const EPSILON = 0.001;

function lowerBound(points, targetTime, hintIndex = 0) {
  let left = Math.max(0, hintIndex);
  let right = points.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid][0] < targetTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function upperBound(points, targetTime, hintIndex = 0) {
  let left = Math.max(0, hintIndex);
  let right = points.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid][0] <= targetTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

class StageMetricsService {
  constructor(db) {
    this.db = db;
  }

  calculate(points, llmResult) {
    const stages = llmResult.stages || [];
    const metrics = [];
    let startHintIndex = 0;

    for (const stage of stages) {
      const startIndex = lowerBound(points, stage.start_time, startHintIndex);
      const endExclusive = upperBound(points, stage.end_time, startIndex);
      const pointCount = endExclusive - startIndex;
      startHintIndex = startIndex;

      if (pointCount <= 0) {
        metrics.push({
          ...stage,
          point_count: 0,
          duration: parseFloat((stage.end_time - stage.start_time).toFixed(6)),
          start_current: 0,
          end_current: 0,
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

      const n = pointCount;
      const startCurrent = points[startIndex][1];
      const endCurrent = points[endExclusive - 1][1];
      let minCurrent = startCurrent;
      let maxCurrent = startCurrent;
      let sum = 0;
      let sumSquares = 0;

      for (let index = startIndex; index < endExclusive; index++) {
        const current = points[index][1];
        if (current < minCurrent) minCurrent = current;
        if (current > maxCurrent) maxCurrent = current;
        sum += current;
        sumSquares += current * current;
      }

      const avgCurrent = sum / n;
      const variance = Math.max(0, (sumSquares / n) - (avgCurrent * avgCurrent));
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
        start_current: parseFloat(startCurrent.toFixed(6)),
        end_current: parseFloat(endCurrent.toFixed(6)),
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
