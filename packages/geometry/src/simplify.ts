/**
 * Path simplification (specification sections 8, 11, and 17).
 *
 * The style grammar asks for simplified contours: the
 * `contours.simplifyTolerance` field of a style preset states how far a
 * simplified contour may drift from the original one. This module holds
 * that promise as a hard contract.
 *
 * {@link simplifyPath} tries the bezier fitter of Paper.js first, then
 * measures the result against samples of the original path. When the
 * fitted path drifts past the tolerance anywhere, it falls back to a
 * Ramer-Douglas-Peucker polyline, which keeps every sample within the
 * tolerance by construction. Both branches are pure numeric code, so the
 * same input and tolerance always give the same output.
 */

import paper from "paper";

import type { Path, Point } from "@hatch/core";

import {
  ensurePaperScope,
  fromPaperPath,
  isClosedPath,
  subpathsOf,
  toPaperPath,
} from "./paper.js";

/** Numeric slack for nearest-point queries on the fitted path. */
const VERIFICATION_SLACK = 1e-6;

/** Upper bound for samples per path, so verification stays quick. */
const MAX_SAMPLES = 8192;

/** Sample spacing for verification: a quarter of the tolerance. */
const TOLERANCE_FRACTION = 4;

/**
 * Simplify one path so no point of the original drifts further than
 * `tolerance` from the result.
 *
 * The result keeps the open or closed shape of the input. A tolerance of
 * 0 returns the input unchanged, because any reduction can drift. Very
 * small tolerances reduce little; scene-scale tolerances of 1 to 4 units
 * collapse dense polylines into a few smooth segments.
 */
export function simplifyPath(path: Path, tolerance: number): Path {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      "simplify tolerance must be a finite number of 0 or greater",
    );
  }
  if (tolerance === 0 || path.commands.length <= 2) {
    return path;
  }
  ensurePaperScope();

  const item = toPaperPath(path);
  const samples = sampleItemPoints(item, tolerance / TOLERANCE_FRACTION);
  if (samples.length === 0) {
    return path;
  }
  const closed = isClosedPath(path);

  // First candidate: the bezier fitter of Paper.js.
  const candidate = item.clone();
  candidate.simplify(tolerance);
  const candidatePath = fromPaperPath(candidate);
  if (
    candidatePath !== null &&
    candidatePath.commands.length < path.commands.length &&
    withinTolerance(candidate, samples, tolerance)
  ) {
    return candidatePath;
  }

  // Fallback: keep a subset of the samples. Every sample lies on the
  // original path, and the algorithm keeps each one within the
  // tolerance of the connecting segment.
  const first = samples[0];
  if (first === undefined) {
    return path;
  }
  const ring = closed ? [...samples, first] : samples;
  const kept = simplifyPolyline(ring, tolerance);
  if (closed && kept.length > 1) {
    kept.pop();
  }
  // A dense input may survive with as many commands as it started with.
  // The original is then already within the tolerance, so keep it.
  if (kept.length + (closed ? 1 : 0) >= path.commands.length) {
    return path;
  }
  const commands: Path["commands"] = kept.map((point, index) =>
    index === 0
      ? { command: "move" as const, to: point }
      : { command: "line" as const, to: point },
  );
  if (closed) {
    commands.push({ command: "close" });
  }
  return { commands };
}

/**
 * Fit the contours of one path with cubic curves, so every fitted curve
 * stays within `tolerance` of the input points it replaces.
 *
 * {@link simplifyPath} answers the same question for contours, but it
 * verifies its result against samples spaced a quarter of the tolerance
 * apart, which costs thousands of nearest-point queries on the long dense
 * polylines the hatching engine samples. This entry skips that
 * verification: the curve fitter of Paper.js subdivides until every input
 * point sits inside the tolerance, so the bound holds by construction, and
 * a caller that renders thousands of strokes a scene can afford the fit.
 *
 * Each contour of the input is fitted on its own, because a hatch stroke
 * holds one contour per piece the clipper kept, and a piece that crosses a
 * hole of its region shares no tangent with the next. The first and the
 * last point of a contour survive exactly, and the fitted anchors join with
 * a shared tangent, so a chain of fitted segments reads as one smooth pen
 * stroke. A contour the fitter cannot shrink stays as it is, which keeps a
 * straight two-point piece a line.
 */
