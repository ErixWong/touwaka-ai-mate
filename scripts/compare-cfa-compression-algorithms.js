import fs from 'node:fs';
import CsvParseService from '../apps/current-feature-analyzer/server/services/csv-parse.service.js';

const DEFAULT_SAMPLE_FILE = 'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv';

const WINDOW_SECONDS = 0.02;
const TARGET_MIN_POINTS = 40;
const TARGET_MAX_POINTS = 60;
const TARGET_POINT_COUNT = 52;
const THRESHOLD_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 9, 12, 15, 18, 22, 26, 30];
const SAMPLE_SUITE = [
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-FL_1.csv',
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-FR_1.csv',
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RL_1.csv',
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv',
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\scope_0.1.csv',
];

function printHeader(title) {
  console.log(`\n========== ${title} ==========`);
}

function formatNumber(value, digits = 3) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(length - 1, index));
}

function quantile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  return sortedValues[clampIndex(Math.floor((sortedValues.length - 1) * ratio), sortedValues.length)];
}

function createWindows(points, windowSeconds) {
  if (!points.length) return [];
  const windows = [];
  let bucket = [];
  let bucketStart = points[0][0];
  let bucketEnd = bucketStart + windowSeconds;

  for (const point of points) {
    const [time, current] = point;
    while (time >= bucketEnd) {
      if (bucket.length > 0) {
        windows.push(summarizeWindow(bucket, bucketStart, bucketEnd));
      }
      bucket = [];
      bucketStart = bucketEnd;
      bucketEnd = bucketStart + windowSeconds;
    }
    bucket.push(current);
  }

  if (bucket.length > 0) {
    windows.push(summarizeWindow(bucket, bucketStart, bucketEnd));
  }

  return windows.map((window, index) => ({ ...window, index }));
}

function summarizeWindow(currents, startTime, endTime) {
  const sorted = currents.slice().sort((left, right) => left - right);
  const sum = currents.reduce((acc, value) => acc + value, 0);
  const mean = sum / currents.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p10 = quantile(sorted, 0.1);
  const p50 = quantile(sorted, 0.5);
  const p90 = quantile(sorted, 0.9);
  return {
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(Math.min(endTime, startTime + WINDOW_SECONDS).toFixed(6)),
    duration: Number((Math.min(endTime, startTime + WINDOW_SECONDS) - startTime).toFixed(6)),
    point_count: currents.length,
    mean_current: Number(mean.toFixed(6)),
    min_current: Number(min.toFixed(6)),
    max_current: Number(max.toFixed(6)),
    p10_current: Number(p10.toFixed(6)),
    p50_current: Number(p50.toFixed(6)),
    p90_current: Number(p90.toFixed(6)),
    span_current: Number((max - min).toFixed(6)),
  };
}

function deriveGlobals(points, windows) {
  const currents = points.map(([, current]) => current).sort((left, right) => left - right);
  const head = windows.slice(0, 12);
  const tail = windows.slice(-12);
  const baselineCandidates = [...head, ...tail].filter(Boolean);
  const baselineWindow = baselineCandidates.reduce((best, candidate) => {
    if (!best) return candidate;
    return Math.abs(candidate.mean_current) < Math.abs(best.mean_current) ? candidate : best;
  }, null);
  const baselineMean = baselineWindow ? baselineWindow.mean_current : 0;
  const baselineMagnitude = Math.max(Math.abs(baselineMean), 0.0001);

  return {
    point_count: points.length,
    time_start: Number(points[0][0].toFixed(6)),
    time_end: Number(points[points.length - 1][0].toFixed(6)),
    baseline_mean: Number(baselineMean.toFixed(6)),
    baseline_magnitude: Number(baselineMagnitude.toFixed(6)),
    p50_current: Number(quantile(currents, 0.5).toFixed(6)),
    p75_current: Number(quantile(currents, 0.75).toFixed(6)),
    p90_current: Number(quantile(currents, 0.9).toFixed(6)),
    p95_current: Number(quantile(currents, 0.95).toFixed(6)),
    p99_current: Number(quantile(currents, 0.99).toFixed(6)),
    full_scale: Number((quantile(currents, 0.99) - quantile(currents, 0.01)).toFixed(6)),
  };
}

function enrichWindows(windows, globals) {
  return windows.map((window, index) => {
    const previous = windows[index - 1] || null;
    const next = windows[index + 1] || null;
    const deltaMean = previous ? window.mean_current - previous.mean_current : 0;
    const deltaPeak = previous ? window.max_current - previous.max_current : 0;
    const deltaNext = next ? next.mean_current - window.mean_current : 0;
    const baselineRatio = Math.abs(window.mean_current) / globals.baseline_magnitude;
    const peakRatio = Math.abs(window.max_current) / globals.baseline_magnitude;
    return {
      ...window,
      baseline_ratio: Number(baselineRatio.toFixed(6)),
      peak_ratio: Number(peakRatio.toFixed(6)),
      delta_mean: Number(deltaMean.toFixed(6)),
      delta_peak: Number(deltaPeak.toFixed(6)),
      delta_next: Number(deltaNext.toFixed(6)),
    };
  });
}

function localExtremaIndices(values) {
  const indices = new Set();
  for (let index = 1; index < values.length - 1; index++) {
    const previous = values[index - 1];
    const current = values[index];
    const next = values[index + 1];
    if ((current >= previous && current >= next) || (current <= previous && current <= next)) {
      indices.add(index);
    }
  }
  return indices;
}

function computeExtremaProminence(values, index) {
  if (index <= 0 || index >= values.length - 1) return 0;
  const current = values[index];
  const previous = values[index - 1];
  const next = values[index + 1];
  return Math.max(Math.abs(current - previous), Math.abs(current - next));
}

function buildKeyPoint(index, windows, globals) {
  const window = windows[index];
  const previous = windows[index - 1] || window;
  const next = windows[index + 1] || window;
  const deltaLeft = window.mean_current - previous.mean_current;
  const deltaRight = next.mean_current - window.mean_current;
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  const changePercent = Math.max(Math.abs(deltaLeft), Math.abs(deltaRight), Math.abs(window.delta_peak || 0)) / fullScale * 100;
  return {
    point_index: index,
    time: Number(window.start_time.toFixed(6)),
    mean_current: window.mean_current,
    min_current: window.min_current,
    max_current: window.max_current,
    span_current: window.span_current,
    baseline_ratio: window.baseline_ratio,
    peak_ratio: window.peak_ratio,
    delta_left: Number(deltaLeft.toFixed(6)),
    delta_right: Number(deltaRight.toFixed(6)),
    change_percent: Number(changePercent.toFixed(3)),
  };
}

function ensureAnchors(indices, windows) {
  if (!windows.length) return indices;
  indices.add(0);
  indices.add(windows.length - 1);
  return indices;
}

function buildCandidateInfo(index, windows, globals) {
  const point = buildKeyPoint(index, windows, globals);
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const meanValues = windows.map(window => window.mean_current);
  const peakValues = windows.map(window => window.max_current);
  const meanProminence = computeExtremaProminence(meanValues, index) / fullScale * 100;
  const peakProminence = computeExtremaProminence(peakValues, index) / fullScale * 100;
  const importance = point.change_percent * 4
    + Math.max(point.peak_ratio - 1, 0) * 0.6
    + Math.max(point.baseline_ratio - 1, 0) * 0.25
    + meanProminence * 1.5
    + peakProminence * 1.75;
  return {
    index,
    point,
    mean_prominence: Number(meanProminence.toFixed(3)),
    peak_prominence: Number(peakProminence.toFixed(3)),
    importance: Number(importance.toFixed(3)),
  };
}

function reduceIndices(indices, windows, globals, targetCount, thresholdPercent, mandatoryIndices = []) {
  if (indices.length <= targetCount) {
    return indices;
  }

  const candidates = indices.map(index => buildCandidateInfo(index, windows, globals));
  const anchors = new Set([0, windows.length - 1]);
  const stallPeakThreshold = globals.p95_current / globals.baseline_magnitude * 0.9;
  const mandatorySet = new Set(mandatoryIndices);
  const mandatory = candidates.filter(candidate => (
    anchors.has(candidate.index)
    || mandatorySet.has(candidate.index)
    || candidate.point.change_percent >= Math.max(10, thresholdPercent * 1.5)
    || candidate.point.peak_ratio >= stallPeakThreshold
  ));

  const keep = new Set(mandatory.map(candidate => candidate.index));
  const bucketCount = Math.min(12, targetCount);
  const bucketSize = Math.max(1, Math.ceil(windows.length / bucketCount));

  for (let bucketIndex = 0; bucketIndex < bucketCount && keep.size < targetCount; bucketIndex++) {
    const bucketStart = bucketIndex * bucketSize;
    const bucketEnd = Math.min(windows.length, bucketStart + bucketSize);
    const bucketCandidates = candidates
      .filter(candidate => candidate.index >= bucketStart && candidate.index < bucketEnd && !keep.has(candidate.index))
      .sort((left, right) => right.importance - left.importance);
    if (bucketCandidates.length > 0) {
      keep.add(bucketCandidates[0].index);
    }
  }

  const sortedByImportance = candidates
    .filter(candidate => !keep.has(candidate.index))
    .sort((left, right) => right.importance - left.importance);

  for (const candidate of sortedByImportance) {
    if (keep.size >= targetCount) break;
    keep.add(candidate.index);
  }

  return [...keep].sort((left, right) => left - right);
}

function detectHighPlateauAnchors(windows, globals) {
  if (!windows.length) return new Set();
  const anchors = new Set();
  const maxPeak = Math.max(...windows.map(window => window.max_current));
  const highPeakThreshold = Math.max(globals.p95_current, maxPeak * 0.94);
  const highMeanThreshold = Math.max(globals.p90_current * 0.92, globals.p95_current * 0.82);
  let runStart = -1;

  const flushRun = (runEnd) => {
    if (runStart === -1 || runEnd < runStart) return;
    const runLength = runEnd - runStart + 1;
    if (runLength < 2) {
      runStart = -1;
      return;
    }
    let peakIndex = runStart;
    for (let index = runStart + 1; index <= runEnd; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) {
        peakIndex = index;
      }
    }
    anchors.add(runStart);
    anchors.add(peakIndex);
    anchors.add(runEnd);
    if (runEnd - 1 >= runStart) anchors.add(runEnd - 1);
    if (runStart + 1 <= runEnd) anchors.add(runStart + 1);
    runStart = -1;
  };

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index];
    const inHighPlateau = window.max_current >= highPeakThreshold && window.mean_current >= highMeanThreshold;
    if (inHighPlateau) {
      if (runStart === -1) runStart = index;
      continue;
    }
    if (runStart !== -1) {
      flushRun(index - 1);
    }
  }
  flushRun(windows.length - 1);
  return anchors;
}

