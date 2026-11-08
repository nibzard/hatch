/**
 * The object grammar model (specification sections 3C, 8, and 18).
 *
 * `objectGrammar` states how much detail an object of this style may carry:
 * how abstract it reads, how many detail marks survive, how round its edges
 * draw, and whether it keeps openings as paper. A preset the compiler only
 * stores is a trap: the section would enter the spec hash, the hash would
 * move the seeded streams, and the bytes would change while the picture
 * stayed the same. So this module is the one place that reads the section,
 * the way camera.ts reads the camera controls and negative-space.ts reads
 * the empty-share ask.
 *
 * Two of the fields share one decision, the way the negative-space ask and
 * its floor share one multiplier:
 *
 * - `abstractionLevel` (0 to 1) states how far the style abstracts an
 *   object. 0 keeps every mark the generator drew, 1 abstracts the object
 *   to its silhouette alone.
 * - `maxDetailPerObject` is the ceiling: the number of marks an object may
 *   carry at abstraction 0, whatever its parameters ask for.
 *
 * Together they fix the detail budget: the number of internal boundaries
 * the geometry synthesis stage keeps. The budget formula rounds to the
 * nearest mark, so a preset that states a mid level keeps a mid count
 * instead of a floor. The other two fields act directly:
 *
 * - `edgeRoundnessBias` (0 to 1) becomes the corner-rounding share of the
 *   geometry stage: the share of the shorter adjacent segment every corner
 *   of an object cuts into a curve. 0 leaves every corner as drawn.
 * - `keepNegativeSpace` decides whether openings stay paper: when it is
 *   false, the wall of a house fills across its windows and the style
 *   application stage drops the cloud cutouts, so the paper the scene kept
 *   is hatched over instead.
 *
 * The planner records the decision of this module in the plan
 * (specification section 18: the style-constrained planner knows what
 * level of detail is acceptable), the geometry synthesis stage enforces
 * the budget and the rounding and reports what the budget dropped
 * (specification section 9B), and the style application stage reads the
 * negative-space answer back from the plan.
 */

import type { ObjectGrammar, ResolvedStyleSpec } from "./style.js";

/**
 * The share of the shorter adjacent segment one corner cuts at bias 1. The
 * half keeps two neighbouring corners from cutting into the same segment
 * past its midpoint, so the rounding never folds a segment back on itself.
 */
export const EDGE_ROUNDNESS_SHARE_GAIN = 0.5;

/** What the object grammar of one style decides for every object. */
export interface ObjectGrammarDecision {
  /** The `abstractionLevel` of the style, in [0, 1]. */
  readonly abstractionLevel: number;
  /** The `maxDetailPerObject` ceiling of the style. */
  readonly maxDetailPerObject: number;
  /** The `edgeRoundnessBias` of the style, in [0, 1]. */
  readonly edgeRoundnessBias: number;
  /** Whether openings and cutouts stay paper. */
  readonly keepNegativeSpace: boolean;
  /**
   * How many internal boundaries one object keeps. The geometry synthesis
   * stage drops every boundary beyond it, in emission order, because every
   * shipped generator emits its structural boundaries first and its detail
   * marks after them.
   */
  readonly detailBudget: number;
}

/**
 * The detail budget one object grammar allows.
 *
 * `maxDetailPerObject` at abstraction 0, none at abstraction 1, rounded to
 * the nearest mark between them. A grammar with a ceiling of 0 allows no
 * mark whatever its level states.
 */
export function detailBudgetOf(grammar: ObjectGrammar): number {
  const budget = Math.round(
    grammar.maxDetailPerObject * (1 - grammar.abstractionLevel),
  );
  return Math.min(Math.max(budget, 0), grammar.maxDetailPerObject);
}

/**
 * The corner-rounding share one edge-roundness bias carries.
 *
 * The bias runs 0 to 1 and the share 0 to
 * {@link EDGE_ROUNDNESS_SHARE_GAIN}, so the roundest style still cuts no
 * corner past the midpoint of its shorter adjacent segment.
 */
export function edgeRoundnessShare(edgeRoundnessBias: number): number {
  const bias = Math.min(Math.max(edgeRoundnessBias, 0), 1);
  return Math.round(bias * EDGE_ROUNDNESS_SHARE_GAIN * 10000) / 10000;
}

/**
 * Read the object grammar of one resolved style into one decision.
 *
 * The style schema already bounds every field, so this never fails and
 * records no clamping of its own.
 */
export function objectGrammarDecisionOf(
  style: ResolvedStyleSpec,
): ObjectGrammarDecision {
  const grammar = style.objectGrammar;
  return {
    abstractionLevel: grammar.abstractionLevel,
    maxDetailPerObject: grammar.maxDetailPerObject,
    edgeRoundnessBias: grammar.edgeRoundnessBias,
    keepNegativeSpace: grammar.keepNegativeSpace,
    detailBudget: detailBudgetOf(grammar),
  };
}

/**
 * What one object grammar did to the internal boundaries of one object
 * (specification section 9B: what was omitted due to style simplification).
 *
 * The planning event states the grammar every object shares. This record
 * states what that grammar cost one object: how many internal boundaries its
 * generator emitted, how many survived the detail budget, and how many the
 * style simplified away. The geometry synthesis stage reads it from the
 * object source beside the geometry it returns, so the omission a reader
 * could only guess from a budget number sits in the trace as a count.
 */
export interface ObjectGrammarDetail {
  /** The detail budget of the grammar that governed the object. */
  readonly detailBudget: number;
  /** The internal boundaries the generator emitted before the grammar ran. */
  readonly emittedInternalBoundaries: number;
  /** The internal boundaries the grammar kept. */
  readonly keptInternalBoundaries: number;
  /** The internal boundaries the grammar dropped: the emitted minus the kept. */
  readonly droppedInternalBoundaries: number;
}

/**
 * Read one emission into one detail record.
 *
 * The source states both counts, because a grammar may drop marks in more
 * places than the budget: a generator that reads the grammar itself can
 * leave marks out before the shared pass runs. The dropped count clamps at
 * zero, so a source that keeps more than it emitted records no omission.
 */
export function objectGrammarDetailOf(
  emittedInternalBoundaries: number,
  keptInternalBoundaries: number,
  detailBudget: number,
): ObjectGrammarDetail {
  return {
    detailBudget,
    emittedInternalBoundaries,
    keptInternalBoundaries,
    droppedInternalBoundaries: Math.max(
      0,
      emittedInternalBoundaries - keptInternalBoundaries,
    ),
  };
}
