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
const KEY_POINT_TARGET_MIN = 40
const KEY_POINT_TARGET_MAX = 60
const KEY_POINT_TARGET_COUNT = 52
const KEY_POINT_THRESHOLD_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 9, 12, 15, 18, 22, 26, 30]

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
  envelope_turning_points_v1: {
    key: 'envelope_turning_points_v1',
    label: '包络转折点 V1',
    output_mode: 'key_points',
    baseline_mode: 'adaptive_v2',
    trend_mode: 'adaptive_v2',
    strict_duplicate_conflict: false,
    adaptive_search: false,
    target_segment_count: KEY_POINT_TARGET_COUNT,
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

function selectKeyPointIndices(windows: KeyPointWindow[], globals: Globals, thresholdPercent: number, includeEnvelopeExtrema: boolean) {
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

  return [...selected].sort((left, right) => left - right)
}

function reduceKeyPointIndices(indices: number[], windows: KeyPointWindow[], globals: Globals, targetCount: number, thresholdPercent: number) {
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
  const stallPeakThreshold = globals.max_current / baselineMagnitude(globals) * 0.85
  const keep = new Set<number>(
    candidates
      .filter(candidate => anchors.has(candidate.index) || candidate.point.change_percent >= Math.max(10, thresholdPercent * 1.5) || candidate.point.peak_ratio >= stallPeakThreshold)
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

function buildKeyPointSegments(keyPoints: KeyPointItem[]) {
  if (keyPoints.length < 2) return [] as SegmentItem[]
  return keyPoints.slice(0, -1).map((point, index) => {
    const nextPoint = keyPoints[index + 1]!
    const duration = Math.max(nextPoint.time - point.time, 0)
    const meanCurrent = Number((((point.mean_current + nextPoint.mean_current) / 2)).toFixed(6))
    return {
      segment_index: index,
      start_time: point.time,
      end_time: nextPoint.time,
      duration: Number(duration.toFixed(6)),
      point_count: Math.max(2, nextPoint.point_index - point.point_index + 1),
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
    }
  })
}

function runKeyPointCompression(points: RawPoint[], options: CompressionOptions, profile: CompressionAlgorithmProfile): OptimizedCompressionResult {
  const globals = profile.baseline_mode === 'legacy_v4' ? calculateGlobalsLegacy(points) : calculateGlobals(points)
  const windows = enrichKeyPointWindows(createKeyPointWindows(points, KEY_POINT_WINDOW_SECONDS), globals)
  const includeEnvelopeExtrema = profile.key === 'envelope_turning_points_v1'
  const candidates = KEY_POINT_THRESHOLD_STEPS.map((thresholdPercent) => ({
    thresholdPercent,
    indices: reduceKeyPointIndices(
      selectKeyPointIndices(windows, globals, thresholdPercent, includeEnvelopeExtrema),
      windows,
      globals,
      KEY_POINT_TARGET_COUNT,
      thresholdPercent,
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
  meta.selection_reason = includeEnvelopeExtrema
    ? '关键点阈值 + 均值/峰值转折保留'
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
