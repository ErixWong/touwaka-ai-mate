import type { AppConfig, CompressionAlgorithmKey, CompressionMeta, FileAnalysisResult, SegmentItem } from '../api/current-feature-analyzer'

type RawPoint = [number, number]

type CompressionOptions = {
  absolute_resolution: number
  relative_resolution: number
  merge_gap_ratio: number
  min_transition_points: number
  target_segment_count: number
}

type Globals = {
  min_current: number
  max_current: number
  mean_current: number
  baseline_mean: number
  sample_interval: number
}

type InternalSegment = Omit<SegmentItem, 'segment_index'> & { segment_index?: number }

const DEFAULT_OPTIONS: CompressionOptions = {
  absolute_resolution: 0.03,
  relative_resolution: 0.02,
  merge_gap_ratio: 0.6,
  min_transition_points: 3,
  target_segment_count: 45,
}

const ABS_EPSILON = 0.0001
const BASELINE_SAMPLE_COUNT = 10
const LEGACY_BASELINE_WINDOW_SECONDS = 0.5
const KEY_POINT_WINDOW_SECONDS = 0.02
const KEY_POINT_MIN_SEGMENT_SECONDS = KEY_POINT_WINDOW_SECONDS * 1.25
const KEY_POINT_TARGET_MIN = 40
const KEY_POINT_TARGET_MAX = 60
const KEY_POINT_TARGET_COUNT = 52
const KEY_POINT_THRESHOLD_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 9, 12, 15, 18, 22, 26, 30]
const STRUCTURAL_CUSUM_RADIUS = 2

type CompressionAlgorithmProfile = {
  key: CompressionAlgorithmKey
  label: string
  output_mode: 'segments' | 'key_points'
  baseline_mode: 'adaptive_v2' | 'legacy_v4'
  trend_mode: 'adaptive_v2' | 'legacy_v4'
  strict_duplicate_conflict: boolean
  adaptive_search: boolean
  target_segment_count: number
}

