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

    const currentRange = maxCurrent - minCurrent || 1;
    const segments = this.buildSegments(
      points, globals, absolute_resolution, relative_resolution,
      merge_gap_ratio, min_transition_points, currentRange
    );

    const mergedSegments = this.mergeSegmentsWithPolyline(
      segments, points, absolute_resolution, relative_resolution, currentRange
    );

    return { globals, segments: mergedSegments, events: [] };
  }

  buildSegments(points, globals, absRes, relRes, mergeGapRatio, minTransPoints, currentRange) {
    const segments = [];
    const epsilon = Math.max(absRes, relRes * currentRange);
    let segStart = 0;
    let segMin = points[0][1];
    let segMax = points[0][1];
    let segSum = 0;

    for (let i = 0; i < points.length; i++) {
      const [t, c] = points[i];
      if (c < segMin) segMin = c;
      if (c > segMax) segMax = c;
      segSum += c;

      const bandwidth = segMax - segMin + 1e-12;
      if (bandwidth > epsilon) {
        const segEnd = Math.max(i - 1, segStart);
        this.finalizeSegment(segments, points, segStart, segEnd, globals, currentRange);
        segStart = i;
        segMin = c;
        segMax = c;
        segSum = c;
      }
    }

    if (segStart < points.length) {
      const segEnd = points.length - 1;
      const finalBandwidth = segMax - segMin + 1e-12;
      if (finalBandwidth <= epsilon || segEnd - segStart < minTransPoints) {
        if (segments.length > 0) {
          const lastSeg = segments[segments.length - 1];
          lastSeg.end_index = segEnd;
          lastSeg.end_time = points[segEnd][0];
          lastSeg.duration = lastSeg.end_time - lastSeg.start_time;
          const allPoints = points.slice(lastSeg.start_index, segEnd + 1);
          const allCurrents = allPoints.map(p => p[1]);
          lastSeg.point_count = allPoints.length;
          lastSeg.min_current = Math.min(...allCurrents);
          lastSeg.max_current = Math.max(...allCurrents);
          lastSeg.mean_current = allCurrents.reduce((a, b) => a + b, 0) / allCurrents.length;
          lastSeg.bandwidth = lastSeg.max_current - lastSeg.min_current;
          lastSeg.baseline_ratio = globals.baseline_mean > 0
            ? parseFloat((lastSeg.mean_current / globals.baseline_mean).toFixed(6))
            : 0;
          lastSeg.kind = this.classifySegment(lastSeg);
        }
      } else {
        this.finalizeSegment(segments, points, segStart, segEnd, globals, currentRange);
      }
    }

    return segments;
  }

  finalizeSegment(segments, points, start, end, globals, currentRange) {
    if (start >= points.length) return;
    const segPoints = points.slice(start, end + 1);
    if (segPoints.length === 0) return;

    const currents = segPoints.map(p => p[1]);
    const minCur = Math.min(...currents);
    const maxCur = Math.max(...currents);
    const meanCur = currents.reduce((a, b) => a + b, 0) / currents.length;
    const n = segPoints.length;

    const sx = segPoints[0][0];
    const sy = segPoints[0][1];
    const ex = segPoints[n - 1][0];
    const ey = segPoints[n - 1][1];
    const duration = ex - sx;

    const baselineRatio = globals.baseline_mean > 0
      ? parseFloat((meanCur / globals.baseline_mean).toFixed(6))
      : 0;

    const dx = ex - sx;
    const slope = dx > 0 ? (ey - sy) / dx : 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const [x, y] of segPoints) {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denom = n * sumX2 - sumX * sumX;
    const lineFitError = denom !== 0
      ? (() => {
          const a = (n * sumXY - sumX * sumY) / denom;
          const b = (sumY - a * sumX) / n;
          let sse = 0;
          for (const [x, y] of segPoints) {
            const pred = a * x + b;
            sse += (y - pred) * (y - pred);
          }
          return Math.sqrt(sse / n);
        })()
      : 0;

    const seg = {
      segment_index: segments.length,
      start_index: start,
      end_index: end,
      start_time: parseFloat(sx.toFixed(6)),
      end_time: parseFloat(ex.toFixed(6)),
      duration: parseFloat(duration.toFixed(6)),
      point_count: n,
      min_current: parseFloat(minCur.toFixed(6)),
      max_current: parseFloat(maxCur.toFixed(6)),
      mean_current: parseFloat(meanCur.toFixed(6)),
      representative_current: parseFloat(parseFloat(((minCur + maxCur + meanCur) / 3).toFixed(6))),
      bandwidth: parseFloat((maxCur - minCur).toFixed(6)),
      baseline_ratio: baselineRatio,
      slope: parseFloat(slope.toFixed(6)),
      line_fit_error: parseFloat(lineFitError.toFixed(6)),
      kind: null,
      polyline_points: null,
    };

    seg.kind = this.classifySegment(seg);
    segments.push(seg);
  }

  classifySegment(seg) {
    const bw = seg.bandwidth;
    const dur = seg.duration;
    if (bw < 0.005 && dur > 0.5) return 'stable';
    if (seg.slope > 1.0 && dur < 5) return 'spike';
    if (seg.slope < -1.0 && dur < 5) return 'drop';
    if (Math.abs(seg.slope) > 0.1) return 'transition';
    if (seg.baseline_ratio < 0.1) return 'off';
    if (seg.baseline_ratio > 2.0) return 'surge';
    return 'normal';
  }

  mergeSegmentsWithPolyline(segments, points, absRes, relRes, currentRange) {
    if (segments.length <= 1) return segments;
    const epsilon = Math.max(absRes, relRes * currentRange);
    const merged = [segments[0]];

    for (let i = 1; i < segments.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = segments[i];
      const gap = curr.start_time - prev.end_time;
      const avgDur = (prev.duration + curr.duration) / 2 || 1;
      const kindSame = prev.kind === curr.kind;
      const gapSmall = gap < avgDur * 0.6;

      if (kindSame && gapSmall) {
        const mergedStart = prev.start_index;
        const mergedEnd = curr.end_index;
        const mergedPoints = points.slice(mergedStart, mergedEnd + 1);
        const polylinePoints = douglasPeucker(mergedPoints, epsilon);

        prev.end_index = mergedEnd;
        prev.end_time = curr.end_time;
        prev.duration = prev.end_time - prev.start_time;
        prev.point_count = mergedPoints.length;
        const currents = mergedPoints.map(p => p[1]);
        prev.min_current = Math.min(...currents);
        prev.max_current = Math.max(...currents);
        prev.mean_current = currents.reduce((a, b) => a + b, 0) / currents.length;
        prev.bandwidth = prev.max_current - prev.min_current;
        prev.polyline_points = polylinePoints;
        prev.kind = this.classifySegment(prev);
      } else {
        const currPoints = points.slice(curr.start_index, curr.end_index + 1);
        curr.polyline_points = douglasPeucker(currPoints, epsilon);
        merged.push(curr);
      }
    }

    for (const seg of merged) {
      if (!seg.polyline_points) {
        const segPoints = points.slice(seg.start_index, seg.end_index + 1);
        seg.polyline_points = douglasPeucker(segPoints, epsilon);
      }
    }

    return merged;
  }
}

export default VectorCompressionService;
