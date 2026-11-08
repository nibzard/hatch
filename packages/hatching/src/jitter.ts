/**
 * Humanization of one stroke (specification sections 3E and 17).
 *
 * A purely geometric hatch field reads as machine output. Section 17 lists
 * what breaks that impression: stroke-level jitter, local angle drift,
 * spacing variance, line dropout, ink pressure variance, and paper grain.
 * The style grammar names the knobs in its `texture` block and in the
 * `jitter` field of every hatch family.
 *
 * This module turns those knobs into numbers, through the seeded RNG only.
 * It never calls the global random source of JavaScript, so identical
 * seeds give identical strokes (specification section 10).
 *
 * ## The deviation budget
 *
 * Every humanized stroke keeps one promise: it stays within `amplitude`
 * user units of its ideal line, where
 *
 *     amplitude = family.jitter + texture.lineJitter
 *
 * The zone states its own irregularity and the texture adds the same paper
 * irregularity to every zone. The budget splits into two shares:
 *
 * - 40 percent for angle drift. The drift of one line is bounded so the
 *   rise of the tilted line over half its extent stays inside that share.
 *   A long sky line drifts a fraction of a degree. A short foliage line
 *   drifts several degrees. That matches section 17: sky lines are very
 *   regular, foliage is not.
 * - 60 percent for waviness. Two sine waves carry most of the share. The
 *   paper grain takes `texture.paperNoise` of it at a much shorter
 *   wavelength, which reads as grain dragging the pen.
 *
 * ## Draw order
 *
 * The engine draws random numbers in one fixed order per line: angle
 * drift, then dropout, and for a kept line pressure, the three wave
 * phases, then two end trims per kept piece. The spacing step that leads
 * to the next line closes each line. The order is part of the output
 * contract, so a caller that changes one knob can predict how the stream
 * shifts.
 */

import type { Path, Point, Texture } from "@hatch/core";
import type { SeededRng } from "@hatch/core";

import type { IdealLine } from "./lines.js";
import { angleDirection, normalOf } from "./lines.js";

/** Share of the deviation budget that angle drift may use. */
export const DRIFT_SHARE = 0.4;

/** Share of the deviation budget that waviness may use. */
export const WOBBLE_SHARE = 0.6;

/** Share of the waviness budget the primary wave carries. */
export const PRIMARY_WAVE_SHARE = 0.6;

/** Largest spacing deviation, as a fraction of the spacing. */
export const MAX_SPACING_VARIANCE = 0.3;

/** Largest pressure spread, as a fraction of the stroke weight. */
export const MAX_PRESSURE_SPREAD = 0.95;

/** Shortest primary wavelength the waviness uses, in user units. */
export const MIN_WAVELENGTH = 24;

/** Longest primary wavelength the waviness uses, in user units. */
export const MAX_WAVELENGTH = 96;

/** The primary wavelength is a quarter of the line, inside those bounds. */
export const WAVES_PER_LINE = 4;

/** The secondary wavelength divides the primary one by this factor. */
export const SECOND_WAVE_DIVISOR = 1.7;

/** The grain wavelength divides the primary one by this factor. */
export const GRAIN_WAVE_DIVISOR = 4.3;

/** Sample points per primary wavelength. */
export const SAMPLES_PER_WAVE = 6;

/**
 * Sample points per grain wavelength. The grain wavelength is the shortest
 * of the three, so it sets the sample step. Fewer than two samples per
 * period would alias the grain into the longer waves.
 */
export const SAMPLES_PER_GRAIN_WAVE = 4;

/** Shortest distance between two wave samples, in user units. */
export const MIN_SAMPLE_STEP = 1;

/** The shortest extent a drift is measured against, in user units. */
export const MIN_EXTENT_LENGTH = 1;

/**
 * The irregularity amplitude of one family, in user units. The zone jitter
 * and the paper jitter of the texture add up (specification sections 8 and
 * 17).
 */