function detectPlateauBoundaryAnchors(windows, globals) {
  const runs = buildStateRuns(windows, globals);
  const anchors = new Set();
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);

  const isSteepBoundary = (leftIndex, rightIndex) => {
    if (leftIndex < 0 || rightIndex >= windows.length) return false;
    const left = windows[leftIndex];
    const right = windows[rightIndex];
    const meanJumpPercent = Math.abs(right.mean_current - left.mean_current) / fullScale * 100;
    const peakJumpPercent = Math.abs(right.max_current - left.max_current) / fullScale * 100;
    const mixedWindowPercent = Math.max(left.span_current, right.span_current) / fullScale * 100;
    return meanJumpPercent >= 8 || peakJumpPercent >= 12 || mixedWindowPercent >= 18;
  };

  for (const run of runs) {
    const isPlateau = run.state === 'idle_plateau'
      || run.state === 'mid_plateau'
      || run.state === 'work_plateau'
      || run.state === 'high_plateau';
    const length = run.end - run.start + 1;
    if (!isPlateau || length < 2) continue;

    anchors.add(run.start);
    anchors.add(run.end);

    if (length >= 5) {
      anchors.add(Math.floor((run.start + run.end) / 2));
    }

    if (run.start - 1 >= 0 && !isSteepBoundary(run.start - 1, run.start)) anchors.add(run.start - 1);
    if (run.end + 1 < windows.length && !isSteepBoundary(run.end, run.end + 1)) anchors.add(run.end + 1);
  }

  return anchors;
}

function selectByThreshold(windows, globals, thresholdPercent, includeEnvelopeExtrema, includeHighPlateauAnchors = false) {
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  const selected = ensureAnchors(new Set(), windows);
  const meanExtrema = localExtremaIndices(windows.map(window => window.mean_current));
  const peakExtrema = localExtremaIndices(windows.map(window => window.max_current));
  const meanValues = windows.map(window => window.mean_current);
  const peakValues = windows.map(window => window.max_current);
  const extremaThreshold = Math.max(0.6, thresholdPercent * 0.35);

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index];
    const deltaScore = Math.max(Math.abs(window.delta_mean), Math.abs(window.delta_peak || 0)) / fullScale * 100;
    if (deltaScore >= thresholdPercent) {
      selected.add(index);
    }
  }

  for (const index of meanExtrema) {
    const prominencePercent = computeExtremaProminence(meanValues, index) / fullScale * 100;
    if (prominencePercent >= extremaThreshold) {
      selected.add(index);
    }
  }

  if (includeEnvelopeExtrema) {
    for (const index of peakExtrema) {
      const prominencePercent = computeExtremaProminence(peakValues, index) / fullScale * 100;
      if (prominencePercent >= extremaThreshold) {
        selected.add(index);
      }
    }
  }

  if (includeHighPlateauAnchors) {
    const plateauAnchors = detectHighPlateauAnchors(windows, globals);
    for (const index of plateauAnchors) {
      selected.add(index);
    }
  }

  return [...selected].sort((left, right) => left - right);
}

function fitSelectionCount(candidatesByStep) {
  let preferred = candidatesByStep[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidatesByStep) {
    const count = candidate.indices.length;
    const targetMid = (TARGET_MIN_POINTS + TARGET_MAX_POINTS) / 2;
    const distance = count >= TARGET_MIN_POINTS && count <= TARGET_MAX_POINTS
      ? Math.abs(count - targetMid)
      : Math.min(Math.abs(count - TARGET_MIN_POINTS), Math.abs(count - TARGET_MAX_POINTS)) + 100;
    if (distance < bestDistance) {
      preferred = candidate;
      bestDistance = distance;
    }
  }
  return preferred;
}

function buildSemanticPrompt(globals) {
  return [
    '背景：这是车窗升降机马达的工作电流时序数据。',
    '任务：根据按时间顺序排列的粗略关键点，推断每个阶段的起止区间与阶段顺序。',
    '阶段语义定义：',
    `1. 待机：电流接近基线，通常靠近 ${formatNumber(globals.baseline_mean, 3)}A，波动很小。`,
    '2. 启动：从待机进入工作前的快速变化阶段，常见为瞬时大电流或明显上升转折。',
    '3. 工作：启动之后的持续输出阶段，电流高于待机，通常维持相对平稳的平台或缓慢变化。',
    '4. 堵转：短时间异常高电流，显著高于工作电流，常接近单次循环中的峰值。',
    '说明：样本可能只有一组阶段，也可能有多组重复循环，不要预设循环次数。',
    '要求：优先根据关键点的顺序、转折、峰值和平台关系判断，而不是只看单点数值大小。',
  ].join('\n');
}

function renderKeyPoints(points) {
  return points.map(point => (
    `- t=${formatNumber(point.time, 3)}s, mean=${formatNumber(point.mean_current)}A, min=${formatNumber(point.min_current)}A, max=${formatNumber(point.max_current)}A, ` +
    `span=${formatNumber(point.span_current)}A, baseline_ratio=${formatNumber(point.baseline_ratio)}, peak_ratio=${formatNumber(point.peak_ratio)}, ` +
    `delta_left=${formatNumber(point.delta_left)}A, delta_right=${formatNumber(point.delta_right)}A, change=${formatNumber(point.change_percent)}%`
  )).join('\n');
}

function describeSegments(points) {
  if (points.length < 2) return '- 关键点不足，无法描述区间';
  const lines = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const meanDelta = current.mean_current - previous.mean_current;
    const trend = Math.abs(meanDelta) <= 0.25
      ? '近似平台'
      : meanDelta > 0
        ? '上升'
        : '下降';
    lines.push(
      `- ${formatNumber(previous.time, 3)}s -> ${formatNumber(current.time, 3)}s: ${trend}, ` +
      `mean ${formatNumber(previous.mean_current)}A -> ${formatNumber(current.mean_current)}A, ` +
      `peak ${formatNumber(previous.max_current)}A -> ${formatNumber(current.max_current)}A`
    );
  }
  return lines.join('\n');
}

function buildAlgorithmResult(algorithmKey, algorithmLabel, thresholdPercent, indices, windows, globals, selectionReason) {
  const keyPoints = indices.map(index => buildKeyPoint(index, windows, globals));
  return buildAlgorithmResultFromPoints(algorithmKey, algorithmLabel, thresholdPercent, keyPoints, globals, selectionReason);
}

