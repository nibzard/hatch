/**
 * Acceptance tests for composition.negativeSpace (task T048).
 *
 * The field is required by the schema, the editor exposes it, and the
 * specification names it in the sections on composition (5), the style
 * override vocabulary (8), the edit examples (15), and the planner (18).
 * A field the compiler only stores changes the spec hash, the hash moves
 * the seeded streams, and the bytes drift while the picture stays the
 * same. These tests render two specs that differ in nothing but the ask
 * and pin the documented effect - the hatch of every fill opens by the
 * distance from the floor of the style - on exact numbers, so a field
 * that goes inert fails on structure, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import { pastoralV1 } from "@hatch/styles";
import {
  negativeSpaceSpacingMultiplier,
  RAIN_REGION_ID,
  type Region,
  type SceneSpec,
} from "@hatch/core";

import { createV1Engine } from "../src/index.js";
import { assertWellFormedXml } from "./xml-check.js";

/** The floor of pastoral-v1, the reference the ask is measured against. */
const FLOOR = pastoralV1.compositionGrammar.minEmptyAreaRatio;

/** The spacing the sky family of pastoral-v1 states. */
const SKY_SPACING = pastoralV1.hatchFamilies.sky.spacing;

/** Round to the four decimals an opened spacing carries. */
function rounded(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** What one test renders: the document, the representation, the trace. */
function render(spec: SceneSpec) {
  const result = createV1Engine().renderScene(spec);
  assertWellFormedXml(result.svg);
  return {
    svg: result.svg,
    ir: result.ir,
    trace: result.trace,
    strokeCount: result.trace.metrics?.strokeCount,
  };
}

/** One ask the composition can carry. */
type NegativeSpaceAsk = {
  readonly goal: number;
  readonly spacingMultiplier: number;
};

/** Every ask the tests render, in order of growing emptiness. */
const ASKS: readonly NegativeSpaceAsk[] = [0.05, 0.2, FLOOR, 0.95].map(
  (goal) => ({
    goal,
    spacingMultiplier: negativeSpaceSpacingMultiplier(goal, FLOOR),
  }),
);

/**
 * One rural scene over three draw planes: a hill behind, a pond at the
 * neutral plane, a cottage in front as the focal point, and one tree kept
 * as paper. The rain names its own stroke count, so its density is
 * explicit and must not follow the ask.
 */
function negativeSpaceScene(negativeSpace: number): SceneSpec {
  return {
    meta: {
      id: "negative-space-0001",
      seed: 20261107,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "medium", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "center",
      negativeSpace,
      depthLayers: 3,
    },
    environment: {
      type: "rural",
      sky: { cloudCount: 2 },
      atmosphere: { rain: 40 },
    },
    objects: [
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.7 },
        scale: 2,
        params: { width: 300, height: 80 },
      },
      {
        id: "pond-1",
        kind: "water",
        role: "midground",
        position: { x: 0.45, y: 0.78 },
        scale: 1.5,
        params: { width: 360, depth: 90 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.62, y: 0.8 },
        scale: 1.5,
        params: { width: 150, wallHeight: 80, windows: 2, chimney: true },
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "foreground",
        position: { x: 0.85, y: 0.9 },
        scale: 1.6,
        params: { canopyRadius: 48, trunkHeight: 70 },
        styleRole: "paper",
      },
    ],
  } as SceneSpec;
}

/** The first region of one render whose id matches. */
function regionOf(regions: readonly Region[], id: string): Region {
  const region = regions.find((entry) => entry.id === id);
  if (region === undefined) {
    throw new Error(`test expected a region "${id}"`);
  }
  return region;
}

/** Every region of one render whose id carries an object id prefix. */
function objectRegions(regions: readonly Region[], objectId: string): Region[] {
  return regions.filter((region) => region.id.startsWith(`${objectId}:z`));
}