const COMPRESSION_ALGORITHMS: Record<CompressionAlgorithmKey, CompressionAlgorithmProfile> = {
  adaptive_v2: {
    key: 'adaptive_v2',
    label: '自适应 V2（默认）',
    output_mode: 'segments',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: true,
    target_segment_count: 45,
  },
  legacy_v4: {
    key: 'legacy_v4',
    label: '原始 V4',
    output_mode: 'segments',
    baseline_mode: 'legacy_v4',
    trend_mode: 'legacy_v4',
    strict_duplicate_conflict: true,
    adaptive_search: true,
    target_segment_count: 60,
  },
  adaptive_keypoints_v1: {
    key: 'adaptive_keypoints_v1',
    label: '关键点阈值 V1',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  envelope_turning_points_v2: {
    key: 'envelope_turning_points_v2',
    label: '包络转折点 V2',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  envelope_turning_points_v3: {
    key: 'envelope_turning_points_v3',
    label: '包络转折点 V3',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  structural_profile_v1: {
    key: 'structural_profile_v1',
    label: '结构轮廓压缩 V1',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  structural_profile_v2: {
    key: 'structural_profile_v2',
    label: '结构轮廓压缩 V2',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  structural_cusum_v1: {
    key: 'structural_cusum_v1',
    label: '结构轮廓 CUSUM V1',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
  },
  optimal_segmentation_v1: {
    key: 'optimal_segmentation_v1',
    label: '最优分段 V1（实验）',
    output_mode: 'segments',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: 45,
  },
}

function currentMagnitude(value: number | undefined | null) {
  return Math.abs(Number(value) || 0)
}

function baselineMagnitude(globals: Globals) {
  return Math.max(currentMagnitude(globals.baseline_mean), ABS_EPSILON)
}

function ratioToBaseline(value: number | undefined | null, globals: Globals) {
  return currentMagnitude(value) / baselineMagnitude(globals)
}

function resolutionForCurrent(current: number, options: CompressionOptions) {
  return Math.max(options.absolute_resolution, Math.abs(current) * options.relative_resolution)
}

function quantizeCurrent(current: number, resolution: number) {
  if (!Number.isFinite(resolution) || resolution <= 0) return current
  return Math.round(current / resolution) * resolution
}

function pointLineVerticalError(point: RawPoint, start: RawPoint, end: RawPoint) {
  const duration = end[0] - start[0]
  if (duration === 0) {
    return Math.abs(point[1] - start[1])
  }

  const ratio = (point[0] - start[0]) / duration
  const predicted = start[1] + (end[1] - start[1]) * ratio
  return Math.abs(point[1] - predicted)
}

function simplifyPolyline(points: RawPoint[], epsilon: number) {
  if (points.length <= 2) {
    return points.slice()
  }

  const keep = new Array(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!
    let maxDistance = -1
    let splitIndex = -1
    const start = points[startIndex]!
    const end = points[endIndex]!

    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = pointLineVerticalError(points[index]!, start, end)
      if (distance > maxDistance) {
        maxDistance = distance
        splitIndex = index
      }
    }

    if (maxDistance > epsilon && splitIndex !== -1) {
      keep[splitIndex] = true
      stack.push([startIndex, splitIndex])
      stack.push([splitIndex, endIndex])
    }
  }

  const result: RawPoint[] = []
  for (let index = 0; index < points.length; index++) {
    if (keep[index]) {
      result.push(points[index]!)
    }
  }
  return result
}

function calculateLineFitError(points: RawPoint[], startIndex: number, endIndex: number) {
  if (endIndex - startIndex <= 1) return 0
  const start = points[startIndex]
  const end = points[endIndex]
  if (!start || !end) return 0
  const duration = end[0] - start[0]
  if (duration <= 0) return 0
  let maxResidual = 0
  for (let index = startIndex; index <= endIndex; index++) {
    const point = points[index]
    if (!point) continue
    const ratio = (point[0] - start[0]) / duration
    const predicted = start[1] + (end[1] - start[1]) * ratio
    maxResidual = Math.max(maxResidual, Math.abs(point[1] - predicted))
  }
  return maxResidual
}

function isPlateauKind(kind?: string | null) {
  return kind === 'plateau-low' || kind === 'plateau-mid' || kind === 'plateau-high'
}

function isTrendKind(kind?: string | null) {
  return kind === 'rising' || kind === 'rising-fast' || kind === 'falling' || kind === 'falling-fast'
}

function isTrendCandidate(segment: InternalSegment, options: CompressionOptions, globals: Globals, index: number, segments: InternalSegment[]) {
  if (!segment.kind || !isTrendKind(segment.kind)) return false
  if (segment.point_count < Math.max(options.min_transition_points, 2)) return false
  if (Math.abs(segment.slope || 0) < Math.max(options.absolute_resolution * 2, baselineMagnitude(globals) * 0.05)) return false
  const previous = segments[index - 1]
  const next = segments[index + 1]
  const hasDifferentNeighbors = !!(previous && previous.kind !== segment.kind) || !!(next && next.kind !== segment.kind)
  return ratioToBaseline(segment.mean_current, globals) >= 2 && hasDifferentNeighbors
}

function isTrendCandidateLegacy(segment: InternalSegment, options: CompressionOptions, globals: Globals, index: number, segments: InternalSegment[]) {
  if (isTrendKind(segment.kind)) return true
  const tinySegment = segment.point_count <= Math.max(3, options.min_transition_points)
  if (!tinySegment) return false
  const previous = segments[index - 1]
  const next = segments[index + 1]
  const hasDifferentNeighbors = !!(
    previous &&
    next &&
    previous.representative_current !== next.representative_current
  )
  return ratioToBaseline(segment.mean_current, globals) >= 2 && hasDifferentNeighbors
}

function classifySegmentKind(input: {
  point_count: number
  bandwidth: number
  mean_current: number
  slope: number
  line_fit_error: number
  globals: Globals
  options: CompressionOptions
}) {
  const resolution = resolutionForCurrent(input.mean_current, input.options)
  const normalizedBandwidth = input.bandwidth / Math.max(resolution, ABS_EPSILON)
  const normalizedSlope = input.slope / Math.max(currentMagnitude(input.mean_current), baselineMagnitude(input.globals), ABS_EPSILON)
  const normalizedFitError = input.line_fit_error / Math.max(resolution, ABS_EPSILON)
  const currentRatio = ratioToBaseline(input.mean_current, input.globals)

  if (input.point_count <= Math.max(2, input.options.min_transition_points - 1) && currentRatio >= 4 && normalizedBandwidth <= 2.5) {
    return 'transition'
  }
  if (normalizedBandwidth <= 1.25 && normalizedFitError <= 0.8) {
    if (currentRatio <= 1.5) return 'plateau-low'
    if (currentRatio >= 6) return 'plateau-high'
    return 'plateau-mid'
  }
  if (input.point_count <= Math.max(3, input.options.min_transition_points) && currentRatio >= 5) {
    return 'spike'
  }
  if (normalizedSlope >= 8) return 'rising-fast'
  if (normalizedSlope >= 1.2) return 'rising'
  if (normalizedSlope <= -8) return 'falling-fast'
  if (normalizedSlope <= -1.2) return 'falling'
  if (normalizedBandwidth >= 12 && currentRatio >= 4) return 'burst'
  return 'transition'
}

function calculateGlobals(points: RawPoint[]): Globals {
  let minCurrent = points[0]![1]
  let maxCurrent = points[0]![1]
  let totalCurrent = 0
  const headCandidates: RawPoint[] = []

  for (const point of points) {
    if (point[1] < minCurrent) minCurrent = point[1]
    if (point[1] > maxCurrent) maxCurrent = point[1]
    totalCurrent += point[1]
    if (headCandidates.length < BASELINE_SAMPLE_COUNT && Math.abs(point[1]) > ABS_EPSILON) {
      headCandidates.push(point)
    }
  }

  const tailCandidates: RawPoint[] = []
  for (let index = points.length - 1; index >= 0 && tailCandidates.length < BASELINE_SAMPLE_COUNT; index--) {
    const point = points[index]
    if (point && Math.abs(point[1]) > ABS_EPSILON) {
      tailCandidates.push(point)
    }
  }

  const averageCurrent = (samples: RawPoint[]) => {
    if (!samples.length) return null
    const sum = samples.reduce((acc, [, current]) => acc + current, 0)
    return sum / samples.length
  }

  const headBaseline = averageCurrent(headCandidates)
  const tailBaseline = averageCurrent(tailCandidates)

  let baselineMean = 0
  if (headBaseline != null && tailBaseline != null) {
    baselineMean = Math.abs(headBaseline) <= Math.abs(tailBaseline) ? headBaseline : tailBaseline
  } else if (headBaseline != null) {
    baselineMean = headBaseline
  } else if (tailBaseline != null) {
    baselineMean = tailBaseline
  }

  let intervalSum = 0
  let intervalCount = 0
  const sampleUpperBound = Math.min(points.length, 2000)
  for (let index = 1; index < sampleUpperBound; index++) {
    intervalSum += points[index]![0] - points[index - 1]![0]
    intervalCount++
  }

  return {
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number((totalCurrent / points.length).toFixed(6)),
    baseline_mean: Number(baselineMean.toFixed(6)),
    sample_interval: Number((intervalCount > 0 ? intervalSum / intervalCount : 0).toFixed(6)),
  }
}

function calculateGlobalsLegacy(points: RawPoint[]): Globals {
  let minCurrent = points[0]![1]
  let maxCurrent = points[0]![1]
  let totalCurrent = 0

  for (const point of points) {
    if (point[1] < minCurrent) minCurrent = point[1]
    if (point[1] > maxCurrent) maxCurrent = point[1]
    totalCurrent += point[1]
  }

  const firstTime = points[0]![0]
  const windowCandidates = points.filter(point => point[0] - firstTime <= LEGACY_BASELINE_WINDOW_SECONDS)
  const fallbackCandidates = points.slice(0, Math.min(points.length, 400))
  const baselineCandidates = windowCandidates.length > 0 ? windowCandidates : fallbackCandidates
  const baselineMean = baselineCandidates.length > 0
    ? baselineCandidates.reduce((sum, [, current]) => sum + current, 0) / baselineCandidates.length
    : 0

  let intervalSum = 0
  let intervalCount = 0
  const sampleUpperBound = Math.min(points.length, 2000)
  for (let index = 1; index < sampleUpperBound; index++) {
    intervalSum += points[index]![0] - points[index - 1]![0]
    intervalCount++
  }

  return {
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number((totalCurrent / points.length).toFixed(6)),
    baseline_mean: Number(baselineMean.toFixed(6)),
    sample_interval: Number((intervalCount > 0 ? intervalSum / intervalCount : 0).toFixed(6)),
  }
}

function getAlgorithmProfile(algorithmKey?: CompressionAlgorithmKey | null) {
  return COMPRESSION_ALGORITHMS[algorithmKey || 'adaptive_v2'] || COMPRESSION_ALGORITHMS.adaptive_v2
}

function normalizeDuplicateCurrentValue(current: number) {
  return Number(current.toPrecision(12))
}

function createSegment(points: RawPoint[], startIndex: number, endIndex: number, globals: Globals, options: CompressionOptions): InternalSegment {
  const startPoint = points[startIndex]
  const endPoint = points[endIndex]
  if (!startPoint || !endPoint) {
    throw new Error('Invalid segment: points not found')
  }
  const startTime = startPoint[0]
  const endTime = endPoint[0]
  const duration = Math.max(endTime - startTime, 0)
  let minCurrent = startPoint[1]
  let maxCurrent = startPoint[1]
  let totalCurrent = 0
  for (let index = startIndex; index <= endIndex; index++) {
    const point = points[index]
    if (point && point[1] < minCurrent) minCurrent = point[1]
    if (point && point[1] > maxCurrent) maxCurrent = point[1]
    if (point) totalCurrent += point[1]
  }
  const pointCount = endIndex - startIndex + 1
  const meanCurrent = totalCurrent / pointCount
  const resolution = resolutionForCurrent(meanCurrent, options)
  const representativeCurrent = quantizeCurrent(meanCurrent, resolution)
  const slope = duration > 0 ? (endPoint[1] - startPoint[1]) / duration : 0
  const bandwidth = maxCurrent - minCurrent
  const lineFitError = calculateLineFitError(points, startIndex, endIndex)

  return {
    segment_index: -1,
    start_index: startIndex,
    end_index: endIndex,
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(endTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    point_count: pointCount,
    start_current: Number(startPoint[1].toFixed(6)),
    end_current: Number(endPoint[1].toFixed(6)),
    delta_current: Number((endPoint[1] - startPoint[1]).toFixed(6)),
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number(meanCurrent.toFixed(6)),
    representative_current: Number(representativeCurrent.toFixed(6)),
    bandwidth: Number(bandwidth.toFixed(6)),
    baseline_ratio: Number(ratioToBaseline(meanCurrent, globals).toFixed(6)),
    slope: Number(slope.toFixed(6)),
    line_fit_error: Number(lineFitError.toFixed(6)),
    kind: classifySegmentKind({
      point_count: pointCount,
      bandwidth,
      mean_current: meanCurrent,
      slope,
      line_fit_error: lineFitError,
      globals,
      options,
    }),
  }
}

function buildInitialSegments(points: RawPoint[], options: CompressionOptions, globals: Globals) {
  const segments: InternalSegment[] = []
  let startIndex = 0
  let segmentMin = points[0]![1]
  let segmentMax = points[0]![1]
  let sumCurrent = points[0]![1]

  for (let index = 1; index < points.length; index++) {
    const candidate = points[index]!
    const nextMin = Math.min(segmentMin, candidate[1])
    const nextMax = Math.max(segmentMax, candidate[1])
    const nextCount = index - startIndex + 1
    const nextMean = (sumCurrent + candidate[1]) / nextCount
    const allowedDelta = resolutionForCurrent(nextMean, options)

    if (nextMax - nextMin <= allowedDelta * 2) {
      segmentMin = nextMin
      segmentMax = nextMax
      sumCurrent += candidate[1]
      continue
    }

    segments.push(createSegment(points, startIndex, index - 1, globals, options))
    startIndex = index
    segmentMin = candidate[1]
    segmentMax = candidate[1]
    sumCurrent = candidate[1]
  }

  segments.push(createSegment(points, startIndex, points.length - 1, globals, options))
  return segments
}

function summarizeBucket(bucket: InternalSegment[], globals: Globals, options: CompressionOptions): InternalSegment {
  const pointCount = bucket.reduce((sum, item) => sum + (item.point_count || 0), 0)
  const meanCurrent = bucket.reduce((sum, item) => sum + (item.mean_current || 0) * (item.point_count || 0), 0) / Math.max(pointCount, 1)
  let minCurrent = bucket[0]!.min_current || 0
  let maxCurrent = bucket[0]!.max_current || 0
  for (const item of bucket) {
    if ((item.min_current || 0) < minCurrent) minCurrent = item.min_current || 0
    if ((item.max_current || 0) > maxCurrent) maxCurrent = item.max_current || 0
  }
  const startTime = bucket[0]!.start_time || 0
  const endTime = bucket[bucket.length - 1]!.end_time || 0
  const duration = Math.max(endTime - startTime, 0)
  const resolution = resolutionForCurrent(meanCurrent, options)
  const bandwidth = maxCurrent - minCurrent
  const slope = duration > 0 ? ((bucket[bucket.length - 1]!.mean_current || 0) - (bucket[0]!.mean_current || 0)) / duration : 0
  const lineFitError = bucket.reduce((sum, item) => sum + (item.line_fit_error || 0) * (item.point_count || 0), 0) / Math.max(pointCount, 1)
  // 边界电流：取合并前第一个段的 start_current 和最后一个段的 end_current
  const startCurrent = bucket[0]!.start_current ?? bucket[0]!.mean_current ?? 0
  const endCurrent = bucket[bucket.length - 1]!.end_current ?? bucket[bucket.length - 1]!.mean_current ?? 0

  return {
    segment_index: -1,
    start_index: bucket[0]!.start_index,
    end_index: bucket[bucket.length - 1]!.end_index,
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(endTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    point_count: pointCount,
    start_current: Number(startCurrent.toFixed(6)),
    end_current: Number(endCurrent.toFixed(6)),
    delta_current: Number((endCurrent - startCurrent).toFixed(6)),
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number(meanCurrent.toFixed(6)),
    representative_current: Number(quantizeCurrent(meanCurrent, resolution).toFixed(6)),
    bandwidth: Number(bandwidth.toFixed(6)),
    baseline_ratio: Number(ratioToBaseline(meanCurrent, globals).toFixed(6)),
    slope: Number(slope.toFixed(6)),
    line_fit_error: Number(lineFitError.toFixed(6)),
    kind: classifySegmentKind({
      point_count: pointCount,
      bandwidth,
      mean_current: meanCurrent,
      slope,
      line_fit_error: lineFitError,
      globals,
      options,
    }),
  }
}

function canMergeBucket(left: InternalSegment, right: InternalSegment, options: CompressionOptions) {
  const leftResolution = resolutionForCurrent(left.mean_current || 0, options)
  const rightResolution = resolutionForCurrent(right.mean_current || 0, options)
  const allowedGap = Math.max(leftResolution, rightResolution) * (1 + options.merge_gap_ratio)
  const levelGap = Math.abs((left.representative_current || 0) - (right.representative_current || 0))
  if (left.kind !== right.kind && !(isPlateauKind(left.kind) && isPlateauKind(right.kind))) {
    return false
  }
  return levelGap <= allowedGap
}

function mergeShortInteriorSegments(segments: InternalSegment[], options: CompressionOptions, globals: Globals) {
  if (segments.length <= 2) return segments
  const result: InternalSegment[] = []
  let index = 0
  while (index < segments.length) {
    const current = segments[index]!
    const previous = result[result.length - 1]
    const next = segments[index + 1]
    const isShort = (current.point_count || 0) < options.min_transition_points
    if (previous && next && isShort && isPlateauKind(previous.kind) && isPlateauKind(next.kind)) {
      const bridgeGap = Math.abs((previous.representative_current || 0) - (next.representative_current || 0))
      const allowedBridge = Math.max(
        resolutionForCurrent(previous.mean_current || 0, options),
        resolutionForCurrent(next.mean_current || 0, options),
        resolutionForCurrent(current.mean_current || 0, options)
      ) * 2.5
      if (bridgeGap <= allowedBridge) {
        result[result.length - 1] = summarizeBucket([previous, current, next], globals, options)
        index += 3
        continue
      }
    }
    result.push(current)
    index++
  }
  return result
}

function mergeTrendRuns(segments: InternalSegment[], options: CompressionOptions, globals: Globals, profile: CompressionAlgorithmProfile) {
  if (segments.length <= 2) return segments
  const merged: InternalSegment[] = []
  let index = 0
  while (index < segments.length) {
    const current = segments[index]!
    const currentIsTrendCandidate = profile.trend_mode === 'legacy_v4'
      ? isTrendCandidateLegacy(current, options, globals, index, segments)
      : isTrendCandidate(current, options, globals, index, segments)
    if (!currentIsTrendCandidate) {
      merged.push(current)
      index++
      continue
    }

    const bucket: InternalSegment[] = [current]
    let nextIndex = index + 1
    let direction = 0
    while (nextIndex < segments.length) {
      const candidate = segments[nextIndex]!
      const candidateIsTrendCandidate = profile.trend_mode === 'legacy_v4'
        ? isTrendCandidateLegacy(candidate, options, globals, nextIndex, segments)
        : isTrendCandidate(candidate, options, globals, nextIndex, segments)
      if (!candidateIsTrendCandidate) {
        break
      }
      const delta = (candidate.representative_current || 0) - (bucket[bucket.length - 1]!.representative_current || 0)
      const candidateDirection = Math.sign(delta)
      if (candidateDirection === 0) break
      if (direction === 0) direction = candidateDirection
      if (candidateDirection !== direction) break

      const allowedGap = Math.max(
        resolutionForCurrent(candidate.mean_current || 0, options),
        resolutionForCurrent(bucket[bucket.length - 1]!.mean_current || 0, options)
      ) * 12
      if (Math.abs(delta) > allowedGap) break
      bucket.push(candidate)
      nextIndex++
    }

    if (bucket.length > 1 && direction !== 0) {
      const combined = summarizeBucket(bucket, globals, options)
      combined.kind = direction > 0 ? 'rising' : 'falling'
      if (Math.abs(combined.slope || 0) / Math.max(currentMagnitude(combined.mean_current), baselineMagnitude(globals), ABS_EPSILON) >= 8) {
        combined.kind = direction > 0 ? 'rising-fast' : 'falling-fast'
      }
      merged.push(combined)
      index = nextIndex
    } else {
      merged.push(current)
      index++
    }
  }
  return merged
}

function mergeSegments(initialSegments: InternalSegment[], options: CompressionOptions, globals: Globals, profile: CompressionAlgorithmProfile) {
  if (initialSegments.length <= 1) {
    return initialSegments.map((segment, index) => ({ ...segment, segment_index: index }))
  }
  const merged: InternalSegment[] = []
  let bucket: InternalSegment[] = [initialSegments[0]!]
  for (let index = 1; index < initialSegments.length; index++) {
    const candidate = initialSegments[index]!
    const bucketSummary = summarizeBucket(bucket, globals, options)
    if (canMergeBucket(bucketSummary, candidate, options)) {
      bucket.push(candidate)
    } else {
      merged.push(summarizeBucket(bucket, globals, options))
      bucket = [candidate]
    }
  }
  merged.push(summarizeBucket(bucket, globals, options))
  const smoothed = mergeShortInteriorSegments(merged, options, globals)
  const trendMerged = mergeTrendRuns(smoothed, options, globals, profile)
  return trendMerged.map((segment, index) => ({ ...segment, segment_index: index }))
}

function samplePointsForVisualization(points: RawPoint[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points
  }
  const sampled = [points[0]!]
  const step = Math.ceil((points.length - 2) / Math.max(maxPoints - 2, 1))
  for (let index = step; index < points.length - 1; index += step) {
    sampled.push(points[index]!)
  }
  sampled.push(points[points.length - 1]!)
  return sampled
}

function buildPolylinePoints(segment: InternalSegment, points: RawPoint[], startIndex: number, endIndex: number, globals: Globals, options: CompressionOptions) {
  if (isPlateauKind(segment.kind)) {
    return [
      [segment.start_time || 0, segment.representative_current || 0],
      [segment.end_time || 0, segment.representative_current || 0],
    ]
  }

  const segmentPoints = points.slice(startIndex, endIndex + 1)
  const sampled = samplePointsForVisualization(segmentPoints, 1200)
  const epsilon = Math.max(resolutionForCurrent(segment.mean_current || 0, options), baselineMagnitude(globals) * 0.01)
  const simplified = simplifyPolyline(sampled, epsilon)
  return simplified.map(point => [Number(point[0].toFixed(6)), Number(point[1].toFixed(6))])
}

function attachPolylinePoints(segments: InternalSegment[], points: RawPoint[], globals: Globals, options: CompressionOptions) {
  return segments.map(segment => {
    const startIndex = segment.start_index || 0
    const endIndex = segment.end_index || 0
    const polylinePoints = buildPolylinePoints(segment, points, startIndex, endIndex, globals, options)
    return {
      ...segment,
      polyline_points: polylinePoints,
      polyline_point_count: polylinePoints.length,
    }
  })
}

function extractEvents(segments: InternalSegment[]) {
  const events: Array<Record<string, unknown>> = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (segment.kind === 'spike' || segment.kind === 'burst') {
      events.push({ type: segment.kind, time: segment.start_time, segment_index: index })
    }
  }
  return events
}

type KeyPointWindow = {
  index: number
  start_time: number
  end_time: number
  duration: number
  point_count: number
  mean_current: number
  min_current: number
  max_current: number
  span_current: number
  baseline_ratio?: number
  peak_ratio?: number
  delta_mean?: number
  delta_peak?: number
}

type KeyPointItem = {
  point_index: number
  time: number
  mean_current: number
  min_current: number
  max_current: number
  span_current: number
  baseline_ratio: number
  peak_ratio: number
  delta_left: number
  delta_right: number
  change_percent: number
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(length - 1, index))
}

function quantile(sortedValues: number[], ratio: number) {
  if (!sortedValues.length) return 0
  return sortedValues[clampIndex(Math.floor((sortedValues.length - 1) * ratio), sortedValues.length)]!
}

function createKeyPointWindows(points: RawPoint[], windowSeconds: number) {
  if (!points.length) return [] as KeyPointWindow[]
  const windows: KeyPointWindow[] = []
  let bucket: number[] = []
  let bucketStart = points[0]![0]
  let bucketEnd = bucketStart + windowSeconds

  for (const point of points) {
    const [time, current] = point
    while (time >= bucketEnd) {
      if (bucket.length > 0) {
        windows.push(summarizeKeyPointWindow(bucket, bucketStart, bucketEnd, windows.length))
      }
      bucket = []
      bucketStart = bucketEnd
      bucketEnd = bucketStart + windowSeconds
    }
    bucket.push(current)
  }

  if (bucket.length > 0) {
    windows.push(summarizeKeyPointWindow(bucket, bucketStart, bucketEnd, windows.length))
  }

  return windows
}

function summarizeKeyPointWindow(currents: number[], startTime: number, endTime: number, index: number): KeyPointWindow {
  const sorted = currents.slice().sort((left, right) => left - right)
  const sum = currents.reduce((acc, value) => acc + value, 0)
  const mean = sum / currents.length
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  return {
    index,
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(Math.min(endTime, startTime + KEY_POINT_WINDOW_SECONDS).toFixed(6)),
    duration: Number((Math.min(endTime, startTime + KEY_POINT_WINDOW_SECONDS) - startTime).toFixed(6)),
    point_count: currents.length,
    mean_current: Number(mean.toFixed(6)),
    min_current: Number(min.toFixed(6)),
    max_current: Number(max.toFixed(6)),
    span_current: Number((max - min).toFixed(6)),
  }
}

function enrichKeyPointWindows(windows: KeyPointWindow[], globals: Globals) {
  return windows.map((window, index) => {
    const previous = windows[index - 1] || null
    const next = windows[index + 1] || null
    const deltaMean = previous ? window.mean_current - previous.mean_current : 0
    const deltaPeak = previous ? window.max_current - previous.max_current : 0
    const baselineRatio = ratioToBaseline(window.mean_current, globals)
    const peakRatio = ratioToBaseline(window.max_current, globals)
    return {
      ...window,
      baseline_ratio: Number(baselineRatio.toFixed(6)),
      peak_ratio: Number(peakRatio.toFixed(6)),
      delta_mean: Number(deltaMean.toFixed(6)),
      delta_peak: Number(deltaPeak.toFixed(6)),
      delta_next: Number(((next ? next.mean_current : window.mean_current) - window.mean_current).toFixed(6)),
    }
  })
}

function localExtremaIndices(values: number[]) {
  const indices = new Set<number>()
  for (let index = 1; index < values.length - 1; index++) {
    const previous = values[index - 1]!
    const current = values[index]!
    const next = values[index + 1]!
    if ((current >= previous && current >= next) || (current <= previous && current <= next)) {
      indices.add(index)
    }
  }
  return indices
}

function computeExtremaProminence(values: number[], index: number) {
  if (index <= 0 || index >= values.length - 1) return 0
  const current = values[index]!
  const previous = values[index - 1]!
  const next = values[index + 1]!
  return Math.max(Math.abs(current - previous), Math.abs(current - next))
}

function buildKeyPoint(index: number, windows: KeyPointWindow[], globals: Globals, fullScale: number): KeyPointItem {
  const window = windows[index]!
  const previous = windows[index - 1] || window
  const next = windows[index + 1] || window
  const deltaLeft = window.mean_current - previous.mean_current
  const deltaRight = next.mean_current - window.mean_current
  const changePercent = Math.max(Math.abs(deltaLeft), Math.abs(deltaRight), Math.abs(window.delta_peak || 0)) / Math.max(fullScale, ABS_EPSILON) * 100
  return {
    point_index: index,
    time: Number(window.start_time.toFixed(6)),
    mean_current: window.mean_current,
    min_current: window.min_current,
    max_current: window.max_current,
    span_current: window.span_current,
    baseline_ratio: Number(window.baseline_ratio || 0),
    peak_ratio: Number(window.peak_ratio || 0),
    delta_left: Number(deltaLeft.toFixed(6)),
    delta_right: Number(deltaRight.toFixed(6)),
    change_percent: Number(changePercent.toFixed(3)),
  }
}

function detectHighPlateauAnchors(windows: KeyPointWindow[], globals: Globals) {
  if (!windows.length) return new Set<number>()
  const anchors = new Set<number>()
  const maxPeak = Math.max(...windows.map(window => window.max_current))
  const highPeakThreshold = Math.max(globals.max_current * 0.94, maxPeak * 0.94)
  const highMeanThreshold = globals.max_current * 0.82
  let runStart = -1

  const flushRun = (runEnd: number) => {
    if (runStart === -1 || runEnd < runStart) return
    const runLength = runEnd - runStart + 1
    if (runLength < 2) {
      runStart = -1
      return
    }
    let peakIndex = runStart
    for (let index = runStart + 1; index <= runEnd; index++) {
      if (windows[index]!.max_current > windows[peakIndex]!.max_current) {
        peakIndex = index
      }
    }
    anchors.add(runStart)
    anchors.add(peakIndex)
    anchors.add(runEnd)
    if (runStart + 1 <= runEnd) anchors.add(runStart + 1)
    if (runEnd - 1 >= runStart) anchors.add(runEnd - 1)
    runStart = -1
  }

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!
    const inHighPlateau = window.max_current >= highPeakThreshold && window.mean_current >= highMeanThreshold
    if (inHighPlateau) {
      if (runStart === -1) runStart = index
      continue
    }
    if (runStart !== -1) {
      flushRun(index - 1)
    }
  }
  flushRun(windows.length - 1)
  return anchors
}

function classifyKeyPointWindowState(window: KeyPointWindow, globals: Globals) {
  const baselineRatio = window.baseline_ratio || 0
  const peakRatio = window.peak_ratio || 0
  const deltaMean = window.delta_mean || 0
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const slopePercent = Math.abs(deltaMean) / fullScale * 100

  if (baselineRatio <= 1.6 && peakRatio <= 2) return 'idle_plateau'
  if (peakRatio >= Math.max(globals.max_current / baselineMagnitude(globals) * 0.92, 18)
    && baselineRatio >= 0.8 * (globals.max_current / baselineMagnitude(globals) * 0.5)) {
    return 'high_plateau'
  }
  if (slopePercent >= 3) {
    return deltaMean >= 0 ? 'ramp_up' : 'ramp_down'
  }
  if (baselineRatio >= 5.5) return 'work_plateau'
  if (baselineRatio >= 2.2) return 'mid_plateau'
  return 'transition'
}

function buildKeyPointStateRuns(windows: KeyPointWindow[], globals: Globals) {
  if (!windows.length) return [] as Array<{ state: string; start: number; end: number }>
  const runs: Array<{ state: string; start: number; end: number }> = []
  let currentRun = {
    state: classifyKeyPointWindowState(windows[0]!, globals),
    start: 0,
    end: 0,
  }
  for (let index = 1; index < windows.length; index++) {
    const state = classifyKeyPointWindowState(windows[index]!, globals)
    const previousWindow = windows[index - 1]!
    const currentWindow = windows[index]!
    const smoothEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / Math.max(globals.max_current - globals.min_current, ABS_EPSILON) * 100 < 1.8
    if (state === currentRun.state || (smoothEnough && state.includes('plateau') && currentRun.state.includes('plateau'))) {
      currentRun.end = index
      continue
    }
    runs.push(currentRun)
    currentRun = { state, start: index, end: index }
  }
  runs.push(currentRun)
  return runs
}

function detectPlateauBoundaryAnchors(windows: KeyPointWindow[], globals: Globals) {
  const runs = buildKeyPointStateRuns(windows, globals)
  const anchors = new Set<number>()
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)

  const isSteepBoundary = (leftIndex: number, rightIndex: number) => {
    if (leftIndex < 0 || rightIndex >= windows.length) return false
    const left = windows[leftIndex]!
    const right = windows[rightIndex]!
    const meanJumpPercent = Math.abs(right.mean_current - left.mean_current) / fullScale * 100
    const peakJumpPercent = Math.abs(right.max_current - left.max_current) / fullScale * 100
    const mixedWindowPercent = Math.max(left.span_current, right.span_current) / fullScale * 100
    return meanJumpPercent >= 8 || peakJumpPercent >= 12 || mixedWindowPercent >= 18
  }

  for (const run of runs) {
    const isPlateau = run.state === 'idle_plateau'
      || run.state === 'mid_plateau'
      || run.state === 'work_plateau'
      || run.state === 'high_plateau'
    const length = run.end - run.start + 1
    if (!isPlateau || length < 2) continue
    anchors.add(run.start)
    anchors.add(run.end)
    if (length >= 5) anchors.add(Math.floor((run.start + run.end) / 2))
    if (run.start - 1 >= 0 && !isSteepBoundary(run.start - 1, run.start)) anchors.add(run.start - 1)
    if (run.end + 1 < windows.length && !isSteepBoundary(run.end, run.end + 1)) anchors.add(run.end + 1)
  }
  return anchors
}

function selectKeyPointIndices(windows: KeyPointWindow[], globals: Globals, thresholdPercent: number, includeEnvelopeExtrema: boolean, includeHighPlateauAnchors = false) {
  const selected = new Set<number>([0, windows.length - 1])
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const meanValues = windows.map(window => window.mean_current)
  const peakValues = windows.map(window => window.max_current)
  const meanExtrema = localExtremaIndices(meanValues)
  const peakExtrema = localExtremaIndices(peakValues)
  const extremaThreshold = Math.max(0.6, thresholdPercent * 0.35)

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!
    const deltaScore = Math.max(Math.abs(window.delta_mean || 0), Math.abs(window.delta_peak || 0)) / fullScale * 100
    if (deltaScore >= thresholdPercent) {
      selected.add(index)
    }
  }

  for (const index of meanExtrema) {
    const prominencePercent = computeExtremaProminence(meanValues, index) / fullScale * 100
    if (prominencePercent >= extremaThreshold) {
      selected.add(index)
    }
  }

  if (includeEnvelopeExtrema) {
    for (const index of peakExtrema) {
      const prominencePercent = computeExtremaProminence(peakValues, index) / fullScale * 100
      if (prominencePercent >= extremaThreshold) {
        selected.add(index)
      }
    }
  }

  if (includeHighPlateauAnchors) {
    const plateauAnchors = detectHighPlateauAnchors(windows, globals)
    for (const index of plateauAnchors) {
      selected.add(index)
    }
  }

  return [...selected].sort((left, right) => left - right)
}

function reduceKeyPointIndices(indices: number[], windows: KeyPointWindow[], globals: Globals, targetCount: number, thresholdPercent: number, mandatoryIndices: number[] = []) {
  if (indices.length <= targetCount) {
    return indices
  }

  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const meanValues = windows.map(window => window.mean_current)
  const peakValues = windows.map(window => window.max_current)
  const candidates = indices.map((index) => {
    const point = buildKeyPoint(index, windows, globals, fullScale)
    const meanProminence = computeExtremaProminence(meanValues, index) / fullScale * 100
    const peakProminence = computeExtremaProminence(peakValues, index) / fullScale * 100
    const importance = point.change_percent * 4
      + Math.max(point.peak_ratio - 1, 0) * 0.6
      + Math.max(point.baseline_ratio - 1, 0) * 0.25
      + meanProminence * 1.5
      + peakProminence * 1.75
    return { index, point, importance }
  })

  const anchors = new Set([0, windows.length - 1])
  const mandatorySet = new Set(mandatoryIndices)
  const stallPeakThreshold = globals.max_current / baselineMagnitude(globals) * 0.85
  const keep = new Set<number>(
    candidates
      .filter(candidate => anchors.has(candidate.index) || mandatorySet.has(candidate.index) || candidate.point.change_percent >= Math.max(10, thresholdPercent * 1.5) || candidate.point.peak_ratio >= stallPeakThreshold)
      .map(candidate => candidate.index)
  )

  const bucketCount = Math.min(12, targetCount)
  const bucketSize = Math.max(1, Math.ceil(windows.length / bucketCount))
  for (let bucketIndex = 0; bucketIndex < bucketCount && keep.size < targetCount; bucketIndex++) {
    const bucketStart = bucketIndex * bucketSize
    const bucketEnd = Math.min(windows.length, bucketStart + bucketSize)
    const bucketCandidates = candidates
      .filter(candidate => candidate.index >= bucketStart && candidate.index < bucketEnd && !keep.has(candidate.index))
      .sort((left, right) => right.importance - left.importance)
    if (bucketCandidates.length > 0) {
      keep.add(bucketCandidates[0]!.index)
    }
  }

  const sortedByImportance = candidates
    .filter(candidate => !keep.has(candidate.index))
    .sort((left, right) => right.importance - left.importance)
  for (const candidate of sortedByImportance) {
    if (keep.size >= targetCount) break
    keep.add(candidate.index)
  }

  return [...keep].sort((left, right) => left - right)
}

function fitKeyPointSelection(candidates: Array<{ thresholdPercent: number; indices: number[] }>) {
  let preferred = candidates[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const count = candidate.indices.length
    const targetMid = (KEY_POINT_TARGET_MIN + KEY_POINT_TARGET_MAX) / 2
    const distance = count >= KEY_POINT_TARGET_MIN && count <= KEY_POINT_TARGET_MAX
      ? Math.abs(count - targetMid)
      : Math.min(Math.abs(count - KEY_POINT_TARGET_MIN), Math.abs(count - KEY_POINT_TARGET_MAX)) + 100
    if (distance < bestDistance) {
      preferred = candidate
      bestDistance = distance
    }
  }
  return preferred
}

function classifyKeyPointSegmentKind(startPoint: KeyPointItem, endPoint: KeyPointItem) {
  const delta = endPoint.mean_current - startPoint.mean_current
  if (Math.abs(delta) <= 0.25) {
    if (Math.max(startPoint.baseline_ratio, endPoint.baseline_ratio) <= 1.5) return 'plateau-low'
    if (Math.max(startPoint.peak_ratio, endPoint.peak_ratio) >= 24) return 'plateau-high'
    return 'plateau-mid'
  }
  if (delta > 0) {
    return Math.max(startPoint.peak_ratio, endPoint.peak_ratio) >= 20 ? 'rising-fast' : 'rising'
  }
  return Math.max(startPoint.peak_ratio, endPoint.peak_ratio) >= 20 ? 'falling-fast' : 'falling'
}

function normalizeKeyPointsForSegments(keyPoints: KeyPointItem[]) {
  if (keyPoints.length <= 1) return keyPoints.slice()

  const sorted = keyPoints.slice().sort((left, right) => {
    if (Math.abs(left.time - right.time) > 0.000001) return left.time - right.time
    return left.point_index - right.point_index
  })

  const normalized: KeyPointItem[] = []
  let group: KeyPointItem[] = []

  const flush = () => {
    if (group.length === 0) return
    const ordered = group.slice().sort((left, right) => left.point_index - right.point_index)
    const first = ordered[0]!
    const last = ordered[ordered.length - 1]!
    if (ordered.length === 1 || Math.abs(last.mean_current - first.mean_current) <= 0.05) {
      normalized.push(first)
    } else {
      normalized.push(first)
      if (last !== first) normalized.push(last)
    }
    group = []
  }

  for (const point of sorted) {
    if (group.length === 0) {
      group.push(point)
      continue
    }

    if (Math.abs(point.time - group[0]!.time) <= 0.000001) {
      group.push(point)
      continue
    }

    flush()
    group.push(point)
  }
  flush()

  const deduped: KeyPointItem[] = []
  for (const point of normalized) {
    const previous = deduped[deduped.length - 1]
    if (!previous) {
      deduped.push(point)
      continue
    }

    const sameTime = Math.abs(point.time - previous.time) <= 0.000001
    const sameLevel = Math.abs(point.mean_current - previous.mean_current) <= 0.05
    if (sameTime && sameLevel) {
      continue
    }

    deduped.push(point)
  }

  return deduped
}

function buildKeyPointSegments(keyPoints: KeyPointItem[]) {
  const normalizedPoints = normalizeKeyPointsForSegments(keyPoints)
  if (normalizedPoints.length < 2) return [] as SegmentItem[]
  const segments: SegmentItem[] = []
  for (let index = 0; index < normalizedPoints.length - 1; index++) {
    const point = normalizedPoints[index]!
    const nextPoint = normalizedPoints[index + 1]!
    const rawDuration = nextPoint.time - point.time
    if (rawDuration <= 0.000001) {
      continue
    }

    const duration = Math.max(rawDuration, 0)
    const meanCurrent = Number((((point.mean_current + nextPoint.mean_current) / 2)).toFixed(6))
    segments.push({
      segment_index: segments.length,
      start_time: point.time,
      end_time: nextPoint.time,
      duration: Number(duration.toFixed(6)),
      point_count: Math.max(2, Math.round(Math.abs(nextPoint.point_index - point.point_index)) + 1),
      start_current: point.mean_current,
      end_current: nextPoint.mean_current,
      delta_current: Number((nextPoint.mean_current - point.mean_current).toFixed(6)),
      min_current: Number(Math.min(point.min_current, nextPoint.min_current).toFixed(6)),
      max_current: Number(Math.max(point.max_current, nextPoint.max_current).toFixed(6)),
      mean_current: meanCurrent,
      representative_current: meanCurrent,
      bandwidth: Number((Math.max(point.max_current, nextPoint.max_current) - Math.min(point.min_current, nextPoint.min_current)).toFixed(6)),
      baseline_ratio: Number((((point.baseline_ratio + nextPoint.baseline_ratio) / 2)).toFixed(6)),
      slope: duration > 0 ? Number(((nextPoint.mean_current - point.mean_current) / duration).toFixed(6)) : 0,
      line_fit_error: 0,
      kind: classifyKeyPointSegmentKind(point, nextPoint),
      polyline_points: [
        [point.time, point.mean_current],
        [nextPoint.time, nextPoint.mean_current],
      ],
      polyline_point_count: 2,
    })
  }
  return mergeTinyKeyPointSegments(segments, KEY_POINT_MIN_SEGMENT_SECONDS)
}

function getSegmentTrendFamily(segment: SegmentItem) {
  const kind = segment.kind || ''
  if (kind === 'rising' || kind === 'rising-fast') return 'rising'
  if (kind === 'falling' || kind === 'falling-fast') return 'falling'
  if (kind.startsWith('plateau')) return 'plateau'
  return 'other'
}

function mergeSegmentBucket(bucket: SegmentItem[]) {
  const first = bucket[0]!
  const last = bucket[bucket.length - 1]!
  const duration = Math.max((last.end_time || 0) - (first.start_time || 0), 0)
  const totalPointCount = bucket.reduce((sum, segment) => sum + Math.max(segment.point_count || 0, 1), 0)
  const weightedMeanCurrent = bucket.reduce((sum, segment) => sum + (segment.mean_current || 0) * Math.max(segment.point_count || 0, 1), 0) / Math.max(totalPointCount, 1)
  const weightedBaselineRatio = bucket.reduce((sum, segment) => sum + (segment.baseline_ratio || 0) * Math.max(segment.point_count || 0, 1), 0) / Math.max(totalPointCount, 1)
  const minCurrent = Math.min(...bucket.map(segment => segment.min_current ?? segment.start_current ?? segment.mean_current ?? 0))
  const maxCurrent = Math.max(...bucket.map(segment => segment.max_current ?? segment.end_current ?? segment.mean_current ?? 0))
  const startCurrent = first.start_current ?? first.mean_current ?? 0
  const endCurrent = last.end_current ?? last.mean_current ?? 0
  const startPointLike: KeyPointItem = {
    point_index: 0,
    time: first.start_time,
    mean_current: startCurrent,
    min_current: first.min_current ?? startCurrent,
    max_current: first.max_current ?? startCurrent,
    span_current: first.bandwidth ?? 0,
    baseline_ratio: first.baseline_ratio ?? 0,
    peak_ratio: first.baseline_ratio ?? 0,
    delta_left: 0,
    delta_right: 0,
    change_percent: 0,
  }
  const endPointLike: KeyPointItem = {
    point_index: 1,
    time: last.end_time,
    mean_current: endCurrent,
    min_current: last.min_current ?? endCurrent,
    max_current: last.max_current ?? endCurrent,
    span_current: last.bandwidth ?? 0,
    baseline_ratio: last.baseline_ratio ?? 0,
    peak_ratio: last.baseline_ratio ?? 0,
    delta_left: 0,
    delta_right: 0,
    change_percent: 0,
  }
  return {
    segment_index: -1,
    start_time: first.start_time,
    end_time: last.end_time,
    duration: Number(duration.toFixed(6)),
    point_count: Math.max(2, totalPointCount),
    start_current: Number(startCurrent.toFixed(6)),
    end_current: Number(endCurrent.toFixed(6)),
    delta_current: Number((endCurrent - startCurrent).toFixed(6)),
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number(weightedMeanCurrent.toFixed(6)),
    representative_current: Number(weightedMeanCurrent.toFixed(6)),
    bandwidth: Number((maxCurrent - minCurrent).toFixed(6)),
    baseline_ratio: Number(weightedBaselineRatio.toFixed(6)),
    slope: duration > 0 ? Number(((endCurrent - startCurrent) / duration).toFixed(6)) : 0,
    line_fit_error: 0,
    kind: classifyKeyPointSegmentKind(startPointLike, endPointLike),
    polyline_points: [
      [first.start_time, Number(startCurrent.toFixed(6))],
      [last.end_time, Number(endCurrent.toFixed(6))],
    ],
    polyline_point_count: 2,
  } as SegmentItem
}

function mergeTinyKeyPointSegments(segments: SegmentItem[], minDurationSeconds: number) {
  if (segments.length < 3) {
    return segments.map((segment, index) => ({ ...segment, segment_index: index }))
  }

  const result: SegmentItem[] = []
  let index = 0
  while (index < segments.length) {
    const current = segments[index]!
    const previous = result[result.length - 1]
    const next = segments[index + 1]
    const isTiny = (current.duration || 0) <= minDurationSeconds
    if (previous && next && isTiny) {
      const previousFamily = getSegmentTrendFamily(previous)
      const currentFamily = getSegmentTrendFamily(current)
      const nextFamily = getSegmentTrendFamily(next)
      const canMergeTrendBridge = previousFamily === nextFamily && (previousFamily === 'rising' || previousFamily === 'falling')
      const canMergePlateauBridge = currentFamily === 'plateau' && previousFamily === nextFamily && (previousFamily === 'rising' || previousFamily === 'falling')
      if (canMergeTrendBridge || canMergePlateauBridge) {
        result[result.length - 1] = mergeSegmentBucket([previous, current, next])
        index += 2
        continue
      }
    }
    result.push(current)
    index++
  }

  return result.map((segment, segmentIndex) => ({
    ...segment,
    segment_index: segmentIndex,
  }))
}

function reducePointList(points: KeyPointItem[], globals: Globals, targetCount: number) {
  if (points.length <= targetCount) return points

  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const withImportance = points.map((point, index) => {
    const previous = points[index - 1] || point
    const next = points[index + 1] || point
    const localChange = Math.max(
      Math.abs(point.mean_current - previous.mean_current),
      Math.abs(next.mean_current - point.mean_current),
    )
    const importance = point.change_percent * 4
      + point.peak_ratio * 0.8
      + point.baseline_ratio * 0.25
      + (localChange / Math.max(fullScale, ABS_EPSILON)) * 100 * 2
    return { point, importance }
  })

  const keep = new Set<number>([0, points.length - 1])
  const bucketCount = Math.min(12, targetCount)
  const bucketSize = Math.max(1, Math.ceil(points.length / bucketCount))

  for (let bucketIndex = 0; bucketIndex < bucketCount && keep.size < targetCount; bucketIndex++) {
    const bucketStart = bucketIndex * bucketSize
    const bucketEnd = Math.min(points.length, bucketStart + bucketSize)
    const candidate = withImportance
      .slice(bucketStart, bucketEnd)
      .map((item, offset) => ({ ...item, index: bucketStart + offset }))
      .sort((left, right) => right.importance - left.importance)[0]
    if (candidate) keep.add(candidate.index)
  }

  const rest = withImportance
    .map((item, index) => ({ ...item, index }))
    .filter(item => !keep.has(item.index))
    .sort((left, right) => right.importance - left.importance)

  for (const item of rest) {
    if (keep.size >= targetCount) break
    keep.add(item.index)
  }

  return [...keep].sort((left, right) => left - right).map(index => points[index]!)
}

function classifyStructuralWindow(index: number, windows: KeyPointWindow[], globals: Globals) {
  const window = windows[index]!
  const previous = windows[index - 1] || window
  const next = windows[index + 1] || window
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const deltaPrev = window.mean_current - previous.mean_current
  const deltaNext = next.mean_current - window.mean_current
  const edgeDelta = Math.abs(deltaNext) >= Math.abs(deltaPrev) ? deltaNext : deltaPrev
  const edgePct = Math.abs(edgeDelta) / fullScale * 100
  const jumpPct = Math.max(Math.abs(deltaPrev), Math.abs(deltaNext), Math.abs(window.delta_peak || 0)) / fullScale * 100
  const spanPct = (window.span_current || 0) / fullScale * 100
  const peakLiftPct = Math.abs((window.max_current || 0) - (window.mean_current || 0)) / fullScale * 100
  const baselineRatio = window.baseline_ratio || 0
  const peakRatio = window.peak_ratio || 0
  const idleLike = baselineRatio <= 1.8 && peakRatio <= 2.2
  const highLike = window.mean_current >= globals.max_current * 0.88 || window.max_current >= globals.max_current * 0.96
  const stableLike = jumpPct <= 1.2 && spanPct <= 2.6

  if (stableLike) {
    if (idleLike) return 'plateau_idle'
    if (highLike) return 'plateau_high'
    return 'plateau_work'
  }

  if (edgePct >= 16 && spanPct >= 10) {
    return edgeDelta >= 0 ? 'edge_up' : 'edge_down'
  }

  if (peakLiftPct >= 14 && window.max_current >= globals.max_current * 0.75) {
    return 'pulse'
  }

  return edgeDelta >= 0 ? 'ramp_up' : 'ramp_down'
}

function buildStructuralRuns(windows: KeyPointWindow[], globals: Globals) {
  if (!windows.length) return [] as Array<{ feature: string; start: number; end: number }>
  const runs: Array<{ feature: string; start: number; end: number }> = []
  let current = { feature: classifyStructuralWindow(0, windows, globals), start: 0, end: 0 }
  const fullScale = Math.max(globals.max_current - globals.min_current, ABS_EPSILON)

  for (let index = 1; index < windows.length; index++) {
    const feature = classifyStructuralWindow(index, windows, globals)
    const previousWindow = windows[index - 1]!
    const currentWindow = windows[index]!
    const closeEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / fullScale * 100 <= 0.9
    const samePlateau = feature.startsWith('plateau_') && current.feature.startsWith('plateau_') && closeEnough
    if (feature === current.feature || samePlateau) {
      current.end = index
      continue
    }
    runs.push(current)
    current = { feature, start: index, end: index }
  }

  runs.push(current)
  return runs
}

function buildStructuralPoint(index: number, windows: KeyPointWindow[], globals: Globals, yValue: number): KeyPointItem {
  const point = buildKeyPoint(index, windows, globals, Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON))
  return {
    ...point,
    mean_current: Number(yValue.toFixed(6)),
  }
}

