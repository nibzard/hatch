/**
 * Tests for the negative-space model (task T048).
 *
 * `composition.negativeSpace` is a required field the editor exposes, so
 * the compiler must read it: a value that only changes the spec hash moves
 * the seeded streams while the picture stays the same. These tests pin the
 * number the field moves - the spacing multiplier of every hatch fill - so
 * a field that goes inert fails on an exact value, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_NEGATIVE_SPACE_SPACING,
  NEGATIVE_SPACE_SPACING_GAIN,
  negativeSpaceDecisionOf,
  negativeSpaceSpacingMultiplier,
  openFillStyle,
  planScene,
  type FillStyle,
  type ResolvedStyleSpec,
  type SceneSpec,
} from "../src/index.js";
import { createRng, type SeededRng } from "../src/rng.js";
import { validSceneSpec, validStyleSpec } from "./fixtures.js";

/** The resolved style the planner reads, over the fixture preset. */
function resolvedStyle(): ResolvedStyleSpec {
  return { ...validStyleSpec(), preset: "test-pastoral" } as const;
}

/** One planning stream, reproducible by label. */
function planRng(label: string): SeededRng {
  return createRng(`hatch-negative-space-test:${label}`);
}

/** The fixture spec with one negative-space ask. */
function specWithNegativeSpace(negativeSpace: number): SceneSpec {
  const spec = validSceneSpec();
  return {
    ...spec,
    composition: { ...spec.composition, negativeSpace },
  };
}

/** One hatch fill of the fixture style. */
function hatchFill(spacing: number): FillStyle {
  return {
    type: "hatch",
    angle: 20,
    spacing,
    stroke: "#2f2a26",
    weight: 0.6,
    jitter: 0.4,
  };
}

/** One crosshatch fill of the fixture style. */
function crossHatchFill(spacingA: number, spacingB: number): FillStyle {
  return {
    type: "crosshatch",
    angleA: 45,
    angleB: 135,
    spacingA,
    spacingB,
    stroke: "#2f2a26",
    weight: 0.5,
    jitter: 1.2,
  };
}

describe("negativeSpaceSpacingMultiplier", () => {
  it("is 1 when the ask meets the floor of the style", () => {
    expect(negativeSpaceSpacingMultiplier(0.3, 0.3)).toBe(1);
    expect(negativeSpaceSpacingMultiplier(0, 0)).toBe(1);
    expect(negativeSpaceSpacingMultiplier(1, 1)).toBe(1);
  });

  it("moves one gain of spacing per unit of deviation", () => {
    // The fixture floor is 0.35; the ask 0.95 sits 0.6 above it.
    expect(negativeSpaceSpacingMultiplier(0.95, 0.35)).toBe(
      1 + NEGATIVE_SPACE_SPACING_GAIN * 0.6,
    );
    // The ask 0.05 sits 0.3 under the floor, so the hatch tightens.
    expect(negativeSpaceSpacingMultiplier(0.05, 0.35)).toBe(
      1 - NEGATIVE_SPACE_SPACING_GAIN * 0.3,
    );
  });

  it("grows with the ask over the whole range the schema accepts", () => {
    let previous = -Infinity;
    for (let goal = 0; goal <= 1.0001; goal += 0.05) {
      const multiplier = negativeSpaceSpacingMultiplier(goal, 0.35);
      expect(multiplier).toBeGreaterThan(previous);
      previous = multiplier;
    }
  });

  it("never closes the hatch below the minimum spacing", () => {
    // A style that floors at 1 under an ask of 0 would close the hatch
    // completely, so the multiplier stops at the documented minimum.
    expect(negativeSpaceSpacingMultiplier(0, 1)).toBe(
      MIN_NEGATIVE_SPACE_SPACING,
    );
  });
});

