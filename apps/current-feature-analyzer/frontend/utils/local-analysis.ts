import type { AppConfig, CompressionMeta, FileAnalysisResult, SegmentItem } from '../api/current-feature-analyzer'

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

function pointLineVerticalError(point: { time: number; current: number }, start: { time: number; current: number }, end: { time: number; current: number }) {
  const duration = end.time - start.time
  if (duration === 0) {
    return Math.abs(point.current - start.current)
  }

  const ratio = (point.time - start.time) / duration
  const predicted = start.current + (end.current - start.current) * ratio
  return Math.abs(point.current - predicted)
}

function simplifyPolyline(points: Array<{ time: number; current: number }>, epsilon: number) {
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

  const result: Array<{ time: number; current: number }> = []
  for (let index = 0; index < points.length; index++) {
    if (keep[index]) {
      result.push(points[index]!)
    }
  }
  return result
}

function calculateLineFitError(points: RawPoint[]) {
  if (points.length <= 2) return 0
  const start = points[0]!
  const end = points[points.length - 1]!
  const duration = end[0] - start[0]
  if (duration <= 0) return 0
  let maxResidual = 0
  for (const point of points) {
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

  for (const point of points) {
    if (point[1] < minCurrent) minCurrent = point[1]
    if (point[1] > maxCurrent) maxCurrent = point[1]
    totalCurrent += point[1]
  }

  const nonZeroPoints = points.filter(([, current]) => Math.abs(current) > ABS_EPSILON)
  const headCandidates = nonZeroPoints.slice(0, BASELINE_SAMPLE_COUNT)
  const tailCandidates = nonZeroPoints.slice(-BASELINE_SAMPLE_COUNT)

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

function createSegment(points: RawPoint[], startIndex: number, endIndex: number, globals: Globals, options: CompressionOptions): InternalSegment {
  const slice = points.slice(startIndex, endIndex + 1)
  const startTime = slice[0]![0]
  const endTime = slice[slice.length - 1]![0]
  const duration = Math.max(endTime - startTime, 0)
  let minCurrent = slice[0]![1]
  let maxCurrent = slice[0]![1]
  let totalCurrent = 0
  for (const point of slice) {
    if (point[1] < minCurrent) minCurrent = point[1]
    if (point[1] > maxCurrent) maxCurrent = point[1]
    totalCurrent += point[1]
  }
  const meanCurrent = totalCurrent / slice.length
  const resolution = resolutionForCurrent(meanCurrent, options)
  const representativeCurrent = quantizeCurrent(meanCurrent, resolution)
  const slope = duration > 0 ? (slice[slice.length - 1]![1] - slice[0]![1]) / duration : 0
  const bandwidth = maxCurrent - minCurrent
  const lineFitError = calculateLineFitError(slice)

  return {
    segment_index: -1,
    start_index: startIndex,
    end_index: endIndex,
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(endTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    point_count: slice.length,
    min_current: Number(minCurrent.toFixed(6)),
    max_current: Number(maxCurrent.toFixed(6)),
    mean_current: Number(meanCurrent.toFixed(6)),
    representative_current: Number(representativeCurrent.toFixed(6)),
    bandwidth: Number(bandwidth.toFixed(6)),
    baseline_ratio: Number(ratioToBaseline(meanCurrent, globals).toFixed(6)),
    slope: Number(slope.toFixed(6)),
    line_fit_error: Number(lineFitError.toFixed(6)),
    kind: classifySegmentKind({
      point_count: slice.length,
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

  return {
    segment_index: -1,
    start_index: bucket[0]!.start_index,
    end_index: bucket[bucket.length - 1]!.end_index,
    start_time: Number(startTime.toFixed(6)),
    end_time: Number(endTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    point_count: pointCount,
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

function mergeTrendRuns(segments: InternalSegment[], options: CompressionOptions, globals: Globals) {
  if (segments.length <= 2) return segments
  const merged: InternalSegment[] = []
  let index = 0
  while (index < segments.length) {
    const current = segments[index]!
    if (!isTrendCandidate(current, options, globals, index, segments)) {
      merged.push(current)
      index++
      continue
    }

    const bucket: InternalSegment[] = [current]
    let nextIndex = index + 1
    let direction = 0
    while (nextIndex < segments.length) {
      const candidate = segments[nextIndex]!
      if (!isTrendCandidate(candidate, options, globals, nextIndex, segments)) {
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

function mergeSegments(initialSegments: InternalSegment[], options: CompressionOptions, globals: Globals) {
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
  const trendMerged = mergeTrendRuns(smoothed, options, globals)
  return trendMerged.map((segment, index) => ({ ...segment, segment_index: index }))
}

function samplePointsForVisualization(points: Array<{ time: number; current: number }>, maxPoints: number) {
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

function buildPolylinePoints(segment: InternalSegment, slice: RawPoint[], globals: Globals, options: CompressionOptions) {
  if (isPlateauKind(segment.kind)) {
    return [
      [segment.start_time || 0, segment.representative_current || 0],
      [segment.end_time || 0, segment.representative_current || 0],
    ]
  }

  const points = slice.map(point => ({ time: point[0], current: point[1] }))
  const sampled = samplePointsForVisualization(points, 1200)
  const epsilon = Math.max(resolutionForCurrent(segment.mean_current || 0, options), baselineMagnitude(globals) * 0.01)
  const simplified = simplifyPolyline(sampled, epsilon)
  return simplified.map(point => [Number(point.time.toFixed(6)), Number(point.current.toFixed(6))])
}

function attachPolylinePoints(segments: InternalSegment[], points: RawPoint[], globals: Globals, options: CompressionOptions) {
  return segments.map(segment => {
    const slice = points.slice((segment.start_index || 0), (segment.end_index || 0) + 1)
    const polylinePoints = buildPolylinePoints(segment, slice, globals, options)
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

type CompressionRunResult = {
  globals: Globals
  segments: SegmentItem[]
  events: Array<Record<string, unknown>>
}

type OptimizedCompressionResult = {
  options: CompressionMeta
  result: CompressionRunResult
}

function runCompression(points: RawPoint[], options: CompressionOptions): CompressionRunResult {
  const globals = calculateGlobals(points)
  const initialSegments = buildInitialSegments(points, options, globals)
  const mergedSegments = mergeSegments(initialSegments, options, globals)
  const segments = attachPolylinePoints(mergedSegments, points, globals, options) as SegmentItem[]
  return { globals, segments, events: extractEvents(segments as InternalSegment[]) }
}

function optimizeCompressionOptions(points: RawPoint[], baseOptions: CompressionOptions): OptimizedCompressionResult {
  const target = Math.max(10, Number(baseOptions.target_segment_count) || 45)
  const baseResolution = Math.max(baseOptions.absolute_resolution, 0.000001)
  const multipliers = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
  const candidates = multipliers.map(multiplier => {
    const absolute_resolution = Number((baseResolution * multiplier).toPrecision(12))
    const options: CompressionMeta = {
      absolute_resolution,
      relative_resolution: baseOptions.relative_resolution,
      merge_gap_ratio: baseOptions.merge_gap_ratio,
      min_transition_points: baseOptions.min_transition_points,
      target_segment_count: target,
      selected_segment_count: 0,
      selection_reason: null,
      selection_context: null,
    }
    const result = runCompression(points, options)
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

export function runLocalCurrentFeatureAnalysis(rawData: number[][], appConfig: AppConfig | null): FileAnalysisResult {
  const points = rawData
    .filter(point => Array.isArray(point) && point.length >= 2)
    .map(point => [Number(point[0]), Number(point[1])] as RawPoint)
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))

  if (points.length === 0) {
    throw new Error('文件中无有效数据点')
  }

  const sortedPoints = points.slice().sort((left, right) => left[0] - right[0])
  const baseOptions: CompressionOptions = {
    absolute_resolution: appConfig?.absolute_resolution ?? DEFAULT_OPTIONS.absolute_resolution,
    relative_resolution: appConfig?.relative_resolution ?? DEFAULT_OPTIONS.relative_resolution,
    merge_gap_ratio: appConfig?.merge_gap_ratio ?? DEFAULT_OPTIONS.merge_gap_ratio,
    min_transition_points: appConfig?.min_transition_points ?? DEFAULT_OPTIONS.min_transition_points,
    target_segment_count: DEFAULT_OPTIONS.target_segment_count,
  }

  const optimized = optimizeCompressionOptions(sortedPoints, baseOptions)
  const result = optimized.result

  return {
    globals: result.globals,
    segments: result.segments,
    events: result.events,
    compression_meta: optimized.options,
  }
}