function buildStructuralSyntheticPoint(index: number, windows: KeyPointWindow[], globals: Globals, yValue: number, timeValue: number, pointIndex: number): KeyPointItem {
  const point = buildKeyPoint(index, windows, globals, Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON))
  return {
    ...point,
    point_index: pointIndex,
    time: Number(timeValue.toFixed(6)),
    mean_current: Number(yValue.toFixed(6)),
  }
}

function collapseCoincidentKeyPoints(points: KeyPointItem[]) {
  if (points.length <= 2) return points

  const sorted = points.slice().sort((left, right) => left.point_index - right.point_index)
  const collapsed: KeyPointItem[] = []
  let group: KeyPointItem[] = []

  const flush = () => {
    if (group.length === 0) return
    if (group.length <= 2) {
      collapsed.push(...group)
      group = []
      return
    }

    const first = group[0]!
    const last = group[group.length - 1]!
    const direction = last.mean_current - first.mean_current
    const low = group.reduce((best, item) => item.mean_current < best.mean_current ? item : best, group[0]!)
    const high = group.reduce((best, item) => item.mean_current > best.mean_current ? item : best, group[0]!)

    if (low === high) {
      collapsed.push(low)
      group = []
      return
    }

    if (direction >= 0) {
      collapsed.push(low, high)
    } else {
      collapsed.push(high, low)
    }
    group = []
  }

  for (const point of sorted) {
    if (group.length === 0) {
      group.push(point)
      continue
    }

    if (Math.abs(point.time - group[0]!.time) <= 0.000001) {
      group.push(point)
      continue
    }

    flush()
    group.push(point)
  }
  flush()
  return collapsed
}