function buildAlgorithmResultFromPoints(algorithmKey, algorithmLabel, thresholdPercent, keyPoints, globals, selectionReason) {
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: thresholdPercent,
    point_count: keyPoints.length,
    selection_reason: selectionReason,
    key_points: keyPoints,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n关键点序列：\n${renderKeyPoints(keyPoints)}\n\n关键区间关系：\n${describeSegments(keyPoints)}`,
  };
}

function classifyWindowState(window, globals) {
  const baselineRatio = window.baseline_ratio || 0;
  const peakRatio = window.peak_ratio || 0;
  const deltaMean = window.delta_mean || 0;
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const slopePercent = Math.abs(deltaMean) / fullScale * 100;

  if (baselineRatio <= 1.6 && peakRatio <= 2) return 'idle_plateau';
  if (peakRatio >= Math.max(globals.p95_current / globals.baseline_magnitude * 0.92, 18) && baselineRatio >= 0.8 * (globals.p90_current / globals.baseline_magnitude)) {
    return 'high_plateau';
  }
  if (slopePercent >= 3) {
    return deltaMean >= 0 ? 'ramp_up' : 'ramp_down';
  }
  if (baselineRatio >= 5.5) return 'work_plateau';
  if (baselineRatio >= 2.2) return 'mid_plateau';
  return 'transition';
}

function buildStateRuns(windows, globals) {
  if (!windows.length) return [];
  const runs = [];
  let currentRun = {
    state: classifyWindowState(windows[0], globals),
    start: 0,
    end: 0,
  };
  for (let index = 1; index < windows.length; index++) {
    const state = classifyWindowState(windows[index], globals);
    const previousWindow = windows[index - 1];
    const currentWindow = windows[index];
    const smoothEnough = Math.abs((currentWindow.mean_current - previousWindow.mean_current)) / Math.max(globals.full_scale, 0.0001) * 100 < 1.8;
    if (state === currentRun.state || (smoothEnough && state.includes('plateau') && currentRun.state.includes('plateau'))) {
      currentRun.end = index;
      continue;
    }
    runs.push(currentRun);
    currentRun = { state, start: index, end: index };
  }
  runs.push(currentRun);
  return runs;
}

function pickRunRepresentativeIndices(run, windows, mode) {
  const indices = [];
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);
  indices.push(run.start);
  if (length >= 3) {
    if (run.state === 'high_plateau') {
      let peakIndex = run.start;
      for (let index = run.start + 1; index <= run.end; index++) {
        if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
      }
      indices.push(peakIndex);
      if (mode === 'hybrid' && length >= 4) {
        indices.push(Math.max(run.start + 1, middle));
      }
    } else if (run.state === 'work_plateau' || run.state === 'mid_plateau' || run.state === 'idle_plateau') {
      indices.push(middle);
      if (mode === 'hybrid' && length >= 6) {
        indices.push(Math.floor((run.start + middle) / 2));
      }
    } else {
      indices.push(middle);
    }
  }
  if (run.end !== run.start) indices.push(run.end);
  return [...new Set(indices)].sort((left, right) => left - right);
}

function reducePointList(points, globals, targetCount) {
  if (points.length <= targetCount) return points;
  const withImportance = points.map((point, index) => {
    const previous = points[index - 1] || point;
    const next = points[index + 1] || point;
    const localChange = Math.max(Math.abs(point.mean_current - previous.mean_current), Math.abs(next.mean_current - point.mean_current));
    const importance = point.change_percent * 4 + point.peak_ratio * 0.8 + point.baseline_ratio * 0.25 + localChange / Math.max(globals.full_scale, 0.0001) * 100 * 2;
    return { point, importance };
  });
  const keep = new Set([0, points.length - 1]);
  const bucketCount = Math.min(12, targetCount);
  const bucketSize = Math.max(1, Math.ceil(points.length / bucketCount));
  for (let bucketIndex = 0; bucketIndex < bucketCount && keep.size < targetCount; bucketIndex++) {
    const bucketStart = bucketIndex * bucketSize;
    const bucketEnd = Math.min(points.length, bucketStart + bucketSize);
    const candidate = withImportance
      .slice(bucketStart, bucketEnd)
      .map((item, offset) => ({ ...item, index: bucketStart + offset }))
      .sort((left, right) => right.importance - left.importance)[0];
    if (candidate) keep.add(candidate.index);
  }
  const rest = withImportance
    .map((item, index) => ({ ...item, index }))
    .filter(item => !keep.has(item.index))
    .sort((left, right) => right.importance - left.importance);
  for (const item of rest) {
    if (keep.size >= targetCount) break;
    keep.add(item.index);
  }
  return [...keep].sort((left, right) => left - right).map(index => points[index]);
}

function analyzeWithStateRunPreserving(windows, globals) {
  const runs = buildStateRuns(windows, globals);
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  const indices = runs.flatMap(run => pickRunRepresentativeIndices(run, windows, 'state'));
  const uniquePoints = [...new Set(indices)].sort((left, right) => left - right).map(index => buildKeyPoint(index, windows, globals, fullScale));
  const reducedPoints = reducePointList(uniquePoints, globals, TARGET_POINT_COUNT);
  return buildAlgorithmResultFromPoints(
    'state_run_preserving_v1',
    '状态保真压缩 V1',
    null,
    reducedPoints,
    globals,
    '先识别稳定段/上升段/下降段，再按 run 保留头中尾代表点'
  );
}

function analyzeWithPlateauTrendHybrid(windows, globals) {
  const runs = buildStateRuns(windows, globals);
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  const indices = runs.flatMap(run => pickRunRepresentativeIndices(run, windows, 'hybrid'));
  const uniquePoints = [...new Set(indices)].sort((left, right) => left - right).map(index => buildKeyPoint(index, windows, globals, fullScale));
  const reducedPoints = reducePointList(uniquePoints, globals, TARGET_POINT_COUNT);
  return buildAlgorithmResultFromPoints(
    'plateau_trend_hybrid_v1',
    '平台趋势混合 V1',
    null,
    reducedPoints,
    globals,
    '以状态 run 为主，并对长平台和高平台额外保留中段与尾端'
  );
}

function classifyFeatureWindow(window, globals) {
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const slopePercent = Math.abs(window.delta_mean || 0) / fullScale * 100;
  const spanPercent = Math.abs(window.span_current || 0) / fullScale * 100;
  const baselineRatio = window.baseline_ratio || 0;
  const peakRatio = window.peak_ratio || 0;

  const level = baselineRatio <= 1.8
    ? 'low'
    : baselineRatio >= 20 || peakRatio >= 28
      ? 'high'
      : baselineRatio >= 5
        ? 'mid'
        : 'transitional';

  const motion = slopePercent >= 5
    ? ((window.delta_mean || 0) >= 0 ? 'rising_fast' : 'falling_fast')
    : slopePercent >= 1.2
      ? ((window.delta_mean || 0) >= 0 ? 'rising_slow' : 'falling_slow')
      : 'flat';

  if (spanPercent >= 12 && peakRatio >= 6) {
    return `volatile_${level}`;
  }
  if (motion === 'flat') {
    return `plateau_${level}`;
  }
  return `${motion}_${level}`;
}

function buildFeatureSegments(windows, globals) {
  if (!windows.length) return [];
  const segments = [];
  let current = {
    feature: classifyFeatureWindow(windows[0], globals),
    start: 0,
    end: 0,
  };

  for (let index = 1; index < windows.length; index++) {
    const feature = classifyFeatureWindow(windows[index], globals);
    const sameFeature = feature === current.feature;
    const bothPlateau = feature.startsWith('plateau_') && current.feature.startsWith('plateau_');
    const previous = windows[index - 1];
    const candidate = windows[index];
    const gapPercent = Math.abs(candidate.mean_current - previous.mean_current) / Math.max(globals.full_scale, 0.0001) * 100;
    if (sameFeature || (bothPlateau && gapPercent < 0.8)) {
      current.end = index;
      continue;
    }
    segments.push(current);
    current = { feature, start: index, end: index };
  }

  segments.push(current);
  return segments;
}

function summarizeFeatureSegment(segment, windows) {
  const points = windows.slice(segment.start, segment.end + 1);
  const meanValues = points.map(point => point.mean_current);
  const maxValues = points.map(point => point.max_current);
  const minValues = points.map(point => point.min_current);
  return {
    ...segment,
    duration: points[points.length - 1].end_time - points[0].start_time,
    mean_min: Math.min(...meanValues),
    mean_max: Math.max(...meanValues),
    peak_max: Math.max(...maxValues),
    valley_min: Math.min(...minValues),
  };
}

function pickFeatureSegmentIndices(segment, windows, mode) {
  const summary = summarizeFeatureSegment(segment, windows);
  const indices = [segment.start];
  const middle = Math.floor((segment.start + segment.end) / 2);
  const quarter = Math.floor((segment.start * 3 + segment.end) / 4);
  const threeQuarter = Math.floor((segment.start + segment.end * 3) / 4);
  const length = segment.end - segment.start + 1;

  if (summary.feature.startsWith('plateau_')) {
    if (length >= 3) indices.push(middle);
    if (mode === 'dense' && length >= 6) {
      indices.push(quarter, threeQuarter);
    }
  } else if (summary.feature.startsWith('volatile_')) {
    let peakIndex = segment.start;
    let valleyIndex = segment.start;
    for (let index = segment.start + 1; index <= segment.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
      if (windows[index].min_current < windows[valleyIndex].min_current) valleyIndex = index;
    }
    indices.push(peakIndex, valleyIndex);
    if (mode === 'dense' && length >= 4) indices.push(middle);
  } else {
    if (length >= 3) indices.push(middle);
    if (mode === 'dense' && length >= 5) indices.push(threeQuarter);
  }

  if (segment.end !== segment.start) indices.push(segment.end);
  return [...new Set(indices)].sort((left, right) => left - right);
}

function buildFeaturePrompt(globals, featureSegments, points) {
  const featureText = featureSegments.map(segment => (
    `- ${formatNumber(segment.start_time, 3)}s -> ${formatNumber(segment.end_time, 3)}s: ${segment.feature}, ` +
    `mean范围 ${formatNumber(segment.mean_min)}A ~ ${formatNumber(segment.mean_max)}A, ` +
    `peak_max ${formatNumber(segment.peak_max)}A, valley_min ${formatNumber(segment.valley_min)}A`
  )).join('\n');

  return `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(points)}\n\n关键区间关系：\n${describeSegments(points)}`;
}

function buildFeatureAlgorithmResult(algorithmKey, algorithmLabel, globals, windows, mode) {
  const segments = buildFeatureSegments(windows, globals).map(segment => ({
    ...segment,
    start_time: windows[segment.start].start_time,
    end_time: windows[segment.end].end_time,
  }));
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  const indices = segments.flatMap(segment => pickFeatureSegmentIndices(segment, windows, mode));
  const keyPoints = reducePointList(
    [...new Set(indices)].sort((left, right) => left - right).map(index => buildKeyPoint(index, windows, globals, fullScale)),
    globals,
    TARGET_POINT_COUNT,
  );
  const featureSummaries = segments.map(segment => summarizeFeatureSegment(segment, windows));
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: keyPoints.length,
    selection_reason: mode === 'dense'
      ? '先构建客观特征片段，再对长平台和高波动片段加密代表点'
      : '先构建客观特征片段，再为每个片段保留头中尾代表点',
    key_points: keyPoints,
    prompt_preview: buildFeaturePrompt(globals, featureSummaries, keyPoints),
  };
}

function analyzeWithFeatureSegments(windows, globals) {
  return buildFeatureAlgorithmResult('feature_segments_v1', '特征片段压缩 V1', globals, windows, 'sparse');
}

function analyzeWithFeatureSegmentsDense(windows, globals) {
  return buildFeatureAlgorithmResult('feature_segments_dense_v1', '特征片段压缩 Dense V1', globals, windows, 'dense');
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function averageRange(values, start, end) {
  const slice = values.slice(Math.max(0, start), Math.min(values.length, end + 1));
  if (!slice.length) return 0;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function buildContourRuns(windows, globals) {
  if (!windows.length) return [];
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const meanValues = windows.map(window => window.mean_current);
  const smoothValues = meanValues.map((_, index) => averageRange(meanValues, index - 2, index + 2));
  const highThreshold = Math.max(globals.p90_current * 0.9, globals.p95_current * 0.8);

  const classify = (index) => {
    const window = windows[index];
    const left = smoothValues[Math.max(0, index - 2)];
    const right = smoothValues[Math.min(smoothValues.length - 1, index + 2)];
    const localSlopePct = Math.abs(right - left) / fullScale * 100;
    const spanPct = (window.span_current || 0) / fullScale * 100;
    const peakLiftPct = Math.abs((window.max_current || 0) - (window.mean_current || 0)) / fullScale * 100;
    const isStable = localSlopePct <= 1.4;
    const isQuiet = spanPct <= 2.8;
    const isHigh = window.mean_current >= highThreshold || window.max_current >= globals.p95_current * 0.96;
    const isIdle = window.baseline_ratio <= 1.8 && window.peak_ratio <= 2.2;

    if (isStable && isQuiet) {
      if (isIdle) return 'plateau_idle';
      if (isHigh) return 'plateau_high';
      return 'plateau_work';
    }
    if (peakLiftPct >= 14 && window.max_current >= globals.p95_current * 0.8) {
      return 'peak_transition';
    }
    if (right - left >= 0) return 'rising';
    return 'falling';
  };

  const runs = [];
  let current = { feature: classify(0), start: 0, end: 0 };
  for (let index = 1; index < windows.length; index++) {
    const feature = classify(index);
    const previousWindow = windows[index - 1];
    const currentWindow = windows[index];
    const closeEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / fullScale * 100 <= 0.8;
    if (feature === current.feature || (feature.startsWith('plateau_') && current.feature.startsWith('plateau_') && closeEnough)) {
      current.end = index;
      continue;
    }
    runs.push(current);
    current = { feature, start: index, end: index };
  }
  runs.push(current);
  return { runs, smoothValues };
}

function buildContourPoint(index, windows, globals, sketchCurrent) {
  const point = buildKeyPoint(index, windows, globals);
  return {
    ...point,
    raw_mean_current: point.mean_current,
    mean_current: Number(sketchCurrent.toFixed(6)),
  };
}

function pickContourRunPoints(run, windows, globals, smoothValues, mode) {
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);
  const indices = [run.start];
  const result = [];

  if (run.feature.startsWith('plateau_')) {
    const levelSource = run.feature === 'plateau_high'
      ? windows.slice(run.start, run.end + 1).map(window => window.max_current)
      : windows.slice(run.start, run.end + 1).map(window => window.mean_current);
    const plateauLevel = median(levelSource);
    if (length >= 3) indices.push(middle);
    if (mode === 'dense' && length >= 6) {
      indices.push(Math.floor((run.start * 3 + run.end) / 4), Math.floor((run.start + run.end * 3) / 4));
    }
    if (run.end !== run.start) indices.push(run.end);
    for (const index of [...new Set(indices)].sort((left, right) => left - right)) {
      result.push(buildContourPoint(index, windows, globals, plateauLevel));
    }
    return result;
  }

  if (run.feature === 'peak_transition') {
    let peakIndex = run.start;
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
    }
    const startY = windows[run.start].mean_current;
    const endY = windows[run.end].mean_current;
    result.push(buildContourPoint(run.start, windows, globals, startY));
    result.push(buildContourPoint(peakIndex, windows, globals, windows[peakIndex].max_current));
    if (run.end !== run.start) result.push(buildContourPoint(run.end, windows, globals, endY));
    return result;
  }

  const startY = smoothValues[run.start];
  const endY = smoothValues[run.end];
  result.push(buildContourPoint(run.start, windows, globals, startY));
  if (length >= 4) {
    result.push(buildContourPoint(middle, windows, globals, smoothValues[middle]));
  }
  if (mode === 'dense' && length >= 8) {
    const quarter = Math.floor((run.start * 3 + run.end) / 4);
    const threeQuarter = Math.floor((run.start + run.end * 3) / 4);
    result.push(buildContourPoint(quarter, windows, globals, smoothValues[quarter]));
    result.push(buildContourPoint(threeQuarter, windows, globals, smoothValues[threeQuarter]));
  }
  if (run.end !== run.start) result.push(buildContourPoint(run.end, windows, globals, endY));
  return [...new Map(result.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
}

function buildContourSketchResult(algorithmKey, algorithmLabel, windows, globals, mode) {
  const { runs, smoothValues } = buildContourRuns(windows, globals);
  const points = runs.flatMap(run => pickContourRunPoints(run, windows, globals, smoothValues, mode));
  const reducedPoints = reducePointList(points, globals, TARGET_POINT_COUNT);
  const runSummary = runs.map(run => {
    const level = run.feature.startsWith('plateau_')
      ? median(windows.slice(run.start, run.end + 1).map(window => run.feature === 'plateau_high' ? window.max_current : window.mean_current))
      : averageRange(smoothValues, run.start, run.end);
    return {
      feature: run.feature,
      start_time: windows[run.start].start_time,
      end_time: windows[run.end].end_time,
      duration: windows[run.end].end_time - windows[run.start].start_time,
      mean_min: Math.min(...windows.slice(run.start, run.end + 1).map(window => window.mean_current)),
      mean_max: Math.max(...windows.slice(run.start, run.end + 1).map(window => window.mean_current)),
      peak_max: Math.max(...windows.slice(run.start, run.end + 1).map(window => window.max_current)),
      valley_min: Math.min(...windows.slice(run.start, run.end + 1).map(window => window.min_current)),
      level,
    };
  });

  const featureText = runSummary.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `level=${formatNumber(run.level)}A, mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');

  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reducedPoints.length,
    selection_reason: mode === 'dense'
      ? '以轮廓素描为目标，平台段强制水平化，并对长片段补充中段锚点'
      : '以轮廓素描为目标，平台段强制水平化，过渡段保留起中终代表点',
    key_points: reducedPoints,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(reducedPoints)}\n\n关键区间关系：\n${describeSegments(reducedPoints)}`,
  };
}

function analyzeWithContourSketch(windows, globals) {
  return buildContourSketchResult('contour_sketch_v1', '轮廓素描压缩 V1', windows, globals, 'base');
}

function analyzeWithContourSketchDense(windows, globals) {
  return buildContourSketchResult('contour_sketch_dense_v1', '轮廓素描压缩 Dense V1', windows, globals, 'dense');
}

function classifyStructuralWindow(index, windows, globals) {
  const window = windows[index];
  const previous = windows[index - 1] || window;
  const next = windows[index + 1] || window;
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const deltaPrev = window.mean_current - previous.mean_current;
  const deltaNext = next.mean_current - window.mean_current;
  const edgeDelta = Math.abs(deltaNext) >= Math.abs(deltaPrev) ? deltaNext : deltaPrev;
  const edgePct = Math.abs(edgeDelta) / fullScale * 100;
  const jumpPct = Math.max(Math.abs(deltaPrev), Math.abs(deltaNext), Math.abs(window.delta_peak || 0)) / fullScale * 100;
  const spanPct = (window.span_current || 0) / fullScale * 100;
  const peakLiftPct = Math.abs((window.max_current || 0) - (window.mean_current || 0)) / fullScale * 100;
  const baselineRatio = window.baseline_ratio || 0;
  const peakRatio = window.peak_ratio || 0;
  const idleLike = baselineRatio <= 1.8 && peakRatio <= 2.2;
  const highLike = window.mean_current >= globals.p90_current * 0.92 || window.max_current >= globals.p95_current * 0.96;
  const stableLike = jumpPct <= 1.2 && spanPct <= 2.6;

  if (stableLike) {
    if (idleLike) return 'plateau_idle';
    if (highLike) return 'plateau_high';
    return 'plateau_work';
  }

  if (edgePct >= 16 && spanPct >= 10) {
    return edgeDelta >= 0 ? 'edge_up' : 'edge_down';
  }

  if (peakLiftPct >= 14 && window.max_current >= globals.p95_current * 0.75) {
    return 'pulse';
  }

  return edgeDelta >= 0 ? 'ramp_up' : 'ramp_down';
}

function buildStructuralRuns(windows, globals) {
  if (!windows.length) return [];
  const runs = [];
  let current = { feature: classifyStructuralWindow(0, windows, globals), start: 0, end: 0 };
  const fullScale = Math.max(globals.full_scale, 0.0001);

  for (let index = 1; index < windows.length; index++) {
    const feature = classifyStructuralWindow(index, windows, globals);
    const previousWindow = windows[index - 1];
    const currentWindow = windows[index];
    const closeEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / fullScale * 100 <= 0.9;
    const samePlateau = feature.startsWith('plateau_') && current.feature.startsWith('plateau_') && closeEnough;
    if (feature === current.feature || samePlateau) {
      current.end = index;
      continue;
    }
    runs.push(current);
    current = { feature, start: index, end: index };
  }

  runs.push(current);
  return runs;
}

function buildStructuralPoint(index, windows, globals, yValue, role) {
  const point = buildKeyPoint(index, windows, globals);
  return {
    ...point,
    raw_mean_current: point.mean_current,
    mean_current: Number(yValue.toFixed(6)),
    structural_role: role,
  };
}

function buildStructuralSyntheticPoint(index, windows, globals, yValue, timeValue, pointIndex, role) {
  const point = buildKeyPoint(index, windows, globals);
  return {
    ...point,
    point_index: pointIndex,
    time: Number(timeValue.toFixed(6)),
    raw_mean_current: point.mean_current,
    mean_current: Number(yValue.toFixed(6)),
    structural_role: role,
  };
}

function summarizeStructuralRun(run, windows) {
  const slice = windows.slice(run.start, run.end + 1);
  return {
    ...run,
    start_time: windows[run.start].start_time,
    end_time: windows[run.end].end_time,
    duration: windows[run.end].end_time - windows[run.start].start_time,
    mean_min: Math.min(...slice.map(item => item.mean_current)),
    mean_max: Math.max(...slice.map(item => item.mean_current)),
    peak_max: Math.max(...slice.map(item => item.max_current)),
    valley_min: Math.min(...slice.map(item => item.min_current)),
  };
}

function structuralRunPoints(run, windows, globals) {
  const points = [];
  const slice = windows.slice(run.start, run.end + 1);
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);

  if (run.feature.startsWith('plateau_')) {
    const levelSource = run.feature === 'plateau_high'
      ? slice.map(item => item.max_current)
      : slice.map(item => item.mean_current);
    const level = median(levelSource);
    points.push(buildStructuralPoint(run.start, windows, globals, level, 'start'));
    if (length >= 5) {
      points.push(buildStructuralPoint(middle, windows, globals, level, 'mid'));
    }
    if (run.end !== run.start) {
      points.push(buildStructuralPoint(run.end, windows, globals, level, 'end'));
    }
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  }

  if (run.feature === 'pulse') {
    let peakIndex = run.start;
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
    }
    points.push(buildStructuralPoint(run.start, windows, globals, windows[run.start].mean_current, 'pulse_start'));
    points.push(buildStructuralPoint(peakIndex, windows, globals, windows[peakIndex].max_current, 'pulse_peak'));
    if (run.end !== run.start) {
      points.push(buildStructuralPoint(run.end, windows, globals, windows[run.end].mean_current, 'pulse_end'));
    }
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  }

  if (run.feature === 'edge_up' || run.feature === 'edge_down') {
    const previous = windows[Math.max(0, run.start - 1)];
    const startWindow = windows[run.start];
    const endWindow = windows[run.end];
    const next = windows[Math.min(windows.length - 1, run.end + 1)];
    const boundaryTime = Number((((startWindow.start_time + endWindow.end_time) / 2)).toFixed(6));

    if (run.feature === 'edge_up') {
      const lowLevel = Math.min(previous.mean_current, startWindow.min_current, endWindow.min_current);
      const highLevel = Math.max(next.mean_current, startWindow.max_current, endWindow.max_current);
      points.push(buildStructuralSyntheticPoint(run.start, windows, globals, lowLevel, boundaryTime, run.start - 0.25, 'edge_low'));
      points.push(buildStructuralSyntheticPoint(run.end, windows, globals, highLevel, boundaryTime, run.end + 0.25, 'edge_high'));
    } else {
      const highLevel = Math.max(previous.mean_current, startWindow.max_current, endWindow.max_current);
      const lowLevel = Math.min(next.mean_current, startWindow.min_current, endWindow.min_current);
      points.push(buildStructuralSyntheticPoint(run.start, windows, globals, highLevel, boundaryTime, run.start - 0.25, 'edge_high'));
      points.push(buildStructuralSyntheticPoint(run.end, windows, globals, lowLevel, boundaryTime, run.end + 0.25, 'edge_low'));
    }

    return points.sort((left, right) => left.point_index - right.point_index);
  }

  points.push(buildStructuralPoint(run.start, windows, globals, windows[run.start].mean_current, 'ramp_start'));
  if (length >= 8) {
    points.push(buildStructuralPoint(middle, windows, globals, windows[middle].mean_current, 'ramp_mid'));
  }
  if (run.end !== run.start) {
    points.push(buildStructuralPoint(run.end, windows, globals, windows[run.end].mean_current, 'ramp_end'));
  }
  return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
}

function buildStructuralProfileResult(algorithmKey, algorithmLabel, windows, globals) {
  const runs = buildStructuralRuns(windows, globals);
  const points = runs.flatMap(run => structuralRunPoints(run, windows, globals));
  const deduped = [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  const reduced = reducePointList(deduped, globals, TARGET_POINT_COUNT);
  const summaries = runs.map(run => summarizeStructuralRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reduced.length,
    selection_reason: '先识别平台/斜坡/脉冲/陡边等结构单元，再按单元最小表达模板生成关键点，最后在预算内裁剪',
    key_points: reduced,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n结构单元序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(reduced)}\n\n关键区间关系：\n${describeSegments(reduced)}`,
  };
}

