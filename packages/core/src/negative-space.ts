/**
 * The negative-space model (specification sections 5, 8, 15, and 18).
 *
 * `composition.negativeSpace` states how much of the paper the render keeps
 * free of hatch ink. A field the compiler only stores is a trap: the value
 * enters the spec hash, the hash moves the seeded streams, and the bytes
 * change while the picture stays the same. So this module is the one place
 * that reads the field, the way camera.ts reads the camera controls and
 * environment.ts reads the environment blocks.
 *
 * The value works on ink, not on placement. The paper of a hatched
 * illustration shows between the strokes of every line fill, so the field
 * moderates the density of every hatch and crosshatch fill: an ask above
 * the reference opens the spacing, an ask below tightens it. The stroke
 * weight stays what the style states, because the tone grows lighter
 * without growing thinner - the fog of the atmosphere block is the control
 * that thins ink, and it measures distance, not emptiness.
 *
 * The reference the ask is measured against is the resolved style itself:
 * the `minEmptyAreaRatio` of its composition grammar names the empty share
 * the preset's stated families deliver. A composition that asks exactly
 * the floor renders the preset as written, so the tuned families of every
 * preset stay reachable. The floor is also the threshold specification
 * section 18 names for the planner and the round 3 validator of task T028;
 * the moderation here is the render effect, and it keeps working on both
 * sides of the floor, so the whole range the schema accepts - 0 to 1 -
 * moves the render.
 */

import type { FillStyle } from "./fill.js";
import type { SceneSpec } from "./scene.js";
import type { ResolvedStyleSpec } from "./style.js";

/**
 * How much the hatch spacing moves per unit the ask sits above or below the
 * floor of the style. `1.2` turns one unit of deviation into 120 percent of
 * extra spacing, so each `0.1` of `negativeSpace` moves every spacing by 12
 * percent.
 */
export const NEGATIVE_SPACE_SPACING_GAIN = 1.2;

/**
 * The smallest spacing multiplier the moderation reaches. A style that
 * floors at `1` under an ask of `0` would ask for a closed hatch, so the
 * multiplier clamps here the way `camera.perspectiveStrength` clamps into
 * its band, and the clamp is recorded in the decision.
 */
export const MIN_NEGATIVE_SPACE_SPACING = 0.3;

/** What the composition asked for and what the render does with it. */
export interface NegativeSpaceDecision {
  /** The ratio `composition.negativeSpace` asks for, in [0, 1]. */
  readonly goal: number;
  /** The `minEmptyAreaRatio` of the resolved style, the reference density. */
  readonly floor: number;
  /** The multiplier every hatch spacing carries. `1` at the floor. */
  readonly spacingMultiplier: number;
  /** True when the raw multiplier fell below the minimum and moved. */
  readonly spacingMultiplierClamped: boolean;
}

/** Round one multiplier to a short, stable value, the way fog rounds its share. */
function roundMultiplier(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Round one spacing the same way, so an opened fill stays a short number. */
function roundSpacing(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The spacing multiplier one negative-space ask carries under one style.
 *
 * The multiplier is 1 when the ask meets the floor of the style, grows by
 * {@link NEGATIVE_SPACE_SPACING_GAIN} for every unit above it, and shrinks
 * the same way below it. It never drops under
 * {@link MIN_NEGATIVE_SPACE_SPACING}, so the tightest ask still draws
 * positive spacing.
 */
export function negativeSpaceSpacingMultiplier(
  goal: number,
  floor: number,
): number {
  const raw = 1 + NEGATIVE_SPACE_SPACING_GAIN * (goal - floor);
  return roundMultiplier(Math.max(raw, MIN_NEGATIVE_SPACE_SPACING));
}

/**
 * Read the negative-space ask of one spec against one resolved style.
 *
 * The scene schema bounds the goal to [0, 1] and the style schema bounds
 * the floor the same way, so this never fails; the only move it records is
 * the clamp of the multiplier.
 */
export function negativeSpaceDecisionOf(
  spec: SceneSpec,
  style: ResolvedStyleSpec,
): NegativeSpaceDecision {
  const goal = spec.composition.negativeSpace;
  const floor = style.compositionGrammar.minEmptyAreaRatio;
  const raw = 1 + NEGATIVE_SPACE_SPACING_GAIN * (goal - floor);
  const spacingMultiplier = negativeSpaceSpacingMultiplier(goal, floor);
  return {
    goal,
    floor,
    spacingMultiplier,
    // The rounding of the multiplier leaves float residue on most asks,
    // so a rounded value that differs from the raw one says nothing about
    // the clamp. The flag names the one move the minimum made: true only
    // when the raw multiplier sat below it and the clamp lifted it.
    spacingMultiplierClamped: raw < MIN_NEGATIVE_SPACE_SPACING,
  };
}

/**
 * Open one fill by the multiplier of a negative-space decision.
 *
 * Only the spacing moves: the multiplier of 1 the floor carries returns the
 * fill unchanged, a fill of `none` is paper and carries no spacing, and the
 * weight and the jitter stay what the style states, so an opened hatch
 * reads as the same pen drawn farther apart.
 */
export function openFillStyle(
  fillStyle: FillStyle,
  multiplier: number,
): FillStyle {
  if (multiplier === 1 || fillStyle.type === "none") {
    return fillStyle;
  }
  if (fillStyle.type === "hatch") {
    return { ...fillStyle, spacing: roundSpacing(fillStyle.spacing * multiplier) };
  }
  return {
    ...fillStyle,
    spacingA: roundSpacing(fillStyle.spacingA * multiplier),
    spacingB: roundSpacing(fillStyle.spacingB * multiplier),
  };
}
