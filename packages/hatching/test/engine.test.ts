/**
 * Acceptance tests for the region hatching engine.
 *
 * The three acceptance criteria of task T013, as tests:
 * 1. all stroke geometry stays inside its region;
 * 2. density rises when spacing falls;
 * 3. identical seeds produce identical stroke sets.
 */

import { describe, expect, it } from "vitest";

import type { Path, Region } from "@hatch/core";
import {
  pathLength,
  splineThroughPoints,
  subpathsOf,
  subtractMasks,
} from "@hatch/geometry";

import { hatchRegion, hatchRegions } from "../src/index.js";

import {
  circlePath,
  circleRegion,
  crossHatchFill,
  hatchFill,
  hatchStyle,
  livelyTexture,
  maxDriftDegrees,
  maxHorizontalDeparture,
  pointsStayInside,
  rectPath,
  rectRegion,
  setPoints,
  startY,
  stillTexture,
  strokePoints,
  testRng,
} from "./fixtures.js";

/** A rectangular region that leaves room for jitter on every side. */
function plainField(spacing: number): Region {
  return rectRegion("field", 20, 20, 200, 120, hatchFill({ spacing }));
}

describe("acceptance: stroke geometry stays inside its region", () => {
  it("keeps a jittered hatch field inside a rectangle", () => {
    const region = rectRegion("sky", 0, 0, 220, 140, hatchFill({ angle: 30 }), {
      role: "sky",
    });
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("inside-rect"));
    expect(set.strokes.length).toBeGreaterThan(0);
    expect(pointsStayInside(setPoints(set.strokes, 2), region.path)).toBe(true);
  });

  it("keeps a hatch field inside a circle, checked against the radius", () => {
    const region = circleRegion("pond", 120, 120, 60, hatchFill({ angle: 15 }));
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("inside-circle"));
    expect(set.strokes.length).toBeGreaterThan(0);
    const points = setPoints(set.strokes, 2);
    expect(pointsStayInside(points, region.path)).toBe(true);
    // An independent check: no point sits further from the center than the
    // radius, beyond the containment tolerance.
    for (const point of points) {
      const distance = Math.hypot(point.x - 120, point.y - 120);
      expect(distance).toBeLessThanOrEqual(60 + 1e-3);
    }
  });

  it("keeps every stroke out of a hole carved into the region", () => {
    // A field with a cloud cutout: one rectangle minus one circle
    // (specification sections 7 and 24).
    const carved = subtractMasks(rectPath(0, 0, 200, 120), [
      circlePath(100, 60, 30),
    ]);
    expect(carved).not.toBeNull();
    if (carved === null) return;
    const region: Region = {
      id: "sky-with-cloud",
      role: "sky",
      path: carved,
      fillStyle: hatchFill({ angle: 20 }),
      zIndex: 0,
    };
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("inside-hole"));
    expect(set.strokes.length).toBeGreaterThan(0);
    // The grown region shrinks the hole, so a sample inside the hole fails
    // this test even when it sits on the hole contour only just inside.
    expect(pointsStayInside(setPoints(set.strokes, 1), region.path)).toBe(true);
  });

  it("keeps strokes inside the clip extent of the region", () => {
    const clip = rectPath(100, 40, 80, 60);
    const region = rectRegion("wide", 0, 0, 400, 200, hatchFill({ angle: 10 }), {
      clip,
    });
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("inside-clip"));
    expect(set.strokes.length).toBeGreaterThan(0);
    expect(pointsStayInside(setPoints(set.strokes, 1), clip)).toBe(true);
  });

  it("keeps a jittered field inside a curved spline region", () => {
    // Scene planners emit spline silhouettes, not polygons, so the clipper
    // has to hold strokes inside bezier contours too.
    const anchors = Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return {
        x: 200 + 130 * Math.cos(angle),
        y: 160 + 90 * Math.sin(angle),
      };
    });
    const hill: Path = splineThroughPoints(anchors, { closed: true });
    expect(hill.commands.some((command) => command.command === "curve")).toBe(
      true,
    );
    const region: Region = {
      id: "hill",
      role: "mountain",
      path: hill,
      fillStyle: hatchFill({ angle: 60, spacing: 5 }),
      zIndex: 0,
    };
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("inside-spline"));
    expect(set.strokes.length).toBeGreaterThan(0);
    expect(pointsStayInside(setPoints(set.strokes, 1), region.path)).toBe(true);
  });

  it("drops sliver pieces instead of emitting them", () => {
    // A circle approximation crossed at a shallow angle produces slivers.
    // The floor must hold after the end trim, so the check runs with a
    // lively texture as well, where the trim shortens every piece.
    const fill = crossHatchFill({ spacingA: 4 });
    const region = circleRegion("bush", 100, 100, 40, fill);
    const floor = Math.min(1, fill.spacingA * 0.1);
    for (const texture of [stillTexture, livelyTexture]) {
      const set = hatchRegion(region, hatchStyle(texture), testRng("slivers"));
      expect(set.strokes.length).toBeGreaterThan(0);
      for (const stroke of set.strokes) {
        for (const piece of subpathsOf(stroke.path)) {
          expect(pathLength(piece)).toBeGreaterThanOrEqual(floor - 1e-9);
        }
      }
    }
  });

  it("gives two regions with fork-shaped ids their own streams", () => {
    // The fork escapes its label, so the family stream of "hill" and the
    // region stream of "hill/fork:a" keep two seed keys.
    const style = hatchStyle(livelyTexture);
    const first = rectRegion("hill", 0, 0, 120, 80, hatchFill({ angle: 20 }), {
      role: "mountain",
    });
    const second = rectRegion("hill/fork:a", 0, 0, 120, 80, hatchFill({ angle: 20 }), {
      role: "mountain",
    });
    const sets = hatchRegions([first, second], style, testRng("fork-labels"));
    expect(sets).toHaveLength(2);
    expect(JSON.stringify(sets[1])).not.toEqual(JSON.stringify(sets[0]));
  });
});