function analyzeWithStructuralProfile(windows, globals) {
  return buildStructuralProfileResult('structural_profile_v1', '结构轮廓压缩 V1', windows, globals);
}

function detectStructuralEdgeEvents(windows, globals) {
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const rawEvents = [];

  for (let index = 0; index < windows.length - 1; index++) {
    const left = windows[index];
    const right = windows[index + 1];
    const meanJumpPct = Math.abs(right.mean_current - left.mean_current) / fullScale * 100;
    const peakJumpPct = Math.abs(right.max_current - left.max_current) / fullScale * 100;
    const mixedSpanPct = Math.max(left.span_current, right.span_current) / fullScale * 100;
    const strongJump = meanJumpPct >= 12 || peakJumpPct >= 16;
    const mixedWindow = mixedSpanPct >= 8;
    if (!strongJump) continue;

    const type = right.mean_current >= left.mean_current ? 'edge_up' : 'edge_down';
    const boundaryTime = Number((((left.end_time + right.start_time) / 2)).toFixed(6));
    const lowLevel = Math.min(left.min_current, right.min_current, left.mean_current, right.mean_current);
    const highLevel = Math.max(left.max_current, right.max_current, left.mean_current, right.mean_current);
    rawEvents.push({
      type,
      leftIndex: index,
      rightIndex: index + 1,
      boundaryTime,
      lowLevel: mixedWindow ? lowLevel : Math.min(left.mean_current, right.mean_current),
      highLevel: mixedWindow ? highLevel : Math.max(left.mean_current, right.mean_current),
    });
  }

  if (rawEvents.length === 0) return rawEvents;

  const clustered = [];
  let current = { ...rawEvents[0] };
  for (let index = 1; index < rawEvents.length; index++) {
    const next = rawEvents[index];
    const isAdjacent = next.leftIndex <= current.rightIndex + 1;
    if (next.type === current.type && isAdjacent) {
      current = {
        type: current.type,
        leftIndex: current.leftIndex,
        rightIndex: next.rightIndex,
        boundaryTime: Number((((windows[current.leftIndex].end_time + windows[next.rightIndex].start_time) / 2)).toFixed(6)),
        lowLevel: Math.min(current.lowLevel, next.lowLevel),
        highLevel: Math.max(current.highLevel, next.highLevel),
      };
      continue;
    }
    clustered.push(current);
    current = { ...next };
  }
  clustered.push(current);
  return clustered;
}

function buildWindowMeanPrefixSums(windows) {
  const prefix = new Array(windows.length + 1).fill(0);
  for (let index = 0; index < windows.length; index++) {
    prefix[index + 1] = prefix[index] + (windows[index].mean_current || 0);
  }
  return prefix;
}

