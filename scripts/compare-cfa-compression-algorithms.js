import fs from 'node:fs';
import CsvParseService from '../apps/current-feature-analyzer/server/services/csv-parse.service.js';

const sampleFile = process.argv[2] || 'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv';

const WINDOW_SECONDS = 0.02;
const TARGET_MIN_POINTS = 40;
const TARGET_MAX_POINTS = 60;
const THRESHOLD_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 9, 12, 15, 18, 22, 26, 30];

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

function reduceIndices(indices, windows, globals, targetCount, thresholdPercent) {
  if (indices.length <= targetCount) {
    return indices;
  }

  const candidates = indices.map(index => buildCandidateInfo(index, windows, globals));
  const anchors = new Set([0, windows.length - 1]);
  const stallPeakThreshold = globals.p95_current / globals.baseline_magnitude * 0.9;
  const mandatory = candidates.filter(candidate => (
    anchors.has(candidate.index)
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

function selectByThreshold(windows, globals, thresholdPercent, includeEnvelopeExtrema) {
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
  ];

  printHeader('算法摘要');
  for (const result of results) {
    printAlgorithmResult(result);
  }

  for (const result of results) {
    printPromptPreview(result);
  }
}

main().catch((error) => {
  console.error('\n对比失败:');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