describe("acceptance: density rises when spacing falls", () => {
  it("raises density as the spacing shrinks", () => {
    const style = hatchStyle(stillTexture);
    const densities = [20, 10, 5].map((spacing) => {
      const set = hatchRegion(plainField(spacing), style, testRng("density"));
      expect(set.density).toBeGreaterThan(0);
      return set.density;
    });
    expect(densities[0]!).toBeLessThan(densities[1]!);
    expect(densities[1]!).toBeLessThan(densities[2]!);
    // Halving the spacing about doubles the line count, so the density
    // roughly doubles too.
    expect(densities[2]! / densities[0]!).toBeGreaterThan(3);
  });

  it("places about twice as many lines at half the spacing", () => {
    const style = hatchStyle(stillTexture);
    const wide = hatchRegion(plainField(10), style, testRng("count-wide"));
    const tight = hatchRegion(plainField(5), style, testRng("count-tight"));
    expect(tight.strokes.length).toBeGreaterThan(wide.strokes.length);
    expect(tight.strokes.length).toBeGreaterThanOrEqual(
      2 * wide.strokes.length - 2,
    );
  });

  it("records the density score of a crosshatch above its first family", () => {
    const style = hatchStyle(stillTexture);
    const single = hatchRegion(
      rectRegion("a", 10, 10, 120, 90, hatchFill({ angle: 45, spacing: 6 })),
      style,
      testRng("density-a"),
    );
    const crossed = hatchRegion(
      rectRegion("b", 10, 10, 120, 90, crossHatchFill({ spacingA: 6, spacingB: 6 })),
      style,
      testRng("density-b"),
    );
    expect(crossed.density).toBeGreaterThan(single.density);
  });

  it("reports the stroke length and the fill area behind the density", () => {
    // The density is the stroke length over the fill area, so a caller can
    // aggregate ink across regions (the visual density score of the trace,
    // specification section 9E) without re-measuring the geometry.
    const region = rectRegion("a", 10, 10, 120, 90, hatchFill({ spacing: 6 }));
    const set = hatchRegion(region, hatchStyle(stillTexture), testRng("ink"));
    expect(set.fillArea).toBeGreaterThan(0);
    expect(set.strokeLength).toBeGreaterThan(0);
    // Every kept stroke is longer than the sliver floor, so the total ink
    // covers at least one stroke.
    expect(set.strokeLength).toBeGreaterThanOrEqual(
      Math.min(1, 6 * 0.1) * set.strokes.length,
    );
    expect(set.density).toBeCloseTo(set.strokeLength / set.fillArea, 12);

    // An empty set carries the same three facts as zeros.
    const empty = hatchRegion(
      rectRegion("b", 10, 10, 120, 90, { type: "none" }),
      hatchStyle(stillTexture),
      testRng("ink-none"),
    );
    expect(empty).toMatchObject({
      strokeLength: 0,
      fillArea: 0,
      density: 0,
      droppedStrokeCount: 0,
    });
  });
});

