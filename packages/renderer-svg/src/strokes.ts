/**
 * The hatch stroke layer of one region (task T036).
 *
 * The hatching engine samples every wavy stroke as a polyline, because the
 * clipper and the end trims work on straight pieces. A full scene holds
 * thousands of those strokes, and a polyline that samples a smooth wave
 * spends one command per sample, which is what pushed one scene past 700 KB
 * of SVG.
 *
 * This module writes the same strokes as cubic curves. The engine's
 * geometry record stays the truth: the renderer fits each stroke one last
 * time, inside a tolerance it derives from the stroke's own deviation
 * budget, so a zone that asks for lively lines keeps its liveliness and a
 * zone that asks for calm lines keeps its calm. The tolerance is
 * {@link HATCH_FIT_SHARE} times the waviness share of the budget, and the
 * emitted deltas round to whole units once the tolerance covers the
 * rounding, so the drawn line stays within about one width of the ink that
 * draws it while the bytes one scene needs drop by an order of magnitude.
 */

import type { FillStyle, Texture } from "@hatch/core";
import { fitCurvePath } from "@hatch/geometry";
import {
  familyAmplitude,
  WOBBLE_SHARE,
  type HatchSet,
  type HatchStroke,
} from "@hatch/hatching";

import { formatNumber } from "./format.js";
import { pathData } from "./path-data.js";

/** Share of a stroke's waviness budget the fitted curve may consume. */
export const HATCH_FIT_SHARE = 1.2;

/**
 * The smallest fit tolerance, in user units. A preset with no jitter at all
 * still fits, and a straight stroke comes back a straight stroke.
 */
export const MIN_HATCH_FIT_TOLERANCE = 0.1;

/**
 * The fit tolerance at which the emitted deltas round to whole units, in
 * user units. Rounding a delta moves the curve it draws by at most about
 * the same amount, so a tolerance of this size already covers the error the
 * rounding adds, and the digits after the decimal point buy nothing.
 */
export const WHOLE_UNIT_TOLERANCE = 0.5;

/**
 * The fit tolerance of one fill style, in user units.
 *
 * The budget is the same one the humanization stage splits between angle
 * drift and waviness, so the tolerance scales with the style rather than
 * with the scene: doubling the jitter of a family doubles the room its
 * fitted curve has.
 */
export function hatchFitTolerance(
  fillStyle: FillStyle,
  texture: Texture,
): number {
  if (fillStyle.type === "none") {
    return MIN_HATCH_FIT_TOLERANCE;
  }
  const amplitude = familyAmplitude(fillStyle.jitter, texture);
  return Math.max(
    MIN_HATCH_FIT_TOLERANCE,
    HATCH_FIT_SHARE * WOBBLE_SHARE * amplitude,
  );
}

/**
 * The `d` value of one hatch stroke.
 *
 * The stroke is fitted inside the tolerance first, then written as relative
 * path data. Deltas round to whole units once the tolerance covers the
 * rounding error, because digits the budget already writes off cost bytes
 * the scene does not have (task T036). Both steps are pure numeric code, so
 * the same stroke always yields the same value (specification section 10).
 */
export function hatchStrokeData(
  stroke: HatchStroke,
  tolerance: number,
): string {
  const decimals = tolerance >= WHOLE_UNIT_TOLERANCE ? 0 : 1;
  return pathData(fitCurvePath(stroke.path, tolerance), decimals);
}

/** The strokes of one region that share one width, as one path value. */
export interface StrokeRun {
  /** The stroke width the whole run draws at. */
  readonly weight: number;
  /** The path data of every stroke of the run, in placement order. */
  readonly data: string;
}

/**
 * Decimal places a stroke width rounds to when it groups into runs. The
 * hatching engine jitters the width of every stroke a little; rounding to
 * hundredths merges the strokes whose widths differ by less than the eye
 * can hold, which turns a field of lines into a handful of path elements.
 */
const WIDTH_DECIMALS = 2;

/** The width one stroke draws at, rounded for grouping. */
function strokeWidthKey(weight: number): string {
  const factor = 10 ** WIDTH_DECIMALS;
  return formatNumber(Math.round(weight * factor) / factor);
}

/**
 * Collect the strokes of one set into runs of one width.
 *
 * One fill style gives every stroke the same ink, so the width a stroke
 * drew at is the only property that separates them. Strokes that share a
 * width share one path element as subpaths, which draws the same pixels -
 * the ink is opaque, and a subpath takes its caps on its own - while one
 * element per stroke would spend its attribute list again for every line of
 * the field (task T036).
 *
 * A run stays in placement order, and the runs keep the order their width
 * first appears in, so a reader walking the document still meets the
 * strokes of a region in a deterministic order.
 */
export function hatchStrokeRuns(
  set: HatchSet,
  tolerance: number,
): StrokeRun[] {
  const order: string[] = [];
  const byWeight = new Map<string, { weight: number; parts: string[] }>();
  for (const stroke of set.strokes) {
    const key = strokeWidthKey(stroke.weight);
    let draft = byWeight.get(key);
    if (draft === undefined) {
      draft = { weight: Number.parseFloat(key), parts: [] };
      byWeight.set(key, draft);
      order.push(key);
    }
    draft.parts.push(hatchStrokeData(stroke, tolerance));
  }
  return order.map((key) => {
    const draft = byWeight.get(key);
    if (draft === undefined) {
      throw new Error(`the stroke width "${key}" disappeared while grouping`);
    }
    return { weight: draft.weight, data: draft.parts.join("") };
  });
}