function averageWindowMean(prefix, startIndex, endIndex) {
  if (endIndex < startIndex) return 0;
  const sum = prefix[endIndex + 1] - prefix[startIndex];
  return sum / Math.max(endIndex - startIndex + 1, 1);
}

function detectStructuralCusumEdgeEvents(windows, globals, radius = 2) {
  const fullScale = Math.max(globals.full_scale, globals.p99_current - globals.baseline_mean, 0.0001);
  if (windows.length < 2) return [];

  const prefix = buildWindowMeanPrefixSums(windows);
  const rawEvents = [];

  for (let splitIndex = 0; splitIndex < windows.length - 1; splitIndex++) {
    const leftStart = Math.max(0, splitIndex - radius + 1);
    const leftEnd = splitIndex;
    const rightStart = splitIndex + 1;
    const rightEnd = Math.min(windows.length - 1, splitIndex + radius);
    const leftCount = leftEnd - leftStart + 1;
    const rightCount = rightEnd - rightStart + 1;
    if (leftCount <= 0 || rightCount <= 0) continue;

    const leftMean = averageWindowMean(prefix, leftStart, leftEnd);
    const rightMean = averageWindowMean(prefix, rightStart, rightEnd);
    const meanJump = rightMean - leftMean;
    const meanJumpPct = Math.abs(meanJump) / fullScale * 100;

    const leftWindow = windows[splitIndex];
    const rightWindow = windows[splitIndex + 1];
    const directJumpPct = Math.abs(rightWindow.mean_current - leftWindow.mean_current) / fullScale * 100;
    const localSpanPct = Math.max(leftWindow.span_current || 0, rightWindow.span_current || 0) / fullScale * 100;
    const cusumScore = Math.sqrt((leftCount * rightCount) / (leftCount + rightCount)) * Math.abs(meanJump);
    const normalizedCusumPct = cusumScore / Math.max(fullScale, 0.0001) * 100;
    const strongJump = normalizedCusumPct >= 10 || (meanJumpPct >= 7.5 && directJumpPct >= 6);
    if (!strongJump) continue;

    const region = windows.slice(leftStart, rightEnd + 1);
    const lowLevel = Math.min(...region.map(window => Math.min(window.min_current, window.mean_current)));
    const highLevel = Math.max(...region.map(window => Math.max(window.max_current, window.mean_current)));
    const boundaryTime = Number((((leftWindow.end_time + rightWindow.start_time) / 2)).toFixed(6));
    rawEvents.push({
      type: meanJump >= 0 ? 'edge_up' : 'edge_down',
      leftIndex: splitIndex,
      rightIndex: splitIndex + 1,
      boundaryTime,
      lowLevel: localSpanPct >= 7 ? lowLevel : Math.min(leftMean, rightMean),
      highLevel: localSpanPct >= 7 ? highLevel : Math.max(leftMean, rightMean),
    });
  }

  if (rawEvents.length === 0) return rawEvents;

  const clustered = [];
  let current = { ...rawEvents[0] };
  for (let index = 1; index < rawEvents.length; index++) {
    const next = rawEvents[index];
    const isAdjacent = next.leftIndex <= current.rightIndex + 1;
    if (next.type === current.type && isAdjacent) {
      current = {
        type: current.type,
        leftIndex: current.leftIndex,
        rightIndex: next.rightIndex,
        boundaryTime: Number((((windows[current.leftIndex].end_time + windows[next.rightIndex].start_time) / 2)).toFixed(6)),
        lowLevel: Math.min(current.lowLevel, next.lowLevel),
        highLevel: Math.max(current.highLevel, next.highLevel),
      };
      continue;
    }
    clustered.push(current);
    current = { ...next };
  }
  clustered.push(current);
  return clustered;
}

function buildStructuralProfileV2RegionRuns(windows, globals, blockedIndices) {
  const runs = [];
  let current = null;
  const fullScale = Math.max(globals.full_scale, 0.0001);

  for (let index = 0; index < windows.length; index++) {
    if (blockedIndices.has(index)) {
      if (current) {
        runs.push(current);
        current = null;
      }
      continue;
    }

    const feature = classifyStructuralWindow(index, windows, globals);
    if (!current) {
      current = { feature, start: index, end: index };
      continue;
    }

    const previousWindow = windows[index - 1];
    const currentWindow = windows[index];
    const closeEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / fullScale * 100 <= 0.9;
    const samePlateau = feature.startsWith('plateau_') && current.feature.startsWith('plateau_') && closeEnough;
    if (feature === current.feature || samePlateau) {
      current.end = index;
    } else {
      runs.push(current);
      current = { feature, start: index, end: index };
    }
  }

  if (current) runs.push(current);
  return runs;
}

function buildStructuralEdgeEventPoints(events, windows, globals) {
  return events.flatMap((event) => {
    const previousWindow = windows[Math.max(0, event.leftIndex - 1)];
    const nextWindow = windows[Math.min(windows.length - 1, event.rightIndex + 1)];
    const lowLevel = Math.min(event.lowLevel, previousWindow.mean_current, nextWindow.mean_current);
    const highLevel = Math.max(event.highLevel, previousWindow.mean_current, nextWindow.mean_current);
    if (event.type === 'edge_up') {
      return [
        buildStructuralSyntheticPoint(event.leftIndex, windows, globals, lowLevel, event.boundaryTime, event.leftIndex + 0.1, 'edge_low'),
        buildStructuralSyntheticPoint(event.rightIndex, windows, globals, highLevel, event.boundaryTime, event.rightIndex + 0.2, 'edge_high'),
      ];
    }

    return [
      buildStructuralSyntheticPoint(event.leftIndex, windows, globals, highLevel, event.boundaryTime, event.leftIndex + 0.1, 'edge_high'),
      buildStructuralSyntheticPoint(event.rightIndex, windows, globals, lowLevel, event.boundaryTime, event.rightIndex + 0.2, 'edge_low'),
    ];
  });
}

function buildStructuralProfileV2Result(algorithmKey, algorithmLabel, windows, globals) {
  const edgeEvents = detectStructuralEdgeEvents(windows, globals);
  const blockedIndices = new Set();
  for (const event of edgeEvents) {
    blockedIndices.add(event.leftIndex);
    blockedIndices.add(event.rightIndex);
  }
  const runs = buildStructuralProfileV2RegionRuns(windows, globals, blockedIndices);
  const regionPoints = runs.flatMap(run => structuralRunPoints(run, windows, globals));
  const edgePoints = buildStructuralEdgeEventPoints(edgeEvents, windows, globals);
  const deduped = [...new Map([...regionPoints, ...edgePoints].map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  const reduced = reducePointList(deduped, globals, TARGET_POINT_COUNT);
  const summaries = runs.map(run => summarizeStructuralRun(run, windows));
  const eventText = edgeEvents.map(event => `- ${formatNumber(event.boundaryTime, 3)}s: ${event.type}, low=${formatNumber(event.lowLevel)}A, high=${formatNumber(event.highLevel)}A`).join('\n');
  const regionText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reduced.length,
    selection_reason: '先检测强跳变边界事件，再对剩余区域做平台/斜坡采样，优先保持近 90 度陡边',
    key_points: reduced,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n边界事件：\n${eventText}\n\n结构区域：\n${regionText}\n\n关键点序列：\n${renderKeyPoints(reduced)}\n\n关键区间关系：\n${describeSegments(reduced)}`,
  };
}

function analyzeWithStructuralProfileV2(windows, globals) {
  return buildStructuralProfileV2Result('structural_profile_v2', '结构轮廓压缩 V2', windows, globals);
}

function buildStructuralCusumResult(algorithmKey, algorithmLabel, windows, globals) {
  const edgeEvents = detectStructuralCusumEdgeEvents(windows, globals);
  const blockedIndices = new Set();
  for (const event of edgeEvents) {
    blockedIndices.add(event.leftIndex);
    blockedIndices.add(event.rightIndex);
  }
  const runs = buildStructuralProfileV2RegionRuns(windows, globals, blockedIndices);
  const regionPoints = runs.flatMap(run => structuralRunPoints(run, windows, globals));
  const edgePoints = buildStructuralEdgeEventPoints(edgeEvents, windows, globals);
  const deduped = [...new Map([...regionPoints, ...edgePoints].map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  const reduced = reducePointList(deduped, globals, TARGET_POINT_COUNT);
  const summaries = runs.map(run => summarizeStructuralRun(run, windows));
  const eventText = edgeEvents.map(event => `- ${formatNumber(event.boundaryTime, 3)}s: ${event.type}, low=${formatNumber(event.lowLevel)}A, high=${formatNumber(event.highLevel)}A`).join('\n');
  const regionText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reduced.length,
    selection_reason: '先用局部 CUSUM 检测候选跳变边界，再对剩余区域做平台/斜坡采样，减少纯阈值边界误判',
    key_points: reduced,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\nCUSUM 边界事件：\n${eventText}\n\n结构区域：\n${regionText}\n\n关键点序列：\n${renderKeyPoints(reduced)}\n\n关键区间关系：\n${describeSegments(reduced)}`,
  };
}

function analyzeWithStructuralCusum(windows, globals) {
  return buildStructuralCusumResult('structural_cusum_v1', '结构轮廓 CUSUM V1', windows, globals);
}

function neighborhoodRange(values, center, radius) {
  const slice = values.slice(Math.max(0, center - radius), Math.min(values.length, center + radius + 1));
  return Math.max(...slice) - Math.min(...slice);
}

function classifyPrimitiveWindow(index, windows, globals) {
  const window = windows[index];
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const meanValues = windows.map(item => item.mean_current);
  const localMeanRange = neighborhoodRange(meanValues, index, 2);
  const leftMean = averageRange(meanValues, index - 2, index - 1);
  const rightMean = averageRange(meanValues, index + 1, index + 2);
  const localSlope = rightMean - leftMean;
  const localSlopePct = Math.abs(localSlope) / fullScale * 100;
  const localRangePct = localMeanRange / fullScale * 100;
  const spanPct = (window.span_current || 0) / fullScale * 100;
  const peakLiftPct = Math.abs((window.max_current || 0) - (window.mean_current || 0)) / fullScale * 100;

  const plateauByShape = localSlopePct <= 0.9 && localRangePct <= 1.2;
  const idleLike = window.baseline_ratio <= 1.8;
  const highLike = window.mean_current >= globals.p90_current * 0.92 || window.max_current >= globals.p95_current * 0.96;
  const workLike = window.mean_current >= globals.p50_current * 0.75 && window.mean_current <= globals.p90_current * 1.05;

  if (plateauByShape && spanPct <= 2.2) {
    if (idleLike) return 'plateau_idle';
    if (highLike) return 'plateau_high';
    if (workLike) return 'plateau_work';
    return 'plateau_mid';
  }

  if (peakLiftPct >= 14 && window.max_current >= globals.p95_current * 0.75) {
    return 'pulse';
  }

  if (spanPct >= 9 && window.max_current >= globals.p75_current * 0.9) {
    return 'volatile';
  }

  return localSlope >= 0 ? 'ramp_up' : 'ramp_down';
}

function buildPrimitiveRuns(windows, globals) {
  if (!windows.length) return [];
  const runs = [];
  let current = { feature: classifyPrimitiveWindow(0, windows, globals), start: 0, end: 0 };
  for (let index = 1; index < windows.length; index++) {
    const feature = classifyPrimitiveWindow(index, windows, globals);
    if (feature === current.feature) {
      current.end = index;
      continue;
    }
    runs.push(current);
    current = { feature, start: index, end: index };
  }
  runs.push(current);
  return runs;
}

function buildPrimitivePoint(index, windows, globals, yValue) {
  const point = buildKeyPoint(index, windows, globals);
  return {
    ...point,
    raw_mean_current: point.mean_current,
    mean_current: Number(yValue.toFixed(6)),
  };
}

function summarizePrimitiveRun(run, windows) {
  const slice = windows.slice(run.start, run.end + 1);
  return {
    ...run,
    start_time: windows[run.start].start_time,
    end_time: windows[run.end].end_time,
    duration: windows[run.end].end_time - windows[run.start].start_time,
    mean_min: Math.min(...slice.map(item => item.mean_current)),
    mean_max: Math.max(...slice.map(item => item.mean_current)),
    peak_max: Math.max(...slice.map(item => item.max_current)),
    valley_min: Math.min(...slice.map(item => item.min_current)),
  };
}

function primitiveRunPoints(run, windows, globals, mode) {
  const points = [];
  const slice = windows.slice(run.start, run.end + 1);
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);

  if (run.feature.startsWith('plateau_')) {
    const usePeak = run.feature === 'plateau_high';
    const level = median(slice.map(item => usePeak ? item.max_current : item.mean_current));
    points.push(buildPrimitivePoint(run.start, windows, globals, level));
    if (length >= 4) {
      points.push(buildPrimitivePoint(middle, windows, globals, level));
    }
    if (mode === 'dense' && length >= 8) {
      const quarter = Math.floor((run.start * 3 + run.end) / 4);
      const threeQuarter = Math.floor((run.start + run.end * 3) / 4);
      points.push(buildPrimitivePoint(quarter, windows, globals, level));
      points.push(buildPrimitivePoint(threeQuarter, windows, globals, level));
    }
    if (run.end !== run.start) {
      points.push(buildPrimitivePoint(run.end, windows, globals, level));
    }
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  }

  if (run.feature === 'pulse' || run.feature === 'volatile') {
    let peakIndex = run.start;
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
    }
    points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
    points.push(buildPrimitivePoint(peakIndex, windows, globals, windows[peakIndex].max_current));
    if (run.end !== run.start) {
      points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
    }
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  }

  const startY = windows[run.start].mean_current;
  const endY = windows[run.end].mean_current;
  points.push(buildPrimitivePoint(run.start, windows, globals, startY));
  if (length >= 5) {
    points.push(buildPrimitivePoint(middle, windows, globals, windows[middle].mean_current));
  }
  if (mode === 'dense' && length >= 9) {
    const quarter = Math.floor((run.start * 3 + run.end) / 4);
    const threeQuarter = Math.floor((run.start + run.end * 3) / 4);
    points.push(buildPrimitivePoint(quarter, windows, globals, windows[quarter].mean_current));
    points.push(buildPrimitivePoint(threeQuarter, windows, globals, windows[threeQuarter].mean_current));
  }
  if (run.end !== run.start) {
    points.push(buildPrimitivePoint(run.end, windows, globals, endY));
  }
  return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
}