function structuralRunPoints(run: { feature: string; start: number; end: number }, windows: KeyPointWindow[], globals: Globals) {
  const slice = windows.slice(run.start, run.end + 1)
  const points: KeyPointItem[] = []
  const length = run.end - run.start + 1
  const middle = Math.floor((run.start + run.end) / 2)

  if (run.feature.startsWith('plateau_')) {
    const levelSource = run.feature === 'plateau_high'
      ? slice.map(item => item.max_current)
      : slice.map(item => item.mean_current)
    const level = levelSource.slice().sort((left, right) => left - right)[Math.floor(levelSource.length / 2)] || windows[run.start]!.mean_current
    points.push(buildStructuralPoint(run.start, windows, globals, level))
    if (length >= 5) points.push(buildStructuralPoint(middle, windows, globals, level))
    if (run.end !== run.start) points.push(buildStructuralPoint(run.end, windows, globals, level))
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index)
  }

  if (run.feature === 'pulse') {
    let peakIndex = run.start
    for (let index = run.start + 1; index <= run.end; index++) {
      if (windows[index]!.max_current > windows[peakIndex]!.max_current) peakIndex = index
    }
    points.push(buildStructuralPoint(run.start, windows, globals, windows[run.start]!.mean_current))
    points.push(buildStructuralPoint(peakIndex, windows, globals, windows[peakIndex]!.max_current))
    if (run.end !== run.start) points.push(buildStructuralPoint(run.end, windows, globals, windows[run.end]!.mean_current))
    return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index)
  }

  if (run.feature === 'edge_up' || run.feature === 'edge_down') {
    const previous = windows[Math.max(0, run.start - 1)]!
    const startWindow = windows[run.start]!
    const endWindow = windows[run.end]!
    const next = windows[Math.min(windows.length - 1, run.end + 1)]!
    const transitionStart = Number(startWindow.start_time.toFixed(6))
    const transitionEnd = Number(endWindow.end_time.toFixed(6))

    if (run.feature === 'edge_up') {
      const lowLevel = Math.min(previous.mean_current, startWindow.min_current, endWindow.min_current)
      const highLevel = Math.max(next.mean_current, startWindow.max_current, endWindow.max_current)
      points.push(buildStructuralSyntheticPoint(run.start, windows, globals, lowLevel, transitionStart, run.start - 0.25))
      points.push(buildStructuralSyntheticPoint(run.end, windows, globals, highLevel, transitionEnd, run.end + 0.25))
    } else {
      const highLevel = Math.max(previous.mean_current, startWindow.max_current, endWindow.max_current)
      const lowLevel = Math.min(next.mean_current, startWindow.min_current, endWindow.min_current)
      points.push(buildStructuralSyntheticPoint(run.start, windows, globals, highLevel, transitionStart, run.start - 0.25))
      points.push(buildStructuralSyntheticPoint(run.end, windows, globals, lowLevel, transitionEnd, run.end + 0.25))
    }

    return points.sort((left, right) => left.point_index - right.point_index)
  }

  points.push(buildStructuralPoint(run.start, windows, globals, windows[run.start]!.mean_current))
  if ((run.feature === 'ramp_up' || run.feature === 'ramp_down') && length >= 8) {
    points.push(buildStructuralPoint(middle, windows, globals, windows[middle]!.mean_current))
  }
  if (run.end !== run.start) points.push(buildStructuralPoint(run.end, windows, globals, windows[run.end]!.mean_current))
  return [...new Map(points.map(item => [item.point_index, item])).values()].sort((left, right) => left.point_index - right.point_index)
}

function runStructuralProfileCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const windows = enrichKeyPointWindows(createKeyPointWindows(points, KEY_POINT_WINDOW_SECONDS), globals)
  const runs = buildStructuralRuns(windows, globals)
  const keyPoints = reducePointList(
    [...new Map(runs.flatMap(run => structuralRunPoints(run, windows, globals)).map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index),
    globals,
    KEY_POINT_TARGET_COUNT,
  )
  const segments = buildKeyPointSegments(keyPoints)
  const meta = buildCompressionMeta(profile, options)
  meta.compression_mode = 'key_points'
  meta.window_seconds = KEY_POINT_WINDOW_SECONDS
  meta.threshold_percent = null
  meta.selected_segment_count = segments.length
  meta.selected_key_point_count = keyPoints.length
  meta.target_key_point_min = KEY_POINT_TARGET_MIN
  meta.target_key_point_max = KEY_POINT_TARGET_MAX
  meta.selection_reason = '先识别平台/斜坡/脉冲/陡边结构单元，再按单元最小表达模板生成关键点'

  return {
    options: meta,
    result: {
      globals,
      segments,
      events: [],
    },
  }
}

function detectStructuralEdgeEvents(windows: KeyPointWindow[], globals: Globals) {
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const rawEvents: Array<{ type: 'edge_up' | 'edge_down'; leftIndex: number; rightIndex: number; boundaryTime: number; lowLevel: number; highLevel: number }> = []

  for (let index = 0; index < windows.length - 1; index++) {
    const left = windows[index]!
    const right = windows[index + 1]!
    const meanJumpPct = Math.abs(right.mean_current - left.mean_current) / fullScale * 100
    const peakJumpPct = Math.abs(right.max_current - left.max_current) / fullScale * 100
    const mixedSpanPct = Math.max(left.span_current, right.span_current) / fullScale * 100
    const strongJump = meanJumpPct >= 12 || peakJumpPct >= 16
    const mixedWindow = mixedSpanPct >= 8
    if (!strongJump) continue

    const type = right.mean_current >= left.mean_current ? 'edge_up' : 'edge_down'
    const boundaryTime = Number((((left.end_time + right.start_time) / 2)).toFixed(6))
    const lowLevel = Math.min(left.min_current, right.min_current, left.mean_current, right.mean_current)
    const highLevel = Math.max(left.max_current, right.max_current, left.mean_current, right.mean_current)

    rawEvents.push({
      type,
      leftIndex: index,
      rightIndex: index + 1,
      boundaryTime,
      lowLevel: mixedWindow ? lowLevel : Math.min(left.mean_current, right.mean_current),
      highLevel: mixedWindow ? highLevel : Math.max(left.mean_current, right.mean_current),
    })
  }

  if (rawEvents.length === 0) return rawEvents

  const clustered: typeof rawEvents = []
  let current = { ...rawEvents[0]! }
  for (let index = 1; index < rawEvents.length; index++) {
    const next = rawEvents[index]!
    const isAdjacent = next.leftIndex <= current.rightIndex + 1
    if (next.type === current.type && isAdjacent) {
      current = {
        type: current.type,
        leftIndex: current.leftIndex,
        rightIndex: next.rightIndex,
        boundaryTime: Number((((windows[current.leftIndex]!.end_time + windows[next.rightIndex]!.start_time) / 2)).toFixed(6)),
        lowLevel: Math.min(current.lowLevel, next.lowLevel),
        highLevel: Math.max(current.highLevel, next.highLevel),
      }
      continue
    }
    clustered.push(current)
    current = { ...next }
  }
  clustered.push(current)
  return clustered
}

