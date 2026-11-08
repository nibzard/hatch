/**
 * Contour humanization (specification sections 4D, 8, and 17).
 *
 * A contour drawn straight from its generator reads as machine output.
 * Section 17 asks for micro-imperfections applied systematically, with
 * parameters, and the style grammar carries the knob: `contours.wobble`
 * states how far a contour stroke may drift from its ideal path.
 *
 * {@link wobbleContour} turns one path into one polyline stroke that never
 * leaves that budget. The wave model mirrors the hatch strokes of
 * @hatch/hatching: a primary wave, a secondary wave at a shorter wavelength,
 * and a grain wave that carries the paper noise share. Every phase comes
 * from the seeded stream, so the same stream wobbles the identical contour.
 *
 * The module lives in @hatch/core because the style application stage, which
 * owns contour drawing, runs here: it needs no Paper.js geometry, only path
 * sampling and point math.
 */

import type { Path, Point } from "./path.js";
import type { SeededRng } from "./rng.js";
import type { Texture } from "./style.js";

/** Share of the wobble budget the primary wave carries. */
export const PRIMARY_WAVE_SHARE = 0.6;

/** The secondary wavelength divides the primary one by this factor. */
export const SECOND_WAVE_DIVISOR = 1.7;

/** The grain wavelength divides the primary one by this factor. */
export const GRAIN_WAVE_DIVISOR = 4.3;

/** Waves per contour: the primary wavelength is a quarter of the length. */
export const WAVES_PER_CONTOUR = 4;

/** Shortest primary wavelength, in user units. */
export const MIN_WAVELENGTH = 24;

/** Longest primary wavelength, in user units. */
export const MAX_WAVELENGTH = 96;

/** Sample points per primary wavelength. */
export const SAMPLES_PER_WAVE = 6;

/** Sub-samples per curve command, so a bezier renders as a smooth run. */
export const CURVE_SUBSAMPLES = 6;

/** One sampled point of a contour, with its arc length from the start. */
export interface ContourSample {
  /** The point position, in scene units. */
  readonly point: Point;
  /** The arc length at the point, from the start of the contour. */
  readonly distance: number;
}

/** One point of a cubic bezier at parameter `t`. */
function cubicAt(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  t: number,
): Point {
  const oneMinus = 1 - t;
  const weight0 = oneMinus * oneMinus * oneMinus;
  const weight1 = 3 * oneMinus * oneMinus * t;
  const weight2 = 3 * oneMinus * t * t;
  const weight3 = t * t * t;
  return {
    x:
      from.x * weight0 +
      control1.x * weight1 +
      control2.x * weight2 +
      to.x * weight3,
    y:
      from.y * weight0 +
      control1.y * weight1 +
      control2.y * weight2 +
      to.y * weight3,
  };
}

/**
 * Walk one path into a polyline plus its arc lengths.
 *
 * Curve commands subdivide into `CURVE_SUBSAMPLES` straight runs, which
 * keeps the shape within a fraction of a user unit of the true curve at
 * scene scale. A closed path returns with its first point repeated at the
 * end, so the walk covers the closing edge too.
 */
export function sampleContour(path: Path): {
  samples: ContourSample[];
  closed: boolean;
} {
  const points: Point[] = [];
  let closed = false;
  for (const command of path.commands) {
    if (command.command === "close") {
      closed = true;
      continue;
    }
    if (command.command === "curve") {
      const from = points[points.length - 1];
      if (from === undefined) {
        points.push(command.to);
        continue;
      }
      for (let step = 1; step <= CURVE_SUBSAMPLES; step += 1) {
        points.push(
          cubicAt(
            from,
            command.control1,
            command.control2,
            command.to,
            step / CURVE_SUBSAMPLES,
          ),
        );
      }
      continue;
    }
    points.push(command.to);
  }
  if (closed && points.length > 0) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) {
      points.push({ ...first });
    }
  }

  const samples: ContourSample[] = [];
  let distance = 0;
  let previous: Point | undefined;
  for (const point of points) {
    if (previous !== undefined) {
      distance += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    samples.push({ point, distance });
    previous = point;
  }
  return { samples, closed };
}

/** Interpolate one point at `reach` of the way from `from` to `to`. */
function between(from: Point, to: Point, reach: number): Point {
  return {
    x: from.x + (to.x - from.x) * reach,
    y: from.y + (to.y - from.y) * reach,
  };
}

/**
 * Resample one walked contour at a fixed arc-length step.
 *
 * The waves read as waves only when their samples sit at even distances, so
 * the displacement pass works on this even grid rather than on the raw walk,
 * whose points bunch up wherever the source path holds many short segments.
 * The grid always runs from arc length 0 to the full length, both included.
 */