function buildPrimitiveSketchResult(algorithmKey, algorithmLabel, windows, globals, mode) {
  const runs = buildPrimitiveRuns(windows, globals);
  const primitivePoints = runs.flatMap(run => primitiveRunPoints(run, windows, globals, mode));
  const points = [...new Map(primitivePoints.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  const summaries = runs.map(run => summarizePrimitiveRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: points.length,
    selection_reason: mode === 'dense'
      ? '按平台/斜坡/脉冲三元原语建模，并对长原语补充中段锚点'
      : '按平台/斜坡/脉冲三元原语建模，直接输出每个原语的最小绘图点',
    key_points: points,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(points)}\n\n关键区间关系：\n${describeSegments(points)}`,
  };
}

function analyzeWithPrimitiveSketch(windows, globals) {
  return buildPrimitiveSketchResult('primitive_sketch_v1', '原语素描压缩 V1', windows, globals, 'base');
}

function analyzeWithPrimitiveSketchDense(windows, globals) {
  return buildPrimitiveSketchResult('primitive_sketch_dense_v1', '原语素描压缩 Dense V1', windows, globals, 'dense');
}

function primitiveFamily(feature) {
  if (feature === 'pulse' || feature === 'volatile') return feature;
  if (feature === 'plateau_idle') return 'idle_band';
  if (feature === 'plateau_high') return 'high_band';
  if (feature === 'plateau_work' || feature === 'plateau_mid') return 'work_band';
  if (feature === 'ramp_up' || feature === 'ramp_down') return 'work_band';
  return feature;
}

function coalescePrimitiveRuns(runs, windows, globals) {
  if (!runs.length) return [];
  const coalesced = [];
  let current = { ...runs[0] };
  const fullScale = Math.max(globals.full_scale, 0.0001);

  const summarizeRange = (start, end) => {
    const slice = windows.slice(start, end + 1);
    return {
      meanMin: Math.min(...slice.map(item => item.mean_current)),
      meanMax: Math.max(...slice.map(item => item.mean_current)),
      peakMax: Math.max(...slice.map(item => item.max_current)),
    };
  };

  for (let index = 1; index < runs.length; index++) {
    const next = runs[index];
    const familyA = primitiveFamily(current.feature);
    const familyB = primitiveFamily(next.feature);
    const mergedSummary = summarizeRange(current.start, next.end);
    const meanBandPct = (mergedSummary.meanMax - mergedSummary.meanMin) / fullScale * 100;
    const bothWorkBand = familyA === 'work_band' && familyB === 'work_band' && mergedSummary.peakMax < globals.p95_current * 0.82;
    const bothIdle = familyA === 'idle_band' && familyB === 'idle_band';
    const bothHigh = familyA === 'high_band' && familyB === 'high_band';

    if (bothIdle || bothHigh || (bothWorkBand && meanBandPct <= 6)) {
      current.end = next.end;
      current.feature = familyA;
      continue;
    }

    coalesced.push({ ...current, feature: familyA });
    current = { ...next };
  }

  coalesced.push({ ...current, feature: primitiveFamily(current.feature) });
  return coalesced;
}

function buildBudgetedRunPoints(run, windows, globals) {
  const slice = windows.slice(run.start, run.end + 1);
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);
  const points = [];

  if (run.feature === 'idle_band') {
    const level = median(slice.map(item => item.mean_current));
    points.push(buildPrimitivePoint(run.start, windows, globals, level));
    if (length >= 12) {
      points.push(buildPrimitivePoint(middle, windows, globals, level));
    }
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, level));
    return points;
  }

  if (run.feature === 'high_band') {
    const level = median(slice.map(item => item.max_current));
    points.push(buildPrimitivePoint(run.start, windows, globals, level));
    points.push(buildPrimitivePoint(middle, windows, globals, level));
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, level));
    return points;
  }

  if (run.feature === 'work_band') {
    const level = median(slice.map(item => item.mean_current));
    points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
    if (length >= 6) {
      points.push(buildPrimitivePoint(middle, windows, globals, level));
    }
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
    return points;
  }

  if (run.feature === 'pulse' || run.feature === 'volatile') {
    let peakIndex = run.start;
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
    }
    points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
    points.push(buildPrimitivePoint(peakIndex, windows, globals, windows[peakIndex].max_current));
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
    return points;
  }

  points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
  if (length >= 8) points.push(buildPrimitivePoint(middle, windows, globals, windows[middle].mean_current));
  if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
  return points;
}

function buildBudgetedPrimitiveSketchResult(algorithmKey, algorithmLabel, windows, globals) {
  const runs = coalescePrimitiveRuns(buildPrimitiveRuns(windows, globals), windows, globals);
  const points = runs.flatMap(run => buildBudgetedRunPoints(run, windows, globals));
  const deduped = [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index);
  const reduced = reducePointList(deduped, globals, TARGET_POINT_COUNT);
  const summaries = runs.map(run => summarizePrimitiveRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reduced.length,
    selection_reason: '先将微原语合并为宏原语，再按宏原语分配绘图点预算，兼顾平台保真与点数控制',
    key_points: reduced,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(reduced)}\n\n关键区间关系：\n${describeSegments(reduced)}`,
  };
}

function analyzeWithPrimitiveBudgetedSketch(windows, globals) {
  return buildBudgetedPrimitiveSketchResult('primitive_budgeted_sketch_v1', '宏原语预算素描 V1', windows, globals);
}

function primitiveTargetY(index, windows, globals) {
  const feature = classifyPrimitiveWindow(index, windows, globals);
  const window = windows[index];
  if (feature === 'plateau_high' || feature === 'pulse' || feature === 'volatile') {
    return window.max_current;
  }
  return window.mean_current;
}

function interpolateY(leftPoint, rightPoint, time) {
  if (rightPoint.time === leftPoint.time) return leftPoint.mean_current;
  const ratio = (time - leftPoint.time) / (rightPoint.time - leftPoint.time);
  return leftPoint.mean_current + (rightPoint.mean_current - leftPoint.mean_current) * ratio;
}

function evaluateContourError(points, windows, globals) {
  const fullScale = Math.max(globals.full_scale, 0.0001);
  let worst = null;
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    const leftPoint = points[pointIndex];
    const rightPoint = points[pointIndex + 1];
    const startIndex = leftPoint.point_index;
    const endIndex = rightPoint.point_index;
    if (endIndex - startIndex <= 1) continue;
    for (let windowIndex = startIndex + 1; windowIndex < endIndex; windowIndex++) {
      const targetY = primitiveTargetY(windowIndex, windows, globals);
      const approxY = interpolateY(leftPoint, rightPoint, windows[windowIndex].start_time);
      const errorPct = Math.abs(targetY - approxY) / fullScale * 100;
      if (!worst || errorPct > worst.errorPct) {
        worst = { windowIndex, errorPct };
      }
    }
  }
  return worst;
}

function refineAdaptivePoints(initialPoints, windows, globals) {
  const pointsByIndex = new Map(initialPoints.map(point => [point.point_index, point]));
  const maxPoints = 140;
  const targetErrorPct = 2.2;

  while (pointsByIndex.size < maxPoints) {
    const points = [...pointsByIndex.values()].sort((left, right) => left.point_index - right.point_index);
    const worst = evaluateContourError(points, windows, globals);
    if (!worst || worst.errorPct <= targetErrorPct) {
      break;
    }
    const y = primitiveTargetY(worst.windowIndex, windows, globals);
    pointsByIndex.set(worst.windowIndex, buildPrimitivePoint(worst.windowIndex, windows, globals, y));
  }

  return [...pointsByIndex.values()].sort((left, right) => left.point_index - right.point_index);
}