function buildWindowMeanPrefixSums(windows: KeyPointWindow[]) {
  const prefix = new Array(windows.length + 1).fill(0)
  for (let index = 0; index < windows.length; index++) {
    prefix[index + 1] = prefix[index]! + (windows[index]!.mean_current || 0)
  }
  return prefix
}

function averageWindowMean(prefix: number[], startIndex: number, endIndex: number) {
  if (endIndex < startIndex) return 0
  const sum = prefix[endIndex + 1]! - prefix[startIndex]!
  return sum / Math.max(endIndex - startIndex + 1, 1)
}

function detectStructuralCusumEdgeEvents(windows: KeyPointWindow[], globals: Globals) {
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  if (windows.length < 2) return [] as Array<{ type: 'edge_up' | 'edge_down'; leftIndex: number; rightIndex: number; boundaryTime: number; lowLevel: number; highLevel: number }>

  const prefix = buildWindowMeanPrefixSums(windows)
  const rawEvents: Array<{ type: 'edge_up' | 'edge_down'; leftIndex: number; rightIndex: number; boundaryTime: number; lowLevel: number; highLevel: number }> = []

  for (let splitIndex = 0; splitIndex < windows.length - 1; splitIndex++) {
    const leftStart = Math.max(0, splitIndex - STRUCTURAL_CUSUM_RADIUS + 1)
    const leftEnd = splitIndex
    const rightStart = splitIndex + 1
    const rightEnd = Math.min(windows.length - 1, splitIndex + STRUCTURAL_CUSUM_RADIUS)
    const leftCount = leftEnd - leftStart + 1
    const rightCount = rightEnd - rightStart + 1
    if (leftCount <= 0 || rightCount <= 0) continue

    const leftMean = averageWindowMean(prefix, leftStart, leftEnd)
    const rightMean = averageWindowMean(prefix, rightStart, rightEnd)
    const meanJump = rightMean - leftMean
    const meanJumpPct = Math.abs(meanJump) / fullScale * 100
    const leftRegion = windows.slice(leftStart, leftEnd + 1)
    const rightRegion = windows.slice(rightStart, rightEnd + 1)
    const leftRangePct = (Math.max(...leftRegion.map(window => window.mean_current)) - Math.min(...leftRegion.map(window => window.mean_current))) / fullScale * 100
    const rightRangePct = (Math.max(...rightRegion.map(window => window.mean_current)) - Math.min(...rightRegion.map(window => window.mean_current))) / fullScale * 100
    const localMeanRangePct = Math.max(leftRangePct, rightRangePct)

    const leftWindow = windows[splitIndex]!
    const rightWindow = windows[splitIndex + 1]!
    const directJumpPct = Math.abs((rightWindow.mean_current || 0) - (leftWindow.mean_current || 0)) / fullScale * 100
    const localSpanPct = Math.max(leftWindow.span_current || 0, rightWindow.span_current || 0) / fullScale * 100

    const cusumScore = Math.sqrt((leftCount * rightCount) / (leftCount + rightCount)) * Math.abs(meanJump)
    const normalizedCusumPct = cusumScore / Math.max(fullScale, ABS_EPSILON) * 100
    const strongJump = (
      directJumpPct >= 8
      && meanJumpPct >= Math.max(8, localMeanRangePct * 1.8)
      && normalizedCusumPct >= Math.max(10, localMeanRangePct * 1.2)
    ) || (
      directJumpPct >= 10
      && meanJumpPct >= Math.max(10, localMeanRangePct * 2.2)
      && localSpanPct >= 6
    )
    if (!strongJump) continue

    const region = windows.slice(leftStart, rightEnd + 1)
    const lowLevel = Math.min(...region.map(window => Math.min(window.min_current, window.mean_current)))
    const highLevel = Math.max(...region.map(window => Math.max(window.max_current, window.mean_current)))
    const boundaryTime = Number((((leftWindow.end_time + rightWindow.start_time) / 2)).toFixed(6))
    rawEvents.push({
      type: meanJump >= 0 ? 'edge_up' : 'edge_down',
      leftIndex: splitIndex,
      rightIndex: splitIndex + 1,
      boundaryTime,
      lowLevel: localSpanPct >= 7 ? lowLevel : Math.min(leftMean, rightMean),
      highLevel: localSpanPct >= 7 ? highLevel : Math.max(leftMean, rightMean),
    })
  }

  if (rawEvents.length === 0) return rawEvents

  const clustered: typeof rawEvents = []
  let current = { ...rawEvents[0]! }
  for (let index = 1; index < rawEvents.length; index++) {
    const next = rawEvents[index]!
    const isAdjacent = next.leftIndex <= current.rightIndex + 1
    if (next.type === current.type && isAdjacent) {
      current = {
        type: current.type,
        leftIndex: current.leftIndex,
        rightIndex: next.rightIndex,
        boundaryTime: Number((((windows[current.leftIndex]!.end_time + windows[next.rightIndex]!.start_time) / 2)).toFixed(6)),
        lowLevel: Math.min(current.lowLevel, next.lowLevel),
        highLevel: Math.max(current.highLevel, next.highLevel),
      }
      continue
    }
    clustered.push(current)
    current = { ...next }
  }
  clustered.push(current)
  return clustered
}

function buildStructuralProfileV2RegionRuns(windows: KeyPointWindow[], globals: Globals, blockedIndices: Set<number>) {
  const runs: Array<{ feature: string; start: number; end: number }> = []
  let current: { feature: string; start: number; end: number } | null = null
  const fullScale = Math.max(globals.max_current - globals.min_current, ABS_EPSILON)

  for (let index = 0; index < windows.length; index++) {
    if (blockedIndices.has(index)) {
      if (current) {
        runs.push(current)
        current = null
      }
      continue
    }

    const feature = classifyStructuralWindow(index, windows, globals)
    if (!current) {
      current = { feature, start: index, end: index }
      continue
    }

    const previousWindow = windows[index - 1]!
    const currentWindow = windows[index]!
    const closeEnough = Math.abs(currentWindow.mean_current - previousWindow.mean_current) / fullScale * 100 <= 0.9
    const samePlateau = feature.startsWith('plateau_') && current.feature.startsWith('plateau_') && closeEnough
    if (feature === current.feature || samePlateau) {
      current.end = index
    } else {
      runs.push(current)
      current = { feature, start: index, end: index }
    }
  }

  if (current) runs.push(current)
  return runs
}

function buildStructuralEdgeEventPoints(events: ReturnType<typeof detectStructuralEdgeEvents>, windows: KeyPointWindow[], globals: Globals) {
  return events.flatMap((event) => {
    const leftWindow = windows[event.leftIndex]!
    const rightWindow = windows[event.rightIndex]!
    const previousWindow = windows[Math.max(0, event.leftIndex - 1)]!
    const nextWindow = windows[Math.min(windows.length - 1, event.rightIndex + 1)]!
    const lowLevel = Math.min(event.lowLevel, previousWindow.mean_current, nextWindow.mean_current)
    const highLevel = Math.max(event.highLevel, previousWindow.mean_current, nextWindow.mean_current)
    const transitionStart = Number(leftWindow.start_time.toFixed(6))
    const transitionEnd = Number(rightWindow.end_time.toFixed(6))
    if (event.type === 'edge_up') {
      return [
        buildStructuralSyntheticPoint(event.leftIndex, windows, globals, lowLevel, transitionStart, event.leftIndex + 0.1),
        buildStructuralSyntheticPoint(event.rightIndex, windows, globals, highLevel, transitionEnd, event.rightIndex + 0.2),
      ]
    }

    return [
      buildStructuralSyntheticPoint(event.leftIndex, windows, globals, highLevel, transitionStart, event.leftIndex + 0.1),
      buildStructuralSyntheticPoint(event.rightIndex, windows, globals, lowLevel, transitionEnd, event.rightIndex + 0.2),
    ]
  })
}