export function familyAmplitude(
  familyJitter: number,
  texture: Texture,
): number {
  return familyJitter + texture.lineJitter;
}

/**
 * The angle drift of one line, in degrees.
 *
 * The drift is uniform inside the bound that keeps the rise of the tilted
 * line within the drift share of the budget. A line of `extentLength` user
 * units and amplitude 0 therefore draws a number and still returns 0, so
 * the stream layout stays stable at every amplitude.
 */
export function driftDegrees(
  amplitude: number,
  extentLength: number,
  rng: SeededRng,
): number {
  const safeLength = Math.max(extentLength, MIN_EXTENT_LENGTH);
  const maxRise = DRIFT_SHARE * amplitude;
  const maxRadians = Math.atan((2 * maxRise) / safeLength);
  const drift = (maxRadians * rng.float(-1, 1) * 180) / Math.PI;
  // A zero bound times a negative draw gives negative zero. Emit positive
  // zero, so an exact value stays exact.
  return drift === 0 ? 0 : drift;
}

/**
 * The spacing step from one line to the next, after local spacing variance.
 *
 * The variance grows with the deviation budget over the spacing, because a
 * line that wobbles by `amplitude` units makes the gap it sits in look
 * wider and narrower by about that much. `MAX_SPACING_VARIANCE` caps the
 * effect, so the field stays readable.
 */
export function spacingStep(
  spacing: number,
  amplitude: number,
  rng: SeededRng,
): number {
  const fraction = Math.min(MAX_SPACING_VARIANCE, amplitude / spacing);
  return spacing * (1 + rng.float(-fraction, fraction));
}

/**
 * The stroke width of one line, after ink pressure variance.
 *
 * The spread is clamped, so the result stays positive whatever the preset
 * states. An amplitude of 0 returns the family weight unchanged.
 */
export function pressureWeight(
  weight: number,
  pressureVariance: number,
  rng: SeededRng,
): number {
  const spread = Math.min(Math.max(pressureVariance, 0), MAX_PRESSURE_SPREAD);
  return weight * (1 + rng.float(-spread, spread));
}

/**
 * The undershoot of one stroke end, in user units.
 *
 * Section 17 asks for slight over and under-shoot at boundaries. The engine
 * only under-shoots, because every stroke must stay inside its region. The
 * trim never eats more than a quarter of the piece.
 */
export function endTrim(
  pieceLength: number,
  amplitude: number,
  rng: SeededRng,
): number {
  return rng.float(0, Math.min(amplitude, pieceLength / 4));
}

/** One open path built from `move` and `line` commands only. */
function polyline(points: readonly Point[]): Path {
  const [first, ...rest] = points;
  if (first === undefined) {
    throw new Error("a polyline needs at least one point");
  }
  return {
    commands: [
      { command: "move", to: { x: first.x, y: first.y } },
      ...rest.map((point) => ({
        command: "line" as const,
        to: { x: point.x, y: point.y },
      })),
    ],
  };
}

/** `a + b * t` for points. */
function along(a: Point, b: Point, t: number): Point {
  return { x: a.x + b.x * t, y: a.y + b.y * t };
}

/**
 * Turn one ideal line into a wavy stroke.
 *
 * The stroke is a polyline sampled along the ideal line. Each sample moves
 * by the wave sum, always along the normal of the line, so the stroke never
 * departs from its ideal line by more than the waviness share of the
 * budget. An amplitude of 0 returns the straight ideal line.
 */
