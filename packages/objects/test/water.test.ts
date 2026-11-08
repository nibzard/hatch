/**
 * Tests for the water generator: structure, the band envelope, the wave
 * boundaries, and the seeded parameter sweep of the task acceptance.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import {
  defaultWaterParameters,
  generateWater,
  waterGenerator,
} from "../src/water.js";

import {
  type Envelope,
  expectCompleteGeometry,
  expectWithinEnvelope,
  geometryJson,
  numberParameter,
  sweepGenerator,
  testRng,
} from "./sweep.js";

/** The envelope the water parameters promise, with spline overshoot room. */
function waterEnvelope(parameters: {
  width: number;
  depth: number;
  shoreIrregularity: number;
}): Envelope {
  const wander = parameters.depth * 0.08 * parameters.shoreIrregularity;
  // A spline through wandering anchors bulges a little past their extremes.
  const slack = wander * 0.35 + 1;
  return {
    minX: -parameters.width / 2,
    minY: -wander - slack,
    maxX: parameters.width / 2,
    maxY: parameters.depth + wander * 0.6 + slack,
  };
}

describe("generateWater", () => {
  it("builds a complete geometry from the default parameters", () => {
    const geometry = generateWater(defaultWaterParameters, {
      rng: testRng("water:defaults"),
    });
    expectCompleteGeometry("water", geometry);
    expectWithinEnvelope("water", geometry, waterEnvelope(defaultWaterParameters));
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["water"]);
  });

  it("spans the full width and keeps the band between its edges", () => {
    const geometry = generateWater(defaultWaterParameters, {
      rng: testRng("water:band"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(-defaultWaterParameters.width / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultWaterParameters.width / 2, 6);
    expect(bounds.maxY).toBeGreaterThan(defaultWaterParameters.depth * 0.9);
  });

  it("draws one clipped wave boundary per wave line", () => {
    const geometry = generateWater(
      { ...defaultWaterParameters, waveLines: 7 },
      { rng: testRng("water:waves") },
    );
    expect(geometry.internalBoundaries).toHaveLength(7);
    for (const wave of geometry.internalBoundaries) {
      // Every wave stays inside the band: the clipper cut it there.
      const bounds = pathBounds(wave);
      expect(pointInPath(geometry.silhouette, { x: 0, y: bounds.minY })).toBe(true);
      expect(pointInPath(geometry.silhouette, { x: 0, y: bounds.maxY })).toBe(true);
    }
  });

  it("keeps a flat calm band near the shore", () => {
    const geometry = generateWater(
      { ...defaultWaterParameters, waveLines: 1, calmBand: 0.5 },
      { rng: testRng("water:calm") },
    );
    const [firstWave] = geometry.internalBoundaries;
    expect(firstWave).toBeDefined();
    if (firstWave !== undefined) {
      // The single wave sits past the calm band.
      expect(pathBounds(firstWave).minY).toBeGreaterThanOrEqual(
        defaultWaterParameters.depth * 0.5 - 1e-6,
      );
    }
  });

  it("replays the identical water from the same stream", () => {
    const first = generateWater(defaultWaterParameters, { rng: testRng("water:r") });
    const second = generateWater(defaultWaterParameters, { rng: testRng("water:r") });
    expect(geometryJson(second)).toBe(geometryJson(first));
  });
});

describe("water parameter sweep", () => {
  it("returns non-empty geometry inside its bounds across seeded samples", () => {
    const samples = sweepGenerator(waterGenerator, "bounds", 32);
    expect(samples).toHaveLength(32);
    for (const { parameters, geometry } of samples) {
      expectCompleteGeometry("water", geometry);
      expectWithinEnvelope(
        "water",
        geometry,
        waterEnvelope({
          width: numberParameter(parameters, "width"),
          depth: numberParameter(parameters, "depth"),
          shoreIrregularity: numberParameter(parameters, "shoreIrregularity"),
        }),
      );
      expect(geometry.internalBoundaries.length).toBe(
        parameters.waveLines as number,
      );
    }
  });
});