function runStructuralProfileV2Compression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const windows = enrichKeyPointWindows(createKeyPointWindows(points, KEY_POINT_WINDOW_SECONDS), globals)
  const edgeEvents = detectStructuralEdgeEvents(windows, globals)
  const blockedIndices = new Set<number>()
  for (const event of edgeEvents) {
    blockedIndices.add(event.leftIndex)
    blockedIndices.add(event.rightIndex)
  }

  const regionRuns = buildStructuralProfileV2RegionRuns(windows, globals, blockedIndices)
  const regionPoints = regionRuns.flatMap(run => structuralRunPoints(run, windows, globals))
  const edgePoints = buildStructuralEdgeEventPoints(edgeEvents, windows, globals)
  const keyPoints = reducePointList(
    [...new Map([...regionPoints, ...edgePoints].map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index),
    globals,
    KEY_POINT_TARGET_COUNT,
  )
  const segments = buildKeyPointSegments(keyPoints)
  const meta = buildCompressionMeta(profile, options)
  meta.compression_mode = 'key_points'
  meta.window_seconds = KEY_POINT_WINDOW_SECONDS
  meta.threshold_percent = null
  meta.selected_segment_count = segments.length
  meta.selected_key_point_count = keyPoints.length
  meta.target_key_point_min = KEY_POINT_TARGET_MIN
  meta.target_key_point_max = KEY_POINT_TARGET_MAX
  meta.selection_reason = '先检测强跳变边界事件，再对剩余区域做平台/斜坡采样，优先保持近 90 度陡边'

  return {
    options: meta,
    result: {
      globals,
      segments,
      events: edgeEvents.map(event => ({
        type: event.type,
        time: event.boundaryTime,
      })),
    },
  }
}

function runStructuralCusumCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const windows = enrichKeyPointWindows(createKeyPointWindows(points, KEY_POINT_WINDOW_SECONDS), globals)
  const edgeEvents = detectStructuralCusumEdgeEvents(windows, globals)
  const blockedIndices = new Set<number>()
  for (const event of edgeEvents) {
    blockedIndices.add(Math.max(0, event.leftIndex - 1))
    blockedIndices.add(event.leftIndex)
    blockedIndices.add(event.rightIndex)
    blockedIndices.add(Math.min(windows.length - 1, event.rightIndex + 1))
  }

  const regionRuns = buildStructuralProfileV2RegionRuns(windows, globals, blockedIndices)
  const regionPoints = regionRuns.flatMap(run => structuralRunPoints(run, windows, globals))
  const edgePoints = buildStructuralEdgeEventPoints(edgeEvents, windows, globals)
  const keyPoints = reducePointList(
    collapseCoincidentKeyPoints(
      [...new Map([...regionPoints, ...edgePoints].map(point => [point.point_index, point])).values()].sort((left, right) => left.point_index - right.point_index)
    ),
    globals,
    KEY_POINT_TARGET_COUNT,
  )
  const segments = buildKeyPointSegments(keyPoints)
  const meta = buildCompressionMeta(profile, options)
  meta.compression_mode = 'key_points'
  meta.window_seconds = KEY_POINT_WINDOW_SECONDS
  meta.threshold_percent = null
  meta.selected_segment_count = segments.length
  meta.selected_key_point_count = keyPoints.length
  meta.target_key_point_min = KEY_POINT_TARGET_MIN
  meta.target_key_point_max = KEY_POINT_TARGET_MAX
  meta.selection_reason = '先用局部 CUSUM 检测候选跳变边界，再对剩余区域做平台/斜坡采样，减少纯阈值边界误判'

  return {
    options: meta,
    result: {
      globals,
      segments,
      events: edgeEvents.map(event => ({
        type: event.type,
        time: event.boundaryTime,
      })),
    },
  }
}

function runKeyPointCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  if (profile.key === 'structural_cusum_v1') {
    return runStructuralCusumCompression(points, options, profile)
  }

  if (profile.key === 'structural_profile_v2') {
    return runStructuralProfileV2Compression(points, options, profile)
  }

  if (profile.key === 'structural_profile_v1') {
    return runStructuralProfileCompression(points, options, profile)
  }

  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const windows = enrichKeyPointWindows(createKeyPointWindows(points, KEY_POINT_WINDOW_SECONDS), globals)
  const isEnvelopeTurningPoints = profile.key === 'envelope_turning_points_v2' || profile.key === 'envelope_turning_points_v3'
  const includeEnvelopeExtrema = isEnvelopeTurningPoints
  const includeHighPlateauAnchors = isEnvelopeTurningPoints
  const plateauBoundaryAnchors = profile.key === 'envelope_turning_points_v3'
    ? [...detectPlateauBoundaryAnchors(windows, globals)]
    : []
  const candidates = KEY_POINT_THRESHOLD_STEPS.map((thresholdPercent) => ({
    thresholdPercent,
    indices: reduceKeyPointIndices(
      Array.from(new Set([
        ...selectKeyPointIndices(windows, globals, thresholdPercent, includeEnvelopeExtrema, includeHighPlateauAnchors),
        ...plateauBoundaryAnchors,
      ])).sort((left, right) => left - right),
      windows,
      globals,
      KEY_POINT_TARGET_COUNT,
      thresholdPercent,
      plateauBoundaryAnchors,
    ),
  }))
  const selected = fitKeyPointSelection(candidates)
  const fullScale = Math.max(globals.max_current - globals.min_current, globals.max_current - globals.baseline_mean, ABS_EPSILON)
  const keyPoints = selected.indices.map(index => buildKeyPoint(index, windows, globals, fullScale))
  const segments = buildKeyPointSegments(keyPoints)
  const meta = buildCompressionMeta(profile, options)
  meta.compression_mode = 'key_points'
  meta.window_seconds = KEY_POINT_WINDOW_SECONDS
  meta.threshold_percent = selected.thresholdPercent
  meta.selected_segment_count = segments.length
  meta.selected_key_point_count = keyPoints.length
  meta.target_key_point_min = KEY_POINT_TARGET_MIN
  meta.target_key_point_max = KEY_POINT_TARGET_MAX
  meta.selection_reason = profile.key === 'envelope_turning_points_v3'
    ? '关键点阈值 + 均值/峰值转折保留 + 平台边界结构锚点'
    : includeEnvelopeExtrema
      ? '关键点阈值 + 均值/峰值转折保留 + 堵转平台锚点'
      : '按相邻窗口变化幅度自适应筛选关键点'

  return {
    options: meta,
    result: {
      globals,
      segments,
      events: [],
    },
  }
}

const OPTIMAL_SEGMENTATION_MAX_KNOTS = 700
const OPTIMAL_SEGMENTATION_DECIMATE_TARGET = 3000

export function decimateMinMax(points: RawPoint[], targetCount: number): RawPoint[] {
  // min-max 分桶抽取：每桶保留最小/最大两个原始点，包络无损、陡沿保留，
  // 避免均匀抽样的混叠问题（尖峰可能在抽样间隔中丢失）
  if (points.length <= targetCount) {
    return points
  }
  const bucketCount = Math.max(1, Math.floor((targetCount - 2) / 2))
  const result: RawPoint[] = [points[0]!]
  const bucketSize = (points.length - 2) / bucketCount

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor(bucket * bucketSize)
    const end = Math.min(points.length - 1, 1 + Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue

    let minIndex = start
    let maxIndex = start
    for (let index = start; index < end; index++) {
      if (points[index]![1] < points[minIndex]![1]) minIndex = index
      if (points[index]![1] > points[maxIndex]![1]) maxIndex = index
    }

    if (minIndex === maxIndex) {
      result.push(points[minIndex]!)
    } else if (minIndex < maxIndex) {
      result.push(points[minIndex]!, points[maxIndex]!)
    } else {
      result.push(points[maxIndex]!, points[minIndex]!)
    }
  }

  result.push(points[points.length - 1]!)
  return result
}

function minimaxKnotSelection(times: number[], values: number[], internalErrors: number[], segmentCount: number): number[] {
  // 精确 minimax K 段分段：f[s][j] = min over i of max(f[s-1][i], cost(i, j))
  // cost(i, j) = 弦在内部结点上的最大垂直误差 + 区间内微段内部误差最大值（L∞ 真实误差的上界）
  // 返回使上界最小的结点下标序列（含首尾）
  const n = times.length
  const last = n - 1
  if (segmentCount >= last) {
    return Array.from({ length: n }, (_, index) => index)
  }

  const cost: Float64Array[] = new Array(n)
  for (let i = 0; i < last; i++) {
    const row = new Float64Array(n)
    const t0 = times[i]!
    const v0 = values[i]!
    let internalMax = internalErrors[i] ?? 0
    for (let j = i + 1; j < n; j++) {
      if (j > i + 1) {
        internalMax = Math.max(internalMax, internalErrors[j - 1] ?? 0)
      }
      const t1 = times[j]!
      const v1 = values[j]!
      const dt = t1 - t0
      let maxErr = 0
      for (let k = i + 1; k < j; k++) {
        const ratio = dt > 0 ? (times[k]! - t0) / dt : 0
        const err = Math.abs(values[k]! - (v0 + (v1 - v0) * ratio))
        if (err > maxErr) maxErr = err
      }
      row[j] = maxErr + internalMax
    }
    cost[i] = row
  }

  let previous = new Float64Array(n)
  const parents: Int32Array[] = [new Int32Array(n).fill(0)]
  for (let j = 0; j < n; j++) {
    previous[j] = cost[0]![j]!
  }

  for (let s = 2; s <= segmentCount; s++) {
    const current = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
    const currentParent = new Int32Array(n).fill(-1)
    for (let j = s - 1; j < n; j++) {
      let best = Number.POSITIVE_INFINITY
      let bestI = -1
      for (let i = s - 2; i < j; i++) {
        const value = Math.max(previous[i]!, cost[i]![j]!)
        if (value < best) {
          best = value
          bestI = i
        }
      }
      current[j] = best
      currentParent[j] = bestI
    }
    parents.push(currentParent)
    previous = current
  }

  const knots = [last]
  let segmentsUsed = segmentCount
  let cursor = last
  while (segmentsUsed > 1 && cursor > 0) {
    const predecessor = parents[segmentsUsed - 1]![cursor]!
    if (predecessor < 0) break
    knots.push(predecessor)
    cursor = predecessor
    segmentsUsed--
  }
  knots.push(0)
  return [...new Set(knots)].sort((left, right) => left - right)
}

function runOptimalSegmentationCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const rawPointCount = points.length
  // 先做特征保持抽取，把后续预切分/DP 的复杂度与原始点数解耦
  const workingPoints = decimateMinMax(points, OPTIMAL_SEGMENTATION_DECIMATE_TARGET)
  const globals = calculateGlobals(workingPoints)
  const target = Math.max(10, Number(profile.target_segment_count) || 45)

  // 精细预切分：微段内部误差被分辨率天然限界（≤ 2×resolution）；
  // 结点数超上限时放大分辨率重建，保证 DP 复杂度可控
  let resolution = options.absolute_resolution
  let microSegments = buildInitialSegments(workingPoints, { ...options, absolute_resolution: resolution }, globals)
  for (let attempt = 0; microSegments.length + 1 > OPTIMAL_SEGMENTATION_MAX_KNOTS && attempt < 8; attempt++) {
    resolution *= 2
    microSegments = buildInitialSegments(workingPoints, { ...options, absolute_resolution: resolution }, globals)
  }

  // 结点候选 = 各微段起点 + 末段终点（均为抽取后的采样点下标，边界天然采样级精确）
  const knotRawIndices = microSegments.map(segment => segment.start_index || 0)
  const finalEndIndex = microSegments[microSegments.length - 1]!.end_index || 0
  if (knotRawIndices[knotRawIndices.length - 1] !== finalEndIndex) {
    knotRawIndices.push(finalEndIndex)
  }

  const knotTimes = knotRawIndices.map(index => workingPoints[index]![0])
  const knotValues = knotRawIndices.map(index => workingPoints[index]![1])
  // 每个间隙（knot g -> knot g+1）对应一个微段，内部误差取其 line_fit_error
  const internalErrors = microSegments.map(segment => segment.line_fit_error || 0)

  const segmentCount = Math.min(target, knotRawIndices.length - 1)
  const selectedKnots = minimaxKnotSelection(knotTimes, knotValues, internalErrors, Math.max(1, segmentCount))

  const segments: InternalSegment[] = []
  for (let index = 0; index < selectedKnots.length - 1; index++) {
    const startRaw = knotRawIndices[selectedKnots[index]!]!
    const endRaw = knotRawIndices[selectedKnots[index + 1]!]!
    segments.push(createSegment(workingPoints, startRaw, endRaw, globals, options))
  }
  const indexedSegments = segments.map((segment, index) => ({ ...segment, segment_index: index }))
  const withPolyline = attachPolylinePoints(indexedSegments, workingPoints, globals, options) as SegmentItem[]

  const meta = buildCompressionMeta(profile, { ...options, absolute_resolution: resolution })
  meta.selected_segment_count = withPolyline.length
  meta.selection_reason = 'minimax_dp_budget'
  meta.selection_context = {
    raw_point_count: rawPointCount,
    decimated_point_count: workingPoints.length,
    micro_segment_count: microSegments.length,
    knot_count: knotRawIndices.length,
    target_segment_count: target,
  }

  return {
    options: meta,
    result: {
      globals,
      segments: withPolyline,
      events: extractEvents(indexedSegments),
    },
  }
}

type CompressionRunResult = {
  globals: Globals
  segments: SegmentItem[]
  events: Array<Record<string, unknown>>
}

type OptimizedCompressionResult = {
  options: CompressionMeta
  result: CompressionRunResult
}

function buildCompressionMeta(profile: CompressionAlgorithmProfile, options: CompressionOptions): CompressionMeta {
  return {
    algorithm_key: profile.key,
    algorithm_label: profile.label,
    compression_mode: profile.output_mode,
    absolute_resolution: options.absolute_resolution,
    relative_resolution: options.relative_resolution,
    merge_gap_ratio: options.merge_gap_ratio,
    min_transition_points: options.min_transition_points,
    target_segment_count: Math.max(10, Number(options.target_segment_count) || 45),
    selected_segment_count: 0,
    window_seconds: null,
    threshold_percent: null,
    selected_key_point_count: null,
    target_key_point_min: null,
    target_key_point_max: null,
    selection_reason: null,
    selection_context: null,
  }
}

function runFixedCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const meta = buildCompressionMeta(profile, options)
  const result = runCompression(points, options, globals, profile)
  meta.selected_segment_count = result.segments.length
  meta.selection_reason = 'fixed_resolution'
  return {
    options: meta,
    result,
  }
}

function runCompression(points: RawPoint[], options: CompressionOptions, globals: Globals, profile: CompressionAlgorithmProfile): CompressionRunResult {
  const initialSegments = buildInitialSegments(points, options, globals)
  const mergedSegments = mergeSegments(initialSegments, options, globals, profile)
  const segments = attachPolylinePoints(mergedSegments, points, globals, options) as SegmentItem[]
  return {
    globals,
    segments,
    events: extractEvents(segments as InternalSegment[]),
  }
}

function optimizeCompressionOptions(points: RawPoint[], baseOptions: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  if (!profile.adaptive_search) {
    return runFixedCompression(points, baseOptions, profile)
  }

  const target = Math.max(10, Number(baseOptions.target_segment_count) || 45)
  const baseResolution = Math.max(baseOptions.absolute_resolution, 0.000001)
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const multipliers = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
  const candidates = multipliers.map(multiplier => {
    const absolute_resolution = Number((baseResolution * multiplier).toPrecision(12))
    const options = buildCompressionMeta(profile, {
      ...baseOptions,
      absolute_resolution,
      target_segment_count: target,
    })
    const result = runCompression(points, options, globals, profile)
    options.selected_segment_count = result.segments.length
    return { options, result }
  }).sort((left, right) => left.options.absolute_resolution - right.options.absolute_resolution)

  let bestCandidate = candidates[0]!
  let bestDistance = Math.abs(candidates[0]!.result.segments.length - target)
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.result.segments.length - target)
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.options.absolute_resolution < bestCandidate.options.absolute_resolution)
    ) {
      bestCandidate = candidate
      bestDistance = distance
    }
  }

  const acceptableCandidates = candidates.filter(candidate => candidate.result.segments.length <= target)
  if (acceptableCandidates.length > 0) {
    let nearestAcceptable = acceptableCandidates[0]!
    for (const candidate of acceptableCandidates) {
      const currentDistance = Math.abs(candidate.result.segments.length - target)
      const selectedDistance = Math.abs(nearestAcceptable.result.segments.length - target)
      if (
        currentDistance < selectedDistance ||
        (currentDistance === selectedDistance && candidate.options.absolute_resolution < nearestAcceptable.options.absolute_resolution)
      ) {
        nearestAcceptable = candidate
      }
    }

    nearestAcceptable.options.selection_reason = 'closest_reachable_target'
    return nearestAcceptable
  }

  let bestCliffPair: { left: OptimizedCompressionResult; right: OptimizedCompressionResult; crossesTarget: boolean } | null = null
  let bestCliffScore = -1
  for (let index = 0; index < candidates.length - 1; index++) {
    const left = candidates[index]!
    const right = candidates[index + 1]!
    const leftCount = left.result.segments.length
    const rightCount = right.result.segments.length
    const pointGap = Math.abs(rightCount - leftCount)
    const ratio = (Math.max(leftCount, rightCount) + 1) / (Math.min(leftCount, rightCount) + 1)
    const crossesTarget = (leftCount - target) * (rightCount - target) <= 0
    const score = pointGap * ratio * (crossesTarget ? 4 : 1)

    if (score > bestCliffScore) {
      bestCliffScore = score
      bestCliffPair = { left, right, crossesTarget }
    }
  }

  if (!bestCliffPair) {
    bestCandidate.options.selection_reason = 'closest_unreachable_target'
    return bestCandidate
  }

  const pairChoices = [bestCliffPair.left, bestCliffPair.right]
  let selected: OptimizedCompressionResult | null = null

  if (bestCliffPair.crossesTarget) {
    const acceptableChoices = pairChoices.filter(item => item.result.segments.length <= target)
    if (acceptableChoices.length > 0) {
      selected = acceptableChoices[0]!
      for (const item of acceptableChoices) {
        const currentDistance = Math.abs(item.result.segments.length - target)
        const selectedDistance = Math.abs(selected!.result.segments.length - target)
        if (
          currentDistance < selectedDistance ||
          (currentDistance === selectedDistance && item.options.absolute_resolution < selected!.options.absolute_resolution)
        ) {
          selected = item
        }
      }
    }
  }

  if (!selected) {
    selected = pairChoices[0]!
    for (const item of pairChoices) {
      const currentDistance = Math.abs(item.result.segments.length - target)
      const selectedDistance = Math.abs(selected!.result.segments.length - target)
      if (
        currentDistance < selectedDistance ||
        (currentDistance === selectedDistance && item.options.absolute_resolution < selected!.options.absolute_resolution)
      ) {
        selected = item
      }
    }
  }

  if (
    Math.abs(bestCandidate.result.segments.length - target) < Math.abs(selected.result.segments.length - target) &&
    bestCandidate.result.segments.length <= target
  ) {
    bestCandidate.options.selection_reason = 'closest_reachable_target'
    return bestCandidate
  }

  if (bestCandidate.result.segments.length < selected.result.segments.length) {
    bestCandidate.options.selection_reason = 'closest_unreachable_target'
    return bestCandidate
  }

  selected.options.selection_reason = bestCliffPair.crossesTarget ? 'cliff_boundary_target_crossing' : 'largest_cliff'
  selected.options.selection_context = {
    left_resolution: bestCliffPair.left.options.absolute_resolution,
    left_points: bestCliffPair.left.result.segments.length,
    right_resolution: bestCliffPair.right.options.absolute_resolution,
    right_points: bestCliffPair.right.result.segments.length,
  }
  return selected
}

function normalizeRawPoints(rawData: number[][], profile: CompressionAlgorithmProfile): RawPoint[] {
  const points: RawPoint[] = []
  let isSorted = true
  let previousTime = Number.NEGATIVE_INFINITY

  for (const point of rawData) {
    if (!Array.isArray(point) || point.length < 2) {
      continue
    }

    const time = Number(point[0])
    const current = Number(point[1])
    if (!Number.isFinite(time) || !Number.isFinite(current)) {
      continue
    }

    if (time < previousTime) {
      isSorted = false
    }
    previousTime = time
    points.push([time, current])
  }

  const sortedPoints = isSorted ? points : points.slice().sort((left, right) => left[0] - right[0])

  if (profile.strict_duplicate_conflict) {
    let index = 0
    while (index < sortedPoints.length) {
      const time = sortedPoints[index]![0]
      const currents = [sortedPoints[index]![1]]
      let nextIndex = index + 1

      while (nextIndex < sortedPoints.length && sortedPoints[nextIndex]![0] === time) {
        currents.push(sortedPoints[nextIndex]![1])
        nextIndex++
      }

      if (currents.length > 1) {
        const uniqueCurrents = new Set(currents.map(normalizeDuplicateCurrentValue))
        if (uniqueCurrents.size > 1) {
          throw new Error(`检测到重复时间点且电流值冲突: t=${time}`)
        }
        throw new Error(`检测到重复时间点: t=${time}`)
      }

      index = nextIndex
    }
  }

  return sortedPoints
}

export function runLocalCurrentFeatureAnalysis(rawData: number[][], appConfig: AppConfig | null, algorithmKey: CompressionAlgorithmKey = 'adaptive_v2'): FileAnalysisResult {
  const profile = getAlgorithmProfile(algorithmKey)
  const sortedPoints = normalizeRawPoints(rawData, profile)

  if (sortedPoints.length === 0) {
    throw new Error('文件中无有效数据点')
  }

  const baseOptions: CompressionOptions = {
    absolute_resolution: appConfig?.absolute_resolution ?? DEFAULT_OPTIONS.absolute_resolution,
    relative_resolution: appConfig?.relative_resolution ?? DEFAULT_OPTIONS.relative_resolution,
    merge_gap_ratio: appConfig?.merge_gap_ratio ?? DEFAULT_OPTIONS.merge_gap_ratio,
    min_transition_points: appConfig?.min_transition_points ?? DEFAULT_OPTIONS.min_transition_points,
    target_segment_count: profile.target_segment_count,
  }

  if (profile.key === 'optimal_segmentation_v1') {
    const optimized = runOptimalSegmentationCompression(sortedPoints, baseOptions, profile)
    return {
      globals: optimized.result.globals,
      segments: optimized.result.segments,
      events: optimized.result.events,
      compression_meta: optimized.options,
    }
  }

  if (profile.output_mode === 'key_points') {
    const optimized = runKeyPointCompression(sortedPoints, baseOptions, profile)
    return {
      globals: optimized.result.globals,
      segments: optimized.result.segments,
      events: optimized.result.events,
      compression_meta: optimized.options,
    }
  }

  const optimized = optimizeCompressionOptions(sortedPoints, baseOptions, profile)
  const result = optimized.result

  return {
    globals: result.globals,
    segments: result.segments,
    events: result.events,
    compression_meta: optimized.options,
  }
}