describe("composition.negativeSpace drives the render", () => {
  const renders = ASKS.map((ask) => ({
    ask,
    ...render(negativeSpaceScene(ask.goal)),
  }));
  const dense = renders[0]!;
  const tight = renders[1]!;
  const atFloor = renders[2]!;
  const open = renders[3]!;

  it("renders every ask without errors and the same region stack", () => {
    // The ask works on ink, not on placement, so the structure each render
    // plans stays the same and only the fill of each region moves.
    for (const entry of renders) {
      expect(entry.ir.regions.map((region) => region.id)).toEqual(
        renders[0]!.ir.regions.map((region) => region.id),
      );
    }
  });

  it("opens the hatch of the scene regions by the distance from the floor", () => {
    for (const entry of renders) {
      const sky = regionOf(entry.ir.regions, "sky");
      // The opened spacing rounds to four decimals the way the negative
      // space model states, so the float product of the ask 0.2 compares
      // through the same rounding.
      expect(sky.fillStyle).toEqual({
        type: "hatch",
        angle: pastoralV1.hatchFamilies.sky.angle,
        spacing: rounded(SKY_SPACING * entry.ask.spacingMultiplier),
        stroke: pastoralV1.hatchFamilies.sky.stroke,
        weight: pastoralV1.hatchFamilies.sky.weight,
        jitter: pastoralV1.hatchFamilies.sky.jitter,
      });
    }
    // The stated sky spacing of pastoral-v1 is 7, so the pinned spacings
    // follow from the floor 0.35 and the gain 1.2: the ask 0.05 sits 0.3
    // under the floor and tightens to 4.48, the ask 0.2 sits 0.15 under it
    // and tightens to 5.74, and the ask 0.95 sits 0.6 above it and opens
    // to 12.04.
    expect(regionOf(dense.ir.regions, "sky").fillStyle).toMatchObject({
      spacing: 4.48,
    });
    expect(regionOf(tight.ir.regions, "sky").fillStyle).toMatchObject({
      spacing: 5.74,
    });
    expect(regionOf(atFloor.ir.regions, "sky").fillStyle).toMatchObject({
      spacing: 7,
    });
    expect(regionOf(open.ir.regions, "sky").fillStyle).toMatchObject({
      spacing: 12.04,
    });
  });

  it("opens the hatch of the object zones the same way, and keeps the pen", () => {
    // The hill zones fill with the single-system field family, the pond
    // zones with the two-system water family. Both open by the same
    // multiplier, and both keep the weight the style states.
    for (const entry of renders) {
      for (const region of objectRegions(entry.ir.regions, "hill-1")) {
        if (region.fillStyle.type !== "hatch") {
          continue;
        }
        expect(region.fillStyle.spacing).toBeCloseTo(
          pastoralV1.hatchFamilies.field.spacing *
            entry.ask.spacingMultiplier,
          5,
        );
        expect(region.fillStyle.weight).toBe(
          pastoralV1.hatchFamilies.field.weight,
        );
      }
      for (const region of objectRegions(entry.ir.regions, "pond-1")) {
        if (region.fillStyle.type !== "crosshatch") {
          continue;
        }
        expect(region.fillStyle.spacingA).toBeCloseTo(
          pastoralV1.hatchFamilies.water.spacingA *
            entry.ask.spacingMultiplier,
          5,
        );
        expect(region.fillStyle.weight).toBe(
          pastoralV1.hatchFamilies.water.weight,
        );
      }
    }
  });

  it("renders the stated families of the preset at the floor of the style", () => {
    // The tuned families of a preset stay reachable: an ask that meets the
    // floor renders the spacing the preset states, unchanged.
    expect(atFloor.ask.spacingMultiplier).toBe(1);
    expect(regionOf(atFloor.ir.regions, "sky").fillStyle).toMatchObject({
      spacing: SKY_SPACING,
    });
  });

  it("draws fewer strokes the emptier the composition asks", () => {
    expect(dense.strokeCount).toBeDefined();
    expect(atFloor.strokeCount).toBeLessThan(dense.strokeCount!);
    expect(open.strokeCount).toBeLessThan(atFloor.strokeCount!);
  });

  it("leaves paper negative space whatever the ask", () => {
    for (const entry of renders) {
      for (const region of objectRegions(entry.ir.regions, "tree-1")) {
        expect(region.fillStyle).toEqual({ type: "none" });
      }
    }
  });

  it("keeps the density the rain count names", () => {
    const spacingOf = (entry: (typeof renders)[number]): number => {
      const rain = regionOf(entry.ir.regions, RAIN_REGION_ID);
      if (rain.fillStyle.type !== "hatch") {
        throw new Error("test expected the rain region to hatch");
      }
      return rain.fillStyle.spacing;
    };
    // `rain` states its stroke count, so its spacing follows the count and
    // the canvas alone, whatever the composition asks of the hatch.
    for (const entry of renders) {
      expect(spacingOf(entry)).toBe(spacingOf(renders[0]!));
    }
  });

  it("records the decision in the planning event of the trace", () => {
    // No ask under the floor of pastoral-v1 comes near the minimum, so the
    // clamp flag stays false for every one of them: the residue the
    // rounding of the multiplier leaves on the ask 0.2 must not read as a
    // clamp.
    for (const entry of renders) {
      const planning = entry.trace.events.find(
        (event) => event.stage === "planning",
      );
      expect(planning?.data).toMatchObject({
        negativeSpace: {
          goal: entry.ask.goal,
          floor: FLOOR,
          spacingMultiplier: entry.ask.spacingMultiplier,
          spacingMultiplierClamped: false,
        },
      });
    }
  });

  it("renders two asks that differ only in the field to different bytes", () => {
    expect(dense.svg).not.toBe(open.svg);
  });
});