describe("negativeSpaceDecisionOf", () => {
  it("reads the ask of the spec against the floor of the style", () => {
    const spec = specWithNegativeSpace(0.95);
    const style = resolvedStyle();
    expect(negativeSpaceDecisionOf(spec, style)).toEqual({
      goal: 0.95,
      floor: style.compositionGrammar.minEmptyAreaRatio,
      spacingMultiplier: negativeSpaceSpacingMultiplier(
        0.95,
        style.compositionGrammar.minEmptyAreaRatio,
      ),
      spacingMultiplierClamped: false,
    });
  });

  it("records the clamp of an ask the moderation cannot tighten into", () => {
    const spec = specWithNegativeSpace(0);
    const style = {
      ...resolvedStyle(),
      compositionGrammar: {
        ...resolvedStyle().compositionGrammar,
        minEmptyAreaRatio: 1,
      },
    };
    expect(negativeSpaceDecisionOf(spec, style)).toEqual({
      goal: 0,
      floor: 1,
      spacingMultiplier: MIN_NEGATIVE_SPACE_SPACING,
      spacingMultiplierClamped: true,
    });
  });

  it("leaves a below-floor ask unclamped while the moderation has room", () => {
    // The fixture floor is 0.35, so every ask the schema accepts sits at
    // most 0.35 under it and never reaches the minimum: the tightest ask
    // carries a multiplier of 0.58, far above the clamp. The rounding of
    // that multiplier leaves float residue on most of these asks, and the
    // residue must not read as a clamp in the trace.
    const style = resolvedStyle();
    const floor = style.compositionGrammar.minEmptyAreaRatio;
    for (const [goal, multiplier] of [
      [0, 0.58],
      [0.1, 0.7],
      [0.2, 0.82],
    ] as const) {
      const decision = negativeSpaceDecisionOf(
        specWithNegativeSpace(goal),
        style,
      );
      expect(decision).toEqual({
        goal,
        floor,
        spacingMultiplier: multiplier,
        spacingMultiplierClamped: false,
      });
    }
  });

  it("clamps a style that floors high enough to reach the minimum", () => {
    // A floor of 0.75 under an ask of 0 asks for a multiplier of 0.1, so
    // the minimum lifts it and the flag stays true: the fix removed the
    // false positives, not the clamp it reports.
    const spec = specWithNegativeSpace(0);
    const style = {
      ...resolvedStyle(),
      compositionGrammar: {
        ...resolvedStyle().compositionGrammar,
        minEmptyAreaRatio: 0.75,
      },
    };
    expect(negativeSpaceDecisionOf(spec, style)).toEqual({
      goal: 0,
      floor: 0.75,
      spacingMultiplier: MIN_NEGATIVE_SPACE_SPACING,
      spacingMultiplierClamped: true,
    });
  });
});

describe("openFillStyle", () => {
  it("returns the fill unchanged at the multiplier of the floor", () => {
    const fill = hatchFill(6);
    expect(openFillStyle(fill, 1)).toBe(fill);
  });

  it("opens the spacing of a hatch fill and keeps the pen", () => {
    // The weight, the jitter, the angle, and the ink stay what the style
    // states: an opened hatch reads as the same pen drawn farther apart.
    expect(openFillStyle(hatchFill(3.5), 1.72)).toEqual({
      ...hatchFill(3.5),
      spacing: 6.02,
    });
    expect(openFillStyle(hatchFill(7), 0.64)).toEqual({
      ...hatchFill(7),
      spacing: 4.48,
    });
  });

  it("opens both systems of a crosshatch fill", () => {
    expect(openFillStyle(crossHatchFill(4, 6), 1.5)).toEqual({
      ...crossHatchFill(4, 6),
      spacingA: 6,
      spacingB: 9,
    });
  });

  it("leaves paper alone", () => {
    const paper: FillStyle = { type: "none" };
    expect(openFillStyle(paper, 1.72)).toBe(paper);
  });
});

describe("the planning stage carries the decision", () => {
  it("plans the ask of the spec with the floor of the style", () => {
    const spec = specWithNegativeSpace(0.5);
    const style = resolvedStyle();
    const plan = planScene(spec, style, planRng("scene"));
    expect(plan.negativeSpace).toEqual(
      negativeSpaceDecisionOf(spec, style),
    );
  });
});
