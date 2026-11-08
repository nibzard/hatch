/**
 * Tests for the hatch stroke layer: fitted, compact stroke runs (task T036).
 */

import { describe, expect, it } from "vitest";

import type { FillStyle, Texture } from "@hatch/core";
import {
  DRIFT_SHARE,
  WOBBLE_SHARE,
  type HatchSet,
  type HatchStroke,
} from "@hatch/hatching";

import {
  HATCH_FIT_SHARE,
  MIN_HATCH_FIT_TOLERANCE,
  WHOLE_UNIT_TOLERANCE,
  hatchFitTolerance,
  hatchStrokeData,
  hatchStrokeRuns,
} from "../src/strokes.js";

/** A calm texture, so the tolerance a test names is the family's own. */
const CALM: Texture = {
  lineJitter: 0,
  dropout: 0,
  pressureVariance: 0,
  paperNoise: 0,
};

/** One hatch fill of the given jitter, the only field the tolerance reads. */
function hatchOf(jitter: number): FillStyle {
  return { type: "hatch", angle: 0, spacing: 8, stroke: "#3a342e", weight: 0.5, jitter };
}

/** One stroke record around a hand-built polyline. */
function strokeOf(
  points: { x: number; y: number }[],
  weight: number,
): HatchStroke {
  return {
    path: {
      commands: points.map((point, index) => ({
        command: index === 0 ? ("move" as const) : ("line" as const),
        to: point,
      })),
    },
    weight,
    color: "#3a342e",
    family: "a",
    angle: 0,
    spacing: 8,
  };
}

describe("hatchFitTolerance", () => {
  it("returns the minimum for a fill of no strokes", () => {
    expect(hatchFitTolerance({ type: "none" }, CALM)).toBe(
      MIN_HATCH_FIT_TOLERANCE,
    );
  });

  it("scales with the amplitude of the family and the paper jitter", () => {
    const share = HATCH_FIT_SHARE * WOBBLE_SHARE;
    expect(hatchFitTolerance(hatchOf(0.5), CALM)).toBeCloseTo(share * 0.5);
    expect(hatchFitTolerance(hatchOf(1), CALM)).toBeCloseTo(share * 1);
    const grainy: Texture = { ...CALM, lineJitter: 0.2 };
    expect(hatchFitTolerance(hatchOf(1), grainy)).toBeCloseTo(share * 1.2);
    expect(hatchFitTolerance(hatchOf(1), CALM)).toBeGreaterThan(
      hatchFitTolerance(hatchOf(0.5), CALM),
    );
  });

  it("never falls below the minimum", () => {
    expect(hatchFitTolerance(hatchOf(0), CALM)).toBe(MIN_HATCH_FIT_TOLERANCE);
  });
});

describe("hatchStrokeData", () => {
  it("writes whole-unit deltas once the tolerance covers the rounding", () => {
    // A gentle wave of amplitude far below a whole-unit tolerance: the
    // fitted curve keeps its shape and every delta after the opening pair
    // is an integer, because digits below the unit buy nothing.
    const points = [{ x: 0, y: 0 }];
    for (let index = 1; index <= 24; index += 1) {
      points.push({ x: index * 9, y: Math.sin(index / 2) * 0.2 });
    }
    const d = hatchStrokeData(strokeOf(points, 0.5), WHOLE_UNIT_TOLERANCE);
    const firstCommand = d.search(/[a-z]/);
    expect(firstCommand).toBeGreaterThan(0);
    for (const number of d.slice(firstCommand).match(/-?\d+(?:\.\d+)?/g) ?? []) {
      expect(number, `${number} carries a decimal the budget wrote off`).not.toContain(".");
    }
  });

  it("keeps a decimal of delta under a whole-unit tolerance", () => {
    const points = [{ x: 0, y: 0 }];
    for (let index = 1; index <= 12; index += 1) {
      points.push({ x: index * 9, y: Math.sin(index / 2) * 0.2 });
    }
    const d = hatchStrokeData(strokeOf(points, 0.5), MIN_HATCH_FIT_TOLERANCE);
    const firstCommand = d.search(/[a-z]/);
    expect(d.slice(firstCommand)).toMatch(/\.\d/);
  });

  it("renders the same stroke to the same value", () => {
    const points = [{ x: 0, y: 0 }];
    for (let index = 1; index <= 16; index += 1) {
      points.push({ x: index * 7, y: Math.cos(index / 3) * 0.6 });
    }
    const stroke = strokeOf(points, 0.55);
    expect(hatchStrokeData(stroke, 0.6)).toBe(hatchStrokeData(stroke, 0.6));
  });
});

describe("hatchStrokeRuns", () => {
  /** A set of three strokes whose widths round into two groups. */
  function set(): HatchSet {
    return {
      regionId: "sky",
      kind: "hatch",
      zIndex: 0,
      strokes: [
        strokeOf([{ x: 0, y: 0 }, { x: 30, y: 1 }], 0.504),
        strokeOf([{ x: 0, y: 8 }, { x: 30, y: 9 }], 0.497),
        strokeOf([{ x: 0, y: 16 }, { x: 30, y: 17 }], 0.506),
      ],
      droppedStrokeCount: 0,
      strokeLength: 90,
      fillArea: 90,
      density: 1,
    };
  }

  it("groups the strokes whose widths round together", () => {
    const runs = hatchStrokeRuns(set(), MIN_HATCH_FIT_TOLERANCE);
    // 0.497 and 0.504 both round to 0.5; 0.506 rounds to 0.51, so the set
    // holds two runs and the first carries the two strokes that share 0.5.
    expect(runs.map((run) => run.weight)).toEqual([0.5, 0.51]);
  });

  it("orders the runs by the first appearance of their width", () => {
    const mixed: HatchSet = {
      ...set(),
      strokes: [
        strokeOf([{ x: 0, y: 0 }, { x: 30, y: 1 }], 0.61),
        strokeOf([{ x: 0, y: 8 }, { x: 30, y: 9 }], 0.42),
        strokeOf([{ x: 0, y: 16 }, { x: 30, y: 17 }], 0.614),
      ],
    };
    const runs = hatchStrokeRuns(mixed, MIN_HATCH_FIT_TOLERANCE);
    expect(runs.map((run) => run.weight)).toEqual([0.61, 0.42]);
  });

  it("joins the strokes of one run as subpaths in placement order", () => {
    const runs = hatchStrokeRuns(set(), MIN_HATCH_FIT_TOLERANCE);
    // The first run holds the strokes of 0.5 - the first and the second -
    // in the order the engine placed them, and the run of 0.51 holds the
    // third, so each opens where its own first point sits.
    expect(runs[0]!.data.match(/M/g)).toHaveLength(2);
    expect(runs[0]!.data.startsWith("M 0 0")).toBe(true);
    expect(runs[0]!.data).toContain("M 0 8");
    expect(runs[1]!.data).toContain("M 0 16");
  });
});

describe("the tolerance budget", () => {
  it("keeps the fit inside the deviation budget the style granted", () => {
    // The shares of the humanization stage still add up to one budget, and
    // the fit names its share of the same waviness share, so the constant
    // cannot drift away from the engine's vocabulary unnoticed.
    expect(DRIFT_SHARE + WOBBLE_SHARE).toBe(1);
    expect(HATCH_FIT_SHARE).toBeGreaterThan(0);
  });
});