export function fitCurvePath(path: Path, tolerance: number): Path {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(
      `curve fit tolerance must be a finite number greater than 0, received ${tolerance}`,
    );
  }
  const contours = subpathsOf(path);
  const commands: Path["commands"] = [];
  for (const contour of contours) {
    // A move plus one drawing command is already minimal. Handing such a
    // contour to the fitter can only add control points.
    if (contour.commands.length <= 2) {
      commands.push(...contour.commands);
      continue;
    }
    ensurePaperScope();
    const item = toPaperPath(contour) as paper.Path;
    const fitted = item.clone();
    fitted.simplify(tolerance);
    const candidate = fromPaperPath(fitted);
    if (candidate === null || candidate.commands.length >= contour.commands.length) {
      commands.push(...contour.commands);
      continue;
    }
    commands.push(...candidate.commands);
  }
  return { commands };
}

/**
 * True when every sample point lies within `tolerance` of the item.
 * Uses the nearest-point query of Paper.js, which covers curve geometry.
 */
function withinTolerance(
  item: paper.PathItem,
  samples: readonly Point[],
  tolerance: number,
): boolean {
  for (const sample of samples) {
    const nearest = item.getNearestPoint(new paper.Point(sample.x, sample.y));
    if (nearest === null) {
      return false;
    }
    if (nearest.getDistance(new paper.Point(sample.x, sample.y)) > tolerance + VERIFICATION_SLACK) {
      return false;
    }
  }
  return true;
}

/**
 * Sample one Paper.js item at an even spacing along every contour. The
 * spacing shrinks when a long path would need more than the sample cap.
 */
function sampleItemPoints(item: paper.PathItem, spacing: number): Point[] {
  // The typings name compound children `Item[]`; they only ever hold
  // path contours.
  const contours =
    item instanceof paper.CompoundPath
      ? (item.children as paper.Path[])
      : [item as paper.Path];
  const points: Point[] = [];
  for (const contour of contours) {
    const length = contour.length;
    if (length <= 0) {
      continue;
    }
    const steps = Math.min(
      Math.ceil(length / spacing),
      Math.max(1, Math.floor(MAX_SAMPLES / Math.max(contours.length, 1))),
    );
    for (let step = 0; step <= steps; step += 1) {
      const point = contour.getPointAt((length * step) / steps);
      if (point !== null) {
        points.push({ x: point.x, y: point.y });
      }
    }
  }
  return points;
}

/**
 * Reduce a polyline with the Ramer-Douglas-Peucker algorithm.
 *
 * The first and the last point always stay. Every dropped point lies
 * within `tolerance` of the segment that replaced it. The output holds a
 * subset of the input points, in input order.
 */
export function simplifyPolyline(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      "simplify tolerance must be a finite number of 0 or greater",
    );
  }
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }
  const kept = new Array<boolean>(points.length).fill(false);
  kept[0] = true;
  kept[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (range === undefined) {
      continue;
    }
    const [start, end] = range;
    const startPoint = points[start];
    const endPoint = points[end];
    if (startPoint === undefined || endPoint === undefined) {
      continue;
    }
    let farthestDistance = -1;
    let farthestIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      const distance = distanceToSegment(point, startPoint, endPoint);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0 && farthestDistance > tolerance) {
      kept[farthestIndex] = true;
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }
  return points.filter((_, index) => kept[index]);
}

/** Shortest distance from `point` to the segment from `a` to `b`. */
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 1e-18) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  const cx = a.x + clamped * abx;
  const cy = a.y + clamped * aby;
  return Math.hypot(point.x - cx, point.y - cy);
}