export function resampleContour(
  samples: readonly ContourSample[],
  step: number,
): ContourSample[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    return [...samples];
  }
  const length = last.distance;
  if (!(length > 0) || !(step > 0)) {
    return [...samples];
  }

  const resampled: ContourSample[] = [];
  let segment = 0;
  for (let target = 0; ; target += step) {
    const distance = Math.min(target, length);
    while (
      segment + 1 < samples.length &&
      samples[segment + 1]!.distance < distance
    ) {
      segment += 1;
    }
    const left = samples[segment]!;
    const right = samples[segment + 1] ?? left;
    const span = right.distance - left.distance;
    const reach = span <= 0 ? 0 : (distance - left.distance) / span;
    resampled.push({ point: between(left.point, right.point, reach), distance });
    if (distance >= length) {
      return resampled;
    }
  }
}

/**
 * The wavelength a closed contour uses: the ideal wavelength, rounded to the
 * nearest value that divides the contour length.
 *
 * A wave whose wavelength divides the length returns to its starting value
 * where the loop closes, so a closed contour closes without a kink.
 */
function closedWavelength(ideal: number, length: number): number {
  const cycles = Math.max(1, Math.round(length / ideal));
  return length / cycles;
}

/** One open path built from `move` and `line` commands only. */
function polyline(points: readonly Point[], closed: boolean): Path {
  const [first, ...rest] = points;
  if (first === undefined) {
    throw new Error("a polyline needs at least one point");
  }
  return {
    commands: [
      { command: "move", to: first },
      ...rest.map((point) => ({ command: "line" as const, to: point })),
      ...(closed ? [{ command: "close" as const }] : []),
    ],
  };
}

/**
 * Humanize one contour stroke.
 *
 * The result is one polyline of `move` and `line` commands, closed with a
 * `close` command when the input closed. Every point stays within
 * `amplitude` user units of the sampled original, because the three wave
 * amplitudes add up to at most `amplitude`. An amplitude of 0 returns the
 * input unchanged and draws nothing, so a style without wobble leaves the
 * stream layout of the stage untouched.
 */
export function wobbleContour(
  path: Path,
  amplitude: number,
  texture: Texture,
  rng: SeededRng,
): Path {
  if (!(amplitude > 0)) {
    return path;
  }
  const { samples, closed } = sampleContour(path);
  const last = samples[samples.length - 1];
  if (samples.length < 2 || last === undefined) {
    return path;
  }
  const length = last.distance;
  if (!(length > 0)) {
    return path;
  }

  const idealWavelength = Math.min(
    MAX_WAVELENGTH,
    Math.max(MIN_WAVELENGTH, length / WAVES_PER_CONTOUR),
  );
  const wavelength = closed
    ? closedWavelength(idealWavelength, length)
    : idealWavelength;
  const secondWavelength = wavelength / SECOND_WAVE_DIVISOR;
  const grainWavelength = wavelength / GRAIN_WAVE_DIVISOR;

  // Three phases, one per wave, in the same fixed order the hatch strokes
  // draw theirs: primary, secondary, grain.
  const primaryPhase = rng.float(0, Math.PI * 2);
  const secondaryPhase = rng.float(0, Math.PI * 2);
  const grainPhase = rng.float(0, Math.PI * 2);

  const grainShare = Math.min(Math.max(texture.paperNoise, 0), 1);
  const primaryAmplitude = amplitude * PRIMARY_WAVE_SHARE * (1 - grainShare);
  const secondaryAmplitude =
    amplitude * (1 - PRIMARY_WAVE_SHARE) * (1 - grainShare);
  const grainAmplitude = amplitude * grainShare;

  // The grain wavelength is the shortest, so it drives the sample step.
  // Anything coarser would sample the grain below twice per period and
  // alias it into the longer waves.
  const step = Math.max(
    1,
    Math.min(wavelength / SAMPLES_PER_WAVE, grainWavelength / 2),
  );
  const grid = resampleContour(samples, step);

  const displaced: Point[] = [];
  for (let index = 0; index < grid.length; index += 1) {
    const sample = grid[index]!;
    const previous = grid[index - 1];
    const next = grid[index + 1];
    const from = previous?.point ?? sample.point;
    const to = next?.point ?? sample.point;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const norm = Math.hypot(dx, dy);
    const tangent =
      norm > 1e-9 ? { x: dx / norm, y: dy / norm } : { x: 1, y: 0 };
    const wobble =
      primaryAmplitude *
        Math.sin((2 * Math.PI * sample.distance) / wavelength + primaryPhase) +
      secondaryAmplitude *
        Math.sin(
          (2 * Math.PI * sample.distance) / secondWavelength + secondaryPhase,
        ) +
      grainAmplitude *
        Math.sin((2 * Math.PI * sample.distance) / grainWavelength + grainPhase);
    displaced.push({
      x: sample.point.x - tangent.y * wobble,
      y: sample.point.y + tangent.x * wobble,
    });
  }

  // The primary wavelength divides the length of a closed contour, so its
  // wave meets itself where the loop closes. The two shorter waves need
  // not, so the closing point is pinned to the start point: the closing
  // edge stays exact.
  if (closed && displaced.length > 1) {
    displaced[displaced.length - 1] = { ...displaced[0]! };
  }
  return polyline(displaced, closed);
}
