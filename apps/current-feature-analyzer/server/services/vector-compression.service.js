import logger from '../../../../lib/logger.js';

function perpendicularDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const num = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1);
  const den = Math.sqrt(dx * dx + dy * dy);
  return num / den;
}

function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points;

  const x1 = points[0][0];
  const y1 = points[0][1];
  const x2 = points[points.length - 1][0];
  const y2 = points[points.length - 1][1];

  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i][0], points[i][1], x1, y1, x2, y2);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolutionForCurrent(current, options) {
  return Math.max(options.absolute_resolution, Math.abs(current) * options.relative_resolution);
}

function quantizeCurrent(current, resolution) {
  if (!Number.isFinite(resolution) || resolution <= 0) return current;
  return Math.round(current / resolution) * resolution;
}

function isPlateauKind(kind) {
  return kind === 'plateau-low' || kind === 'plateau-mid' || kind === 'plateau-high';
}

function isTrendKind(kind) {
  return kind === 'rising' || kind === 'rising-fast' || kind === 'falling' || kind === 'falling-fast';
}

function pointLineVerticalError(point, start, end) {
  const duration = end.time - start.time;
  if (duration === 0) {
    return Math.abs(point.current - start.current);
  }

  const ratio = (point.time - start.time) / duration;
  const predicted = start.current + (end.current - start.current) * ratio;
  return Math.abs(point.current - predicted);
}