export function wavyStroke(
  line: IdealLine,
  amplitude: number,
  paperNoise: number,
  rng: SeededRng,
): Path {
  const direction = angleDirection(line.angleDegrees);
  const normal = normalOf(direction);
  if (amplitude <= 0) {
    return polyline([line.from, line.to]);
  }

  const rawWavelength = line.length / WAVES_PER_LINE;
  const wavelength = Math.min(
    MAX_WAVELENGTH,
    Math.max(MIN_WAVELENGTH, rawWavelength),
  );
  const secondWavelength = wavelength / SECOND_WAVE_DIVISOR;
  const grainWavelength = wavelength / GRAIN_WAVE_DIVISOR;

  // Three phases, one per wave. The draw order is fixed: primary, secondary,
  // grain.
  const primaryPhase = rng.float(0, Math.PI * 2);
  const secondaryPhase = rng.float(0, Math.PI * 2);
  const grainPhase = rng.float(0, Math.PI * 2);

  const budget = WOBBLE_SHARE * amplitude;
  const grainShare = Math.min(Math.max(paperNoise, 0), 1);
  const primaryAmplitude = budget * PRIMARY_WAVE_SHARE * (1 - grainShare);
  const secondaryAmplitude =
    budget * (1 - PRIMARY_WAVE_SHARE) * (1 - grainShare);
  const grainAmplitude = budget * grainShare;

  // The grain wavelength is the shortest, so it drives the sample step.
  // Anything coarser would sample the grain below twice per period and
  // alias it into the longer waves.
  const step = Math.max(
    MIN_SAMPLE_STEP,
    Math.min(wavelength / SAMPLES_PER_WAVE, grainWavelength / SAMPLES_PER_GRAIN_WAVE),
  );
  const points: Point[] = [];
  const sampleCount = Math.ceil(line.length / step);
  for (let index = 0; index <= sampleCount; index += 1) {
    const distance = Math.min(index * step, line.length);
    const wobble =
      primaryAmplitude *
        Math.sin((2 * Math.PI * distance) / wavelength + primaryPhase) +
      secondaryAmplitude *
        Math.sin((2 * Math.PI * distance) / secondWavelength + secondaryPhase) +
      grainAmplitude *
        Math.sin((2 * Math.PI * distance) / grainWavelength + grainPhase);
    const base = along(line.from, direction, distance);
    points.push({
      x: base.x + normal.x * wobble,
      y: base.y + normal.y * wobble,
    });
  }
  return polyline(points);
}

/**
 * Shortest distance between two points.
 */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Remove length from both ends of one open polyline.
 *
 * The stroke pieces the clipper returns are polylines, so this helper walks
 * their `line` commands and moves the end points inward. A path that holds
 * a curve command passes through unchanged, because the walk only measures
 * straight segments. Returns `null` when nothing survives the trim.
 */
export function trimPolylineEnds(
  path: Path,
  trimStart: number,
  trimEnd: number,
): Path | null {
  const points: Point[] = [];
  for (const command of path.commands) {
    if (command.command === "close") {
      continue;
    }
    if (command.command === "curve") {
      return path;
    }
    points.push(command.to);
  }
  if (points.length < 2) {
    return null;
  }

  const work = points.map((point) => ({ ...point }));
  let remaining = Math.max(trimStart, 0);
  let first = 0;
  while (first < work.length - 1 && remaining > 0) {
    const segment = distance(work[first]!, work[first + 1]!);
    if (segment <= remaining) {
      remaining -= segment;
      first += 1;
    } else {
      const reach = remaining / segment;
      work[first] = {
        x: work[first]!.x + (work[first + 1]!.x - work[first]!.x) * reach,
        y: work[first]!.y + (work[first + 1]!.y - work[first]!.y) * reach,
      };
      remaining = 0;
    }
  }

  remaining = Math.max(trimEnd, 0);
  let last = work.length - 1;
  while (last > first && remaining > 0) {
    const segment = distance(work[last - 1]!, work[last]!);
    if (segment <= remaining) {
      remaining -= segment;
      last -= 1;
    } else {
      const reach = remaining / segment;
      work[last] = {
        x: work[last]!.x + (work[last - 1]!.x - work[last]!.x) * reach,
        y: work[last]!.y + (work[last - 1]!.y - work[last]!.y) * reach,
      };
      remaining = 0;
    }
  }

  if (last <= first) {
    return null;
  }
  return polyline(work.slice(first, last + 1));
}