function buildAdaptivePrimitiveSketchResult(algorithmKey, algorithmLabel, windows, globals) {
  const runs = coalescePrimitiveRuns(buildPrimitiveRuns(windows, globals), windows, globals);
  const seedPoints = [...new Map(runs.flatMap(run => buildBudgetedRunPoints(run, windows, globals)).map(point => [point.point_index, point])).values()]
    .sort((left, right) => left.point_index - right.point_index);
  const refinedPoints = refineAdaptivePoints(seedPoints, windows, globals);
  const summaries = runs.map(run => summarizePrimitiveRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: refinedPoints.length,
    selection_reason: '先按宏原语生成基础轮廓，再按重建误差自适应加点，直到关键失真降到阈值内',
    key_points: refinedPoints,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(refinedPoints)}\n\n关键区间关系：\n${describeSegments(refinedPoints)}`,
  };
}

function analyzeWithPrimitiveAdaptiveSketch(windows, globals) {
  return buildAdaptivePrimitiveSketchResult('primitive_adaptive_sketch_v1', '宏原语自适应素描 V1', windows, globals);
}

function buildBudgetedRunPointIndices(run) {
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);
  const indices = [run.start];

  if (run.feature === 'idle_band') {
    if (length >= 12) indices.push(middle);
  } else if (run.feature === 'high_band') {
    indices.push(middle);
  } else if (run.feature === 'work_band') {
    if (length >= 6) indices.push(middle);
  } else if (run.feature !== 'pulse' && run.feature !== 'volatile') {
    if (length >= 8) indices.push(middle);
  }

  if (run.end !== run.start) indices.push(run.end);
  return [...new Set(indices)].sort((left, right) => left - right);
}

function buildBudgetedPrimitiveSeedPoints(windows, globals) {
  const runs = coalescePrimitiveRuns(buildPrimitiveRuns(windows, globals), windows, globals);
  const points = runs.flatMap(run => buildBudgetedRunPoints(run, windows, globals));
  return [...new Map(points.map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index);
}

function reverseWindowsForAnalysis(windows) {
  return windows.slice().reverse().map((window, reversedIndex) => ({
    ...window,
    original_index: windows.length - 1 - reversedIndex,
  }));
}

function mapReversePointsToOriginal(reversePoints, reversedWindows, originalWindows, globals) {
  return reversePoints.map((point) => {
    const originalIndex = reversedWindows[point.point_index].original_index;
    return buildPrimitivePoint(originalIndex, originalWindows, globals, point.mean_current);
  });
}

function mergeConsensusPointSets(forwardPoints, reversePoints) {
  const merged = new Map();
  for (const point of [...forwardPoints, ...reversePoints]) {
    const existing = merged.get(point.point_index);
    if (!existing) {
      merged.set(point.point_index, point);
      continue;
    }
    merged.set(point.point_index, {
      ...existing,
      mean_current: Number((((existing.mean_current + point.mean_current) / 2)).toFixed(6)),
    });
  }
  return [...merged.values()].sort((left, right) => left.point_index - right.point_index);
}

function refineConsensusPoints(initialPoints, windows, globals) {
  const pointsByIndex = new Map(initialPoints.map(point => [point.point_index, point]));
  const maxPoints = 120;
  const targetErrorPct = 2.6;

  while (pointsByIndex.size < maxPoints) {
    const points = [...pointsByIndex.values()].sort((left, right) => left.point_index - right.point_index);
    const worst = evaluateContourError(points, windows, globals);
    if (!worst || worst.errorPct <= targetErrorPct) {
      break;
    }
    const y = primitiveTargetY(worst.windowIndex, windows, globals);
    pointsByIndex.set(worst.windowIndex, buildPrimitivePoint(worst.windowIndex, windows, globals, y));
  }

  return [...pointsByIndex.values()].sort((left, right) => left.point_index - right.point_index);
}

function buildBidirectionalIterativeSketchResult(algorithmKey, algorithmLabel, windows, globals) {
  const forwardPoints = buildBudgetedPrimitiveSeedPoints(windows, globals);
  const reversedWindows = reverseWindowsForAnalysis(windows);
  const reverseSeedPoints = buildBudgetedPrimitiveSeedPoints(reversedWindows, globals);
  const reverseMappedPoints = mapReversePointsToOriginal(reverseSeedPoints, reversedWindows, windows, globals);
  const consensusPoints = mergeConsensusPointSets(forwardPoints, reverseMappedPoints);
  const refinedPoints = refineConsensusPoints(consensusPoints, windows, globals);
  const summaries = coalescePrimitiveRuns(buildPrimitiveRuns(windows, globals), windows, globals).map(run => summarizePrimitiveRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: refinedPoints.length,
    selection_reason: '先做正向与反向粗解析，取共识轮廓，再只对高误差区段做局部修正',
    key_points: refinedPoints,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(refinedPoints)}\n\n关键区间关系：\n${describeSegments(refinedPoints)}`,
  };
}

function analyzeWithBidirectionalIterativeSketch(windows, globals) {
  return buildBidirectionalIterativeSketchResult('bidirectional_iterative_sketch_v1', '双向迭代素描 V1', windows, globals);
}

function quantizeLevel(value, minValue, maxValue, binCount) {
  if (maxValue <= minValue) return 0;
  const ratio = (value - minValue) / (maxValue - minValue);
  return Math.max(0, Math.min(binCount - 1, Math.floor(ratio * binCount)));
}

function mergeAdjacentGroups(groups, boundaryTransitions, targetGroupCount) {
  const activeGroupCount = () => groups.filter(group => group.count > 0).length;
  const mergeCost = (left, right) => {
    const occupancy = left.count + right.count;
    const boundary = boundaryTransitions[left.endBin] || 0;
    return (occupancy + 1) / (1 + boundary * 2.5);
  };

  while (groups.length > 1 && activeGroupCount() > targetGroupCount) {
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < groups.length - 1; index++) {
      const cost = mergeCost(groups[index], groups[index + 1]);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }
    const merged = {
      startBin: groups[bestIndex].startBin,
      endBin: groups[bestIndex + 1].endBin,
      count: groups[bestIndex].count + groups[bestIndex + 1].count,
      sum: groups[bestIndex].sum + groups[bestIndex + 1].sum,
    };
    groups.splice(bestIndex, 2, merged);
  }
  return groups;
}

function buildHistogramAbsorption(windows, globals, rawBinCount = 240, roundTargets = [180, 130, 90, 60]) {
  const minValue = globals.min_current;
  const maxValue = globals.max_current;
  const binCounts = Array.from({ length: rawBinCount }, () => 0);
  const binSums = Array.from({ length: rawBinCount }, () => 0);
  const boundaryTransitions = Array.from({ length: rawBinCount - 1 }, () => 0);
  const windowBins = windows.map((window, index) => {
    const sourceValue = Math.abs(window.max_current - window.mean_current) > globals.full_scale * 0.18 ? window.max_current : window.mean_current;
    const bin = quantizeLevel(sourceValue, minValue, maxValue, rawBinCount);
    binCounts[bin] += 1;
    binSums[bin] += sourceValue;
    if (index > 0) {
      const previousBin = quantizeLevel(
        Math.abs(windows[index - 1].max_current - windows[index - 1].mean_current) > globals.full_scale * 0.18 ? windows[index - 1].max_current : windows[index - 1].mean_current,
        minValue,
        maxValue,
        rawBinCount,
      );
      if (Math.abs(previousBin - bin) === 1) {
        boundaryTransitions[Math.min(previousBin, bin)] += 1;
      }
    }
    return bin;
  });

  let groups = Array.from({ length: rawBinCount }, (_, bin) => ({
    startBin: bin,
    endBin: bin,
    count: binCounts[bin],
    sum: binSums[bin],
  }));

  for (const target of roundTargets) {
    groups = mergeAdjacentGroups(groups, boundaryTransitions, target);
  }

  const binToGroupIndex = new Array(rawBinCount).fill(0);
  groups.forEach((group, groupIndex) => {
    for (let bin = group.startBin; bin <= group.endBin; bin++) {
      binToGroupIndex[bin] = groupIndex;
    }
  });

  return {
    groups,
    windowGroupIndices: windowBins.map(bin => binToGroupIndex[bin]),
    representativeLevels: groups.map(group => group.count > 0 ? group.sum / group.count : minValue),
    rawBinCount,
    roundTargets,
  };
}