describe("acceptance: identical seeds produce identical stroke sets", () => {
  it("returns byte-identical sets for identical seeds", () => {
    const region = rectRegion("field", 0, 0, 200, 120, hatchFill({ angle: 25 }), {
      role: "field",
    });
    const style = hatchStyle(livelyTexture);
    const first = hatchRegion(region, style, testRng("same"));
    const second = hatchRegion(region, style, testRng("same"));
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it("keeps a second region stable when another region is added", () => {
    const style = hatchStyle(livelyTexture);
    const field = rectRegion("field", 0, 0, 200, 120, hatchFill());
    const pond = circleRegion("pond", 60, 60, 40, crossHatchFill());
    const alone = hatchRegions([field, pond], style, testRng("stable"));
    const crowded = hatchRegions(
      [field, pond, rectRegion("hill", 0, 0, 90, 40, hatchFill())],
      style,
      testRng("stable"),
    );
    const alonePond = alone.find((set) => set.regionId === "pond");
    const crowdedPond = crowded.find((set) => set.regionId === "pond");
    expect(alonePond).toBeDefined();
    expect(crowdedPond).toBeDefined();
    expect(JSON.stringify(crowdedPond)).toEqual(JSON.stringify(alonePond));
  });

  it("changes the stroke set when the seed changes", () => {
    const region = rectRegion("field", 0, 0, 200, 120, hatchFill({ angle: 25 }));
    const style = hatchStyle(livelyTexture);
    const first = hatchRegion(region, style, testRng("seed-a"));
    const second = hatchRegion(region, style, testRng("seed-b"));
    expect(JSON.stringify(second)).not.toEqual(JSON.stringify(first));
  });
});

describe("hatchRegion fill kinds", () => {
  it("fills one family for a hatch fill", () => {
    const set = hatchRegion(
      rectRegion("field", 0, 0, 120, 90, hatchFill({ angle: 0 })),
      hatchStyle(stillTexture),
      testRng("kind-hatch"),
    );
    expect(set.kind).toBe("hatch");
    expect(set.strokes.length).toBeGreaterThan(0);
    expect(set.strokes.every((stroke) => stroke.family === "a")).toBe(true);
  });

  it("fills two crossing families for a crosshatch fill", () => {
    const fill = crossHatchFill({ angleA: 45, angleB: 135 });
    const region = rectRegion("bush", 10, 10, 120, 90, fill);
    const set = hatchRegion(region, hatchStyle(livelyTexture), testRng("kind-cross"));
    expect(set.kind).toBe("crosshatch");
    const first = set.strokes.filter((stroke) => stroke.family === "a");
    const second = set.strokes.filter((stroke) => stroke.family === "b");
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);

    // Every stroke stays inside its drift bound around its family angle.
    const amplitude = fill.jitter + livelyTexture.lineJitter;
    const margin = amplitude + 1;
    const firstBound = maxDriftDegrees(region.path, fill.angleA, amplitude, margin);
    const secondBound = maxDriftDegrees(region.path, fill.angleB, amplitude, margin);
    expect(
      first.every((stroke) => Math.abs(stroke.angle - fill.angleA) <= firstBound),
    ).toBe(true);
    expect(
      second.every((stroke) => Math.abs(stroke.angle - fill.angleB) <= secondBound),
    ).toBe(true);

    // At least one line of each family drifted away from the family angle.
    expect(
      first.some((stroke) => stroke.angle !== fill.angleA) ||
        second.some((stroke) => stroke.angle !== fill.angleB),
    ).toBe(true);
  });

  it("returns an empty set for a none fill", () => {
    const set = hatchRegion(
      rectRegion("cloud", 0, 0, 100, 60, { type: "none" }),
      hatchStyle(livelyTexture),
      testRng("kind-none"),
    );
    expect(set.kind).toBe("none");
    expect(set.strokes).toEqual([]);
    expect(set.density).toBe(0);
    expect(set.droppedStrokeCount).toBe(0);
  });

  it("returns an empty set when the clip extent erases the region", () => {
    const set = hatchRegion(
      rectRegion("far", 0, 0, 100, 60, hatchFill(), {
        clip: rectPath(500, 500, 20, 20),
      }),
      hatchStyle(stillTexture),
      testRng("kind-empty"),
    );
    expect(set.strokes).toEqual([]);
    expect(set.density).toBe(0);
  });
});

describe("hatchRegion dropout and pressure", () => {
  it("drops every line at dropout 1 and none at dropout 0", () => {
    const region = plainField(6);
    const all = hatchRegion(
      region,
      hatchStyle({ ...livelyTexture, dropout: 1 }),
      testRng("drop-all"),
    );
    expect(all.strokes).toEqual([]);
    expect(all.droppedStrokeCount).toBeGreaterThan(0);

    const none = hatchRegion(
      region,
      hatchStyle({ ...livelyTexture, dropout: 0 }),
      testRng("drop-none"),
    );
    expect(none.droppedStrokeCount).toBe(0);
    expect(none.strokes.length).toBeGreaterThan(0);
  });

  it("thins the field at a middle dropout share", () => {
    const region = plainField(4);
    const full = hatchRegion(region, hatchStyle(stillTexture), testRng("drop-full"));
    const thinned = hatchRegion(
      region,
      hatchStyle({ ...stillTexture, dropout: 0.5 }),
      testRng("drop-half"),
    );
    expect(thinned.strokes.length).toBeGreaterThan(0);
    expect(thinned.strokes.length).toBeLessThan(full.strokes.length);
    expect(thinned.droppedStrokeCount).toBeGreaterThan(0);
  });

  it("varies the stroke weight inside the pressure spread", () => {
    const region = plainField(4);
    const set = hatchRegion(
      region,
      hatchStyle({ ...stillTexture, pressureVariance: 0.3 }),
      testRng("pressure"),
    );
    expect(set.strokes.length).toBeGreaterThan(4);
    for (const stroke of set.strokes) {
      expect(stroke.weight).toBeGreaterThan(0.5 * 0.7 - 1e-9);
      expect(stroke.weight).toBeLessThan(0.5 * 1.3 + 1e-9);
    }
    const weights = new Set(set.strokes.map((stroke) => stroke.weight));
    expect(weights.size).toBeGreaterThan(1);
  });

  it("keeps the plain weight when the texture is still", () => {
    const set = hatchRegion(
      plainField(6),
      hatchStyle(stillTexture),
      testRng("pressure-still"),
    );
    expect(set.strokes.every((stroke) => stroke.weight === 0.5)).toBe(true);
  });
});

describe("hatchRegion input guards", () => {
  it("throws a readable error for an invalid region", () => {
    const broken = {
      id: "broken",
      path: { commands: [] },
      fillStyle: hatchFill(),
      zIndex: 0,
    };
    expect(() =>
      hatchRegion(broken as unknown as Region, hatchStyle(), testRng("broken")),
    ).toThrow(/valid region/);
  });

  it("refuses a spacing that asks for a near-infinite field", () => {
    const dense = rectRegion("dense", 0, 0, 60, 4, hatchFill({ angle: 90, spacing: 0.002 }));
    expect(() =>
      hatchRegion(dense, hatchStyle(stillTexture), testRng("dense")),
    ).toThrow(/raise the spacing/);
  });
});

describe("hatchRegions", () => {
  it("returns the sets in draw order", () => {
    const style = hatchStyle(stillTexture);
    const sets = hatchRegions(
      [
        rectRegion("front", 0, 0, 60, 40, hatchFill(), { zIndex: 5 }),
        rectRegion("back", 0, 0, 60, 40, hatchFill(), { zIndex: 1 }),
        rectRegion("mid", 0, 0, 60, 40, hatchFill(), { zIndex: 3 }),
      ],
      style,
      testRng("order"),
    );
    expect(sets.map((set) => set.regionId)).toEqual(["back", "mid", "front"]);
    expect(sets.map((set) => set.zIndex)).toEqual([1, 3, 5]);
  });

  it("keeps the input order between equal zIndex values", () => {
    const style = hatchStyle(stillTexture);
    const sets = hatchRegions(
      [
        rectRegion("first", 0, 0, 40, 40, hatchFill(), { zIndex: 2 }),
        rectRegion("second", 0, 0, 40, 40, hatchFill(), { zIndex: 2 }),
      ],
      style,
      testRng("order-equal"),
    );
    expect(sets.map((set) => set.regionId)).toEqual(["first", "second"]);
  });

  it("throws for duplicate region ids", () => {
    const style = hatchStyle(stillTexture);
    const regions = [
      rectRegion("twin", 0, 0, 40, 40, hatchFill()),
      rectRegion("twin", 60, 0, 40, 40, hatchFill()),
    ];
    expect(() => hatchRegions(regions, style, testRng("twin"))).toThrow(
      /duplicate id: twin/,
    );
  });
});

describe("hatchRegion with a still texture", () => {
  it("draws straight lines at the family angle", () => {
    const set = hatchRegion(
      plainField(10),
      hatchStyle(stillTexture),
      testRng("still"),
    );
    expect(set.strokes.length).toBeGreaterThan(0);
    expect(set.strokes.every((stroke) => stroke.angle === 0)).toBe(true);
    // A horizontal ideal line with no deviation budget: every stroke holds
    // one constant y.
    for (const stroke of set.strokes) {
      expect(maxHorizontalDeparture(strokePoints(stroke))).toBeLessThan(1e-9);
    }
  });

  it("spreads consecutive lines by the exact spacing", () => {
    const spacing = 10;
    const set = hatchRegion(
      plainField(spacing),
      hatchStyle(stillTexture),
      testRng("spacing"),
    );
    const lines = set.strokes
      .map((stroke) => startY(stroke))
      .sort((a, b) => a - b);
    expect(lines.length).toBeGreaterThan(2);
    for (let index = 1; index < lines.length; index += 1) {
      const step = lines[index]! - lines[index - 1]!;
      expect(step).toBeCloseTo(spacing, 6);
    }
  });

  it("records the step that placed each line", () => {
    const spacing = 8;
    const region = plainField(spacing);
    // Jitter and spacing variance on, dropout off: one step sits between
    // two neighbouring lines, so the gap must match the recorded step.
    const set = hatchRegion(
      region,
      hatchStyle({ ...livelyTexture, dropout: 0 }),
      testRng("spacing-record"),
    );
    expect(set.strokes.length).toBeGreaterThan(4);
    const lines = [...set.strokes].sort((left, right) => startY(left) - startY(right));
    for (let index = 1; index < lines.length; index += 1) {
      const gap = startY(lines[index]!) - startY(lines[index - 1]!);
      const current = lines[index]!;
      // The step itself varies inside the cap; the drift of both lines adds
      // less than one user unit of slack to the measured gap.
      expect(gap).toBeGreaterThanOrEqual(spacing * 0.7 - 1);
      expect(gap).toBeLessThanOrEqual(spacing * 1.3 + 1);
      expect(Math.abs(gap - current.spacing)).toBeLessThanOrEqual(1);
    }
  });
});