function simplifyPolyline(points, epsilon) {
  if (points.length <= 2) {
    return points.slice();
  }

  let maxDistance = -1;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];

  for (let index = 1; index < points.length - 1; index++) {
    const distance = pointLineVerticalError(points[index], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (maxDistance <= epsilon || splitIndex === -1) {
    return [start, end];
  }

  const left = simplifyPolyline(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyPolyline(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

class VectorCompressionService {
  constructor(db) {
    this.db = db;
  }

  compress(points, options = {}) {
    const {
      absolute_resolution = 0.03,
      relative_resolution = 0.02,
      merge_gap_ratio = 0.6,
      min_transition_points = 3,
    } = options;

    const timePoints = points.map(p => p[0]);
    const currentPoints = points.map(p => p[1]);

    const minCurrent = Math.min(...currentPoints);
    const maxCurrent = Math.max(...currentPoints);
    const meanCurrent = currentPoints.reduce((a, b) => a + b, 0) / currentPoints.length;
    const sampleInterval = points.length > 1
      ? (timePoints[timePoints.length - 1] - timePoints[0]) / (points.length - 1)
      : 0;

    const baseWindowPoints = points.filter(([t]) => t <= timePoints[0] + 0.5);
    const baselinePoints = baseWindowPoints.length >= 3
      ? baseWindowPoints
      : points.slice(0, Math.min(10, points.length));
    const baselineMean = baselinePoints.length > 0
      ? baselinePoints.reduce((s, p) => s + p[1], 0) / baselinePoints.length
      : meanCurrent;

    const globals = {
      min_current: parseFloat(minCurrent.toFixed(6)),
      max_current: parseFloat(maxCurrent.toFixed(6)),
      mean_current: parseFloat(meanCurrent.toFixed(6)),
      baseline_mean: parseFloat(baselineMean.toFixed(6)),
      sample_interval: parseFloat(sampleInterval.toFixed(6)),
    };

    const normalizedOptions = {
      absolute_resolution,
      relative_resolution,
      merge_gap_ratio,
      min_transition_points,
    };

    logger.info('[current-feature-analyzer] vector compression options', normalizedOptions);

    const initialSegments = this.buildInitialSegments(points, normalizedOptions, globals);
    const mergedSegments = this.mergeSegments(initialSegments, normalizedOptions, globals);
    const segmentsWithPolyline = this.attachPolylinePoints(mergedSegments, points, globals, normalizedOptions);

    return { globals, segments: segmentsWithPolyline, events: this.extractEvents(segmentsWithPolyline) };
  }

  buildInitialSegments(points, options, globals) {
    const segments = [];
    let startIndex = 0;
    let segmentMin = points[0][1];
    let segmentMax = points[0][1];
    let sumCurrent = points[0][1];

    for (let index = 1; index < points.length; index++) {
      const candidate = points[index];
      const candidateCurrent = candidate[1];
      const nextMin = Math.min(segmentMin, candidateCurrent);
      const nextMax = Math.max(segmentMax, candidateCurrent);
      const nextCount = index - startIndex + 1;
      const nextMean = (sumCurrent + candidateCurrent) / nextCount;
      const allowedDelta = resolutionForCurrent(nextMean, options);

      if (nextMax - nextMin <= allowedDelta * 2) {
        segmentMin = nextMin;
        segmentMax = nextMax;
        sumCurrent += candidateCurrent;
        continue;
      }

      segments.push(this.createSegment(points, startIndex, index - 1, globals, options));
      startIndex = index;
      segmentMin = candidateCurrent;
      segmentMax = candidateCurrent;
      sumCurrent = candidateCurrent;
    }

    segments.push(this.createSegment(points, startIndex, points.length - 1, globals, options));
    return segments;
  }

  createSegment(points, startIndex, endIndex, globals, options) {
    const slice = points.slice(startIndex, endIndex + 1);
    const currents = slice.map((point) => point[1]);
    const startTime = slice[0][0];
    const endTime = slice[slice.length - 1][0];
    const duration = Math.max(endTime - startTime, 0);
    const minCurrent = Math.min(...currents);
    const maxCurrent = Math.max(...currents);
    const meanCurrent = average(currents);
    const resolution = resolutionForCurrent(meanCurrent, options);
    const representativeCurrent = quantizeCurrent(meanCurrent, resolution);
    const slope = duration > 0 ? (currents[currents.length - 1] - currents[0]) / duration : 0;
    const bandwidth = maxCurrent - minCurrent;
    const lineFitError = this.calculateLineFitError(slice);

    return {
      start_index: startIndex,
      end_index: endIndex,
      start_time: parseFloat(startTime.toFixed(6)),
      end_time: parseFloat(endTime.toFixed(6)),
      duration: parseFloat(duration.toFixed(6)),
      point_count: slice.length,
      min_current: parseFloat(minCurrent.toFixed(6)),
      max_current: parseFloat(maxCurrent.toFixed(6)),
      mean_current: parseFloat(meanCurrent.toFixed(6)),
      representative_current: parseFloat(representativeCurrent.toFixed(6)),
      bandwidth: parseFloat(bandwidth.toFixed(6)),
      resolution: parseFloat(resolution.toFixed(6)),
      slope: parseFloat(slope.toFixed(6)),
      line_fit_error: parseFloat(lineFitError.toFixed(6)),
      baseline_ratio: parseFloat((meanCurrent / Math.max(globals.baseline_mean, 0.0001)).toFixed(6)),
      kind: this.classifySegmentKind({
        point_count: slice.length,
        bandwidth,
        mean_current: meanCurrent,
        slope,
        line_fit_error: lineFitError,
        globals,
        options,
      }),
    };
  }

  summarizeBucket(bucket, globals, options) {
    const pointCount = bucket.reduce((sum, item) => sum + item.point_count, 0);
    const meanCurrent = bucket.reduce((sum, item) => sum + item.mean_current * item.point_count, 0) / Math.max(pointCount, 1);
    const minCurrent = Math.min(...bucket.map((item) => item.min_current));
    const maxCurrent = Math.max(...bucket.map((item) => item.max_current));
    const startTime = bucket[0].start_time;
    const endTime = bucket[bucket.length - 1].end_time;
    const duration = Math.max(endTime - startTime, 0);
    const resolution = resolutionForCurrent(meanCurrent, options);
    const bandwidth = maxCurrent - minCurrent;
    const slope = duration > 0
      ? (bucket[bucket.length - 1].mean_current - bucket[0].mean_current) / duration
      : 0;
    const lineFitError = bucket.reduce((sum, item) => sum + (item.line_fit_error || 0) * item.point_count, 0) / Math.max(pointCount, 1);

    return {
      start_index: bucket[0].start_index,
      end_index: bucket[bucket.length - 1].end_index,
      start_time: parseFloat(startTime.toFixed(6)),
      end_time: parseFloat(endTime.toFixed(6)),
      duration: parseFloat(duration.toFixed(6)),
      point_count: pointCount,
      min_current: parseFloat(minCurrent.toFixed(6)),
      max_current: parseFloat(maxCurrent.toFixed(6)),
      mean_current: parseFloat(meanCurrent.toFixed(6)),
      representative_current: parseFloat(quantizeCurrent(meanCurrent, resolution).toFixed(6)),
      bandwidth: parseFloat(bandwidth.toFixed(6)),
      resolution: parseFloat(resolution.toFixed(6)),
      slope: parseFloat(slope.toFixed(6)),
      line_fit_error: parseFloat(lineFitError.toFixed(6)),
      baseline_ratio: parseFloat((meanCurrent / Math.max(globals.baseline_mean, 0.0001)).toFixed(6)),
      kind: this.classifySegmentKind({
        point_count: pointCount,
        bandwidth,
        mean_current: meanCurrent,
        slope,
        line_fit_error: lineFitError,
        globals,
        options,
      }),
    };
  }

  canMergeBucket(left, right, options) {
    const allowedGap = Math.max(left.resolution, right.resolution) * (1 + options.merge_gap_ratio);
    const levelGap = Math.abs(left.representative_current - right.representative_current);
    if (left.kind !== right.kind && !(isPlateauKind(left.kind) && isPlateauKind(right.kind))) {
      return false;
    }
    return levelGap <= allowedGap;
  }

  mergeSegments(segments, options, globals) {
    if (segments.length <= 1) {
      return segments.map((segment, index) => ({ ...segment, segment_index: index }));
    }

    const merged = [];
    let bucket = [segments[0]];

    for (let index = 1; index < segments.length; index++) {
      const candidate = segments[index];
      const bucketSummary = this.summarizeBucket(bucket, globals, options);
      if (this.canMergeBucket(bucketSummary, candidate, options)) {
        bucket.push(candidate);
      } else {
        merged.push(this.summarizeBucket(bucket, globals, options));
        bucket = [candidate];
      }
    }

    merged.push(this.summarizeBucket(bucket, globals, options));
    const smoothed = this.mergeShortInteriorSegments(merged, options, globals);
    const trendMerged = this.mergeTrendRuns(smoothed, options, globals);
    return trendMerged.map((segment, index) => ({ ...segment, segment_index: index }));
  }

  mergeShortInteriorSegments(segments, options, globals) {
    if (segments.length <= 2) return segments;
    const result = [];
    let index = 0;
    while (index < segments.length) {
      const current = segments[index];
      const previous = result[result.length - 1];
      const next = segments[index + 1];
      const isShort = current.point_count < options.min_transition_points;

      if (previous && next && isShort && isPlateauKind(previous.kind) && isPlateauKind(next.kind)) {
        const bridgeGap = Math.abs(previous.representative_current - next.representative_current);
        const allowedBridge = Math.max(previous.resolution, next.resolution, current.resolution) * 2.5;
        if (bridgeGap <= allowedBridge) {
          result[result.length - 1] = this.summarizeBucket([previous, current, next], globals, options);
          index += 3;
          continue;
        }
      }

      result.push(current);
      index++;
    }
    return result;
  }

  isTrendCandidate(segment, options, globals, index, segments) {
    if (isTrendKind(segment.kind)) return true;
    const tinySegment = segment.point_count <= Math.max(3, options.min_transition_points);
    if (!tinySegment) return false;
    const previous = segments[index - 1];
    const next = segments[index + 1];
    const hasDifferentNeighbors = previous && next && previous.representative_current !== next.representative_current;
    return segment.mean_current >= globals.baseline_mean * 2 && hasDifferentNeighbors;
  }

  mergeTrendRuns(segments, options, globals) {
    if (segments.length <= 2) return segments;
    const merged = [];
    let index = 0;

    while (index < segments.length) {
      const current = segments[index];
      if (!this.isTrendCandidate(current, options, globals, index, segments)) {
        merged.push(current);
        index++;
        continue;
      }

      const bucket = [current];
      let nextIndex = index + 1;
      let direction = 0;

      while (nextIndex < segments.length) {
        const candidate = segments[nextIndex];
        if (!this.isTrendCandidate(candidate, options, globals, nextIndex, segments)) {
          break;
        }

        const delta = candidate.representative_current - bucket[bucket.length - 1].representative_current;
        const candidateDirection = Math.sign(delta);
        if (candidateDirection === 0) break;
        if (direction === 0) direction = candidateDirection;
        if (candidateDirection !== direction) break;

        const allowedGap = Math.max(candidate.resolution, bucket[bucket.length - 1].resolution) * 12;
        if (Math.abs(delta) > allowedGap) break;

        bucket.push(candidate);
        nextIndex++;
      }

      if (bucket.length > 1 && direction !== 0) {
        const combined = this.summarizeBucket(bucket, globals, options);
        combined.kind = direction > 0 ? 'rising' : 'falling';
        if (Math.abs(combined.slope) / Math.max(combined.mean_current, globals.baseline_mean, 0.0001) >= 8) {
          combined.kind = direction > 0 ? 'rising-fast' : 'falling-fast';
        }
        merged.push(combined);
        index = nextIndex;
      } else {
        merged.push(current);
        index++;
      }
    }

    return merged;
  }

  classifySegmentKind(input) {
    const resolution = resolutionForCurrent(input.mean_current, input.options);
    const normalizedBandwidth = input.bandwidth / Math.max(resolution, 0.0001);
    const normalizedSlope = input.slope / Math.max(input.mean_current, input.globals.baseline_mean, 0.0001);
    const normalizedFitError = (input.line_fit_error || 0) / Math.max(resolution, 0.0001);

    if (
      input.point_count <= Math.max(2, input.options.min_transition_points - 1)
      && input.mean_current >= input.globals.baseline_mean * 4
      && normalizedBandwidth <= 2.5
    ) {
      return 'transition';
    }
    if (normalizedBandwidth <= 1.25 && normalizedFitError <= 0.8) {
      if (input.mean_current <= input.globals.baseline_mean * 1.5) return 'plateau-low';
      if (input.mean_current >= input.globals.baseline_mean * 6) return 'plateau-high';
      return 'plateau-mid';
    }
    if (
      input.point_count <= Math.max(3, input.options.min_transition_points)
      && input.mean_current >= input.globals.baseline_mean * 5
    ) {
      return 'spike';
    }
    if (normalizedSlope >= 8) return 'rising-fast';
    if (normalizedSlope >= 1.2) return 'rising';
    if (normalizedSlope <= -8) return 'falling-fast';
    if (normalizedSlope <= -1.2) return 'falling';
    if (normalizedBandwidth >= 12 && input.mean_current >= input.globals.baseline_mean * 4) return 'burst';
    return 'transition';
  }

  extractEvents(segments) {
    const events = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (segment.kind === 'spike' || segment.kind === 'burst') {
        events.push({ type: segment.kind, time: segment.start_time, segment_index: index });
      }
    }
    return events;
  }

  buildPolylinePoints(segment, slice, globals, options) {
    if (!slice.length) {
      return [];
    }

    if (isPlateauKind(segment.kind)) {
      return [
        [segment.start_time, segment.representative_current],
        [segment.end_time, segment.representative_current],
      ];
    }

    const epsilon = Math.max(resolutionForCurrent(segment.mean_current, options), globals.baseline_mean * 0.01);
    const pointObjects = slice.map(([time, current]) => ({ time, current }));
    const simplified = simplifyPolyline(pointObjects, epsilon);
    if (simplified.length === 1) {
      return [
        [simplified[0].time, simplified[0].current],
        [simplified[0].time, simplified[0].current],
      ];
    }

    return simplified.map((point) => [point.time, point.current]);
  }

  attachPolylinePoints(segments, points, globals, options) {
    return segments.map((segment) => {
      const slice = points.slice(segment.start_index, segment.end_index + 1);
      const polylinePoints = this.buildPolylinePoints(segment, slice, globals, options);
      return {
        ...segment,
        polyline_points: polylinePoints,
        polyline_point_count: polylinePoints.length,
      };
    });
  }

  calculateLineFitError(points) {
    if (points.length <= 2) return 0;
    const start = { time: points[0][0], current: points[0][1] };
    const end = { time: points[points.length - 1][0], current: points[points.length - 1][1] };
    const duration = end.time - start.time;
    if (duration <= 0) return 0;
    let maxResidual = 0;
    for (const [time, current] of points) {
      const ratio = (time - start.time) / duration;
      const predicted = start.current + (end.current - start.current) * ratio;
      maxResidual = Math.max(maxResidual, Math.abs(current - predicted));
    }
    return maxResidual;
  }
}

export default VectorCompressionService;