function buildAbsorptionPoints(windows, globals, absorption) {
  const points = [];
  let runStart = 0;
  for (let index = 1; index <= windows.length; index++) {
    const currentGroup = index < windows.length ? absorption.windowGroupIndices[index] : null;
    const previousGroup = absorption.windowGroupIndices[index - 1];
    if (currentGroup === previousGroup) continue;
    const runEnd = index - 1;
    const groupLevel = absorption.representativeLevels[previousGroup] ?? windows[runStart].mean_current;
    const middle = Math.floor((runStart + runEnd) / 2);
    points.push(buildPrimitivePoint(runStart, windows, globals, groupLevel));
    if (runEnd - runStart >= 5) {
      points.push(buildPrimitivePoint(middle, windows, globals, groupLevel));
    }
    if (runEnd !== runStart) {
      points.push(buildPrimitivePoint(runEnd, windows, globals, groupLevel));
    }
    runStart = index;
  }
  return [...new Map(points.map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index);
}

function buildHistogramAbsorptionResult(algorithmKey, algorithmLabel, windows, globals) {
  const absorption = buildHistogramAbsorption(windows, globals, 240, [180, 130, 90, 60]);
  const points = buildAbsorptionPoints(windows, globals, absorption);
  const featureText = absorption.groups
    .filter(group => group.count > 0)
    .map((group, index) => `- group_${index}: bins ${group.startBin}-${group.endBin}, count=${group.count}, level=${formatNumber(absorption.representativeLevels[index])}A`)
    .join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: points.length,
    selection_reason: '先按最大最小值量化为 210 个电平桶，再自动吸收相邻桶至约 70 组，最后按电平组输出轮廓点',
    key_points: points,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n电平分组摘要：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(points)}\n\n关键区间关系：\n${describeSegments(points)}`,
  };
}

function analyzeWithHistogramAbsorption(windows, globals) {
  return buildHistogramAbsorptionResult('histogram_absorption_v1', '电平桶吸收 V1', windows, globals);
}

function classifyLevelAwareWindow(index, windows, globals, absorption) {
  const window = windows[index];
  const currentGroup = absorption.windowGroupIndices[index];
  const previousGroup = index > 0 ? absorption.windowGroupIndices[index - 1] : currentGroup;
  const nextGroup = index < windows.length - 1 ? absorption.windowGroupIndices[index + 1] : currentGroup;
  const localDelta = nextGroup - previousGroup;
  const fullScale = Math.max(globals.full_scale, 0.0001);
  const spanPct = (window.span_current || 0) / fullScale * 100;
  const peakLiftPct = Math.abs((window.max_current || 0) - (window.mean_current || 0)) / fullScale * 100;
  const level = absorption.representativeLevels[currentGroup] ?? window.mean_current;
  const idleLike = level <= globals.baseline_mean + globals.full_scale * 0.06;
  const highLike = level >= globals.p90_current * 0.92 || window.max_current >= globals.p95_current * 0.95;

  if (Math.abs(localDelta) <= 1 && spanPct <= 3.2) {
    if (idleLike) return 'plateau_idle';
    if (highLike) return 'plateau_high';
    return 'plateau_work';
  }

  if (Math.abs(localDelta) >= 4 && peakLiftPct >= 10) {
    return 'pulse';
  }

  return localDelta >= 0 ? 'ramp_up' : 'ramp_down';
}

function buildLevelAwareRuns(windows, globals, absorption) {
  if (!windows.length) return [];
  const runs = [];
  let current = { feature: classifyLevelAwareWindow(0, windows, globals, absorption), start: 0, end: 0 };
  for (let index = 1; index < windows.length; index++) {
    const feature = classifyLevelAwareWindow(index, windows, globals, absorption);
    if (feature === current.feature) {
      current.end = index;
      continue;
    }
    runs.push(current);
    current = { feature, start: index, end: index };
  }
  runs.push(current);
  return runs;
}

function buildLevelAwarePoints(run, windows, globals, absorption) {
  const points = [];
  const runGroups = absorption.windowGroupIndices.slice(run.start, run.end + 1);
  const length = run.end - run.start + 1;
  const middle = Math.floor((run.start + run.end) / 2);
  const groupMedian = median(runGroups.map(groupIndex => absorption.representativeLevels[groupIndex] ?? windows[run.start].mean_current));

  if (run.feature.startsWith('plateau_')) {
    points.push(buildPrimitivePoint(run.start, windows, globals, groupMedian));
    if (length >= 6) points.push(buildPrimitivePoint(middle, windows, globals, groupMedian));
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, groupMedian));
    return points;
  }

  if (run.feature === 'pulse') {
    let peakIndex = run.start;
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index].max_current > windows[peakIndex].max_current) peakIndex = index;
    }
    points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
    points.push(buildPrimitivePoint(peakIndex, windows, globals, windows[peakIndex].max_current));
    if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
    return points;
  }

  points.push(buildPrimitivePoint(run.start, windows, globals, windows[run.start].mean_current));
  if (length >= 8) points.push(buildPrimitivePoint(middle, windows, globals, windows[middle].mean_current));
  if (run.end !== run.start) points.push(buildPrimitivePoint(run.end, windows, globals, windows[run.end].mean_current));
  return points;
}

function buildLevelAwarePrimitiveResult(algorithmKey, algorithmLabel, windows, globals) {
  const absorption = buildHistogramAbsorption(windows, globals, 240, [200, 160, 120, 90]);
  const runs = coalescePrimitiveRuns(buildLevelAwareRuns(windows, globals, absorption), windows, globals);
  const points = runs.flatMap(run => buildLevelAwarePoints(run, windows, globals, absorption));
  const deduped = [...new Map(points.map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index);
  const reduced = reducePointList(deduped, globals, 72);
  const summaries = runs.map(run => summarizePrimitiveRun(run, windows));
  const featureText = summaries.map(run => (
    `- ${formatNumber(run.start_time, 3)}s -> ${formatNumber(run.end_time, 3)}s: ${run.feature}, ` +
    `mean范围 ${formatNumber(run.mean_min)}A ~ ${formatNumber(run.mean_max)}A, ` +
    `peak_max ${formatNumber(run.peak_max)}A, valley_min ${formatNumber(run.valley_min)}A`
  )).join('\n');
  return {
    algorithm_key: algorithmKey,
    algorithm_label: algorithmLabel,
    threshold_percent: null,
    point_count: reduced.length,
    selection_reason: '先通过 240 桶多轮吸收建立电平层，再在离散电平层上做原语切分与预算压缩',
    key_points: reduced,
    prompt_preview: `${buildSemanticPrompt(globals)}\n\n特征片段序列：\n${featureText}\n\n关键点序列：\n${renderKeyPoints(reduced)}\n\n关键区间关系：\n${describeSegments(reduced)}`,
  };
}

function analyzeWithLevelAwarePrimitive(windows, globals) {
  return buildLevelAwarePrimitiveResult('level_aware_primitive_v1', '电平层原语压缩 V1', windows, globals);
}

function analyzeWithAdaptiveChangeThreshold(windows, globals) {
  const candidates = THRESHOLD_STEPS.map(step => ({
    thresholdPercent: step,
    indices: reduceIndices(selectByThreshold(windows, globals, step, false), windows, globals, 52, step),
  }));
  const selected = fitSelectionCount(candidates);
  return buildAlgorithmResult(
    'adaptive_change_threshold_v1',
    '自适应变化阈值 V1',
    selected.thresholdPercent,
    selected.indices,
    windows,
    globals,
    '按相邻窗口变化幅度阈值递增搜索，选择最接近 40-60 个关键点的结果'
  );
}

function analyzeWithEnvelopeTurningPoints(windows, globals) {
  const candidates = THRESHOLD_STEPS.map(step => ({
    thresholdPercent: step,
    indices: reduceIndices(selectByThreshold(windows, globals, step, true), windows, globals, 52, step),
  }));
  const selected = fitSelectionCount(candidates);
  return buildAlgorithmResult(
    'envelope_turning_points_v1',
    '包络转折点 V1',
    selected.thresholdPercent,
    selected.indices,
    windows,
    globals,
    '在变化阈值基础上额外保留均值/峰值局部极值点，增强启动尖峰与堵转峰值可见性'
  );
}

function analyzeWithEnvelopeTurningPointsV2(windows, globals) {
  const candidates = THRESHOLD_STEPS.map(step => ({
    thresholdPercent: step,
    indices: reduceIndices(selectByThreshold(windows, globals, step, true, true), windows, globals, 52, step),
  }));
  const selected = fitSelectionCount(candidates);
  return buildAlgorithmResult(
    'envelope_turning_points_v2',
    '包络转折点 V2',
    selected.thresholdPercent,
    selected.indices,
    windows,
    globals,
    '在 V1 基础上增加高电流顶部短平台锚点，保留堵转平台起点/峰值/尾端'
  );
}

function analyzeWithEnvelopeTurningPointsV3(windows, globals) {
  const plateauBoundaryAnchors = [...detectPlateauBoundaryAnchors(windows, globals)];
  const candidates = THRESHOLD_STEPS.map(step => {
    const selected = new Set(selectByThreshold(windows, globals, step, true, true));
    for (const index of plateauBoundaryAnchors) {
      selected.add(index);
    }
    return {
      thresholdPercent: step,
      indices: reduceIndices([...selected].sort((left, right) => left - right), windows, globals, 52, step, plateauBoundaryAnchors),
    };
  });
  const selected = fitSelectionCount(candidates);
  return buildAlgorithmResult(
    'envelope_turning_points_v3',
    '包络转折点 V3',
    selected.thresholdPercent,
    selected.indices,
    windows,
    globals,
    '在 V2 基础上把各类平台段的起止边界设为结构锚点，二次裁剪时不可删除，避免平台尾端和下降沿被压成尖峰'
  );
}

function printGlobals(globals) {
  console.log(`点数: ${globals.point_count}`);
  console.log(`时间范围: ${formatNumber(globals.time_start, 6)}s -> ${formatNumber(globals.time_end, 6)}s`);
  console.log(`基线均值: ${formatNumber(globals.baseline_mean, 6)}A`);
  console.log(`基线绝对值: ${formatNumber(globals.baseline_magnitude, 6)}A`);
  console.log(`电流分位数: p50=${formatNumber(globals.p50_current)}A, p75=${formatNumber(globals.p75_current)}A, p90=${formatNumber(globals.p90_current)}A, p95=${formatNumber(globals.p95_current)}A, p99=${formatNumber(globals.p99_current)}A`);
  console.log(`近似全量程: ${formatNumber(globals.full_scale)}A`);
}

function printAlgorithmResult(result) {
  console.log(`${result.algorithm_key}: ${result.algorithm_label}`);
  console.log(`  threshold_percent: ${formatNumber(result.threshold_percent)}%`);
  console.log(`  point_count: ${result.point_count}`);
  console.log(`  selection_reason: ${result.selection_reason}`);
  result.key_points.forEach(point => {
    console.log(
      `  点${point.point_index}: t=${formatNumber(point.time, 3)}s ` +
      `mean=${formatNumber(point.mean_current)}A min=${formatNumber(point.min_current)}A max=${formatNumber(point.max_current)}A ` +
      `peak_ratio=${formatNumber(point.peak_ratio)} change=${formatNumber(point.change_percent)}%`
    );
  });
}

function printPromptPreview(result) {
  printHeader(`LLM 输入预览 - ${result.algorithm_key}`);
  console.log(result.prompt_preview);
}

async function main() {
  const sampleFile = process.argv.find((arg, index) => index >= 2 && arg !== '--suite') || DEFAULT_SAMPLE_FILE;
  console.log('CFA 关键点压缩算法对比');
  console.log('======================');
  console.log(`样本文件: ${sampleFile}`);

  if (!fs.existsSync(sampleFile)) {
    throw new Error(`样本文件不存在: ${sampleFile}`);
  }

  const content = fs.readFileSync(sampleFile, 'utf8');
  const parser = new CsvParseService(null);
  const parsed = parser.parse(content);
  if (!parsed.success) {
    throw new Error(`CSV 解析失败: ${parsed.error || 'unknown error'}`);
  }

  const points = parsed.points
    .map(point => [Number(point[0]), Number(point[1])])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

  if (points.length === 0) {
    throw new Error('无有效点');
  }

  const rawWindows = createWindows(points, WINDOW_SECONDS);
  const globals = deriveGlobals(points, rawWindows);
  const enrichedWindows = enrichWindows(rawWindows, globals);

  printHeader('原始样本摘要');
  console.log(`时间列: ${parsed.time_column}`);
  console.log(`电流列: ${parsed.current_column}`);
  printGlobals(globals);

  printHeader('时间窗预览 (0.1s)');
  const preview = [];
  for (let index = 0; index < enrichedWindows.length; index += 5) {
    const window = enrichedWindows[index];
    if (!window) continue;
    preview.push(
      `${formatNumber(window.start_time, 3)}s mean=${formatNumber(window.mean_current)}A max=${formatNumber(window.max_current)}A change=${formatNumber(Math.max(Math.abs(window.delta_mean), Math.abs(window.delta_peak)) / Math.max(globals.full_scale, 0.0001) * 100)}%`
    );
  }
  console.log(preview.join('\n'));

  const results = [
    analyzeWithAdaptiveChangeThreshold(enrichedWindows, globals),
    analyzeWithEnvelopeTurningPoints(enrichedWindows, globals),
    analyzeWithEnvelopeTurningPointsV2(enrichedWindows, globals),
    analyzeWithEnvelopeTurningPointsV3(enrichedWindows, globals),
    analyzeWithStructuralProfile(enrichedWindows, globals),
    analyzeWithStructuralProfileV2(enrichedWindows, globals),
    analyzeWithStructuralCusum(enrichedWindows, globals),
    analyzeWithStateRunPreserving(enrichedWindows, globals),
    analyzeWithPlateauTrendHybrid(enrichedWindows, globals),
    analyzeWithFeatureSegments(enrichedWindows, globals),
    analyzeWithFeatureSegmentsDense(enrichedWindows, globals),
    analyzeWithContourSketch(enrichedWindows, globals),
    analyzeWithContourSketchDense(enrichedWindows, globals),
    analyzeWithPrimitiveSketch(enrichedWindows, globals),
    analyzeWithPrimitiveSketchDense(enrichedWindows, globals),
    analyzeWithPrimitiveBudgetedSketch(enrichedWindows, globals),
    analyzeWithPrimitiveAdaptiveSketch(enrichedWindows, globals),
    analyzeWithBidirectionalIterativeSketch(enrichedWindows, globals),
    analyzeWithHistogramAbsorption(enrichedWindows, globals),
    analyzeWithLevelAwarePrimitive(enrichedWindows, globals),
  ];

  printHeader('算法摘要');
  for (const result of results) {
    printAlgorithmResult(result);
  }

  for (const result of results) {
    printPromptPreview(result);
  }
}

async function runSuite() {
  for (const file of SAMPLE_SUITE) {
    if (!fs.existsSync(file)) continue;
    console.log(`\n################ ${file} ################`);
    process.argv[2] = file;
    await main();
  }
}

const shouldRunSuite = process.argv.includes('--suite');

(shouldRunSuite ? runSuite() : main()).catch((error) => {
  console.error('\n对比失败:');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
