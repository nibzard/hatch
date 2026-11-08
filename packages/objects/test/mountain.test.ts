/**
 * Tests for the mountain generator: structure, exact bounds, the two
 * faces, the snow cap, and the seeded parameter sweep of the task
 * acceptance.
 */

import { describe, expect, it } from "vitest";

import { pathArea, pathBounds, unitePaths } from "@hatch/geometry";

import {
  defaultMountainParameters,
  generateMountain,
  mountainGenerator,
} from "../src/mountain.js";

import {
  type Envelope,
  expectCompleteGeometry,
  expectWithinEnvelope,
  geometryJson,
  numberParameter,
  sweepGenerator,
  testRng,
} from "./sweep.js";

/** The envelope the mountain parameters promise: exact, because the jagged
 * vertices are clamped into the width and the height. */
function mountainEnvelope(parameters: {
  width: number;
  height: number;
}): Envelope {
  return {
    minX: -parameters.width / 2,
    minY: -parameters.height,
    maxX: parameters.width / 2,
    maxY: 0,
  };
}

describe("generateMountain", () => {
  it("builds a complete geometry from the default parameters", () => {
    const geometry = generateMountain(defaultMountainParameters, {
      rng: testRng("mountain:defaults"),
    });
    expectCompleteGeometry("mountain", geometry);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "mountain",
      "rock",
    ]);
  });

  it("pins the bounds to the width and the height", () => {
    const geometry = generateMountain(defaultMountainParameters, {
      rng: testRng("mountain:bounds"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(-defaultMountainParameters.width / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultMountainParameters.width / 2, 6);
    expect(bounds.minY).toBeCloseTo(-defaultMountainParameters.height, 6);
    expect(bounds.maxY).toBeCloseTo(0, 6);
  });

  it("splits the mass into two faces that cover it", () => {
    const geometry = generateMountain(defaultMountainParameters, {
      rng: testRng("mountain:faces"),
    });
    const faces = geometry.styleZones
      .filter((zone) => zone.role === "mountain" || zone.role === "rock")
      .map((zone) => zone.path);
    const union = unitePaths(faces);
    expect(union).not.toBeNull();
    const covered = pathArea(union ?? geometry.silhouette);
    const total = pathArea(geometry.silhouette);
    expect(covered).toBeGreaterThan(total * 0.9);
    expect(covered).toBeLessThan(total * 1.15);
  });

  it("carves the snow cap out of the faces and leaves it as paper", () => {
    const geometry = generateMountain(
      { ...defaultMountainParameters, snowCap: 0.3 },
      { rng: testRng("mountain:snow") },
    );
    const roles = geometry.styleZones.map((zone) => zone.role);
    expect(roles).toContain("snow");
    const snow = geometry.styleZones.find((zone) => zone.role === "snow");
    expect(snow).toBeDefined();
    if (snow !== undefined) {
      // The cap sits above the snow line and reaches the peak.
      expect(pathBounds(snow.path).maxY).toBeLessThanOrEqual(
        -defaultMountainParameters.height * 0.7 + 1e-6,
      );
      expect(pathBounds(snow.path).minY).toBeCloseTo(
        -defaultMountainParameters.height,
        6,
      );
    }
    // The ridge and the snow line both separate style zones.
    expect(geometry.internalBoundaries.length).toBe(2);
  });

  it("replays the identical mountain from the same stream", () => {
    const first = generateMountain(defaultMountainParameters, {
      rng: testRng("mountain:r"),
    });
    const second = generateMountain(defaultMountainParameters, {
      rng: testRng("mountain:r"),
    });
    expect(geometryJson(second)).toBe(geometryJson(first));
  });
});

describe("mountain parameter sweep", () => {
  it("returns non-empty geometry inside its exact bounds", () => {
    const samples = sweepGenerator(mountainGenerator, "bounds", 32);
    expect(samples).toHaveLength(32);
    for (const { parameters, geometry } of samples) {
      expectCompleteGeometry("mountain", geometry);
      const envelope = mountainEnvelope({
        width: numberParameter(parameters, "width"),
        height: numberParameter(parameters, "height"),
      });
      expectWithinEnvelope("mountain", geometry, envelope);
      // The peak is exact, so the top of the silhouette is exact too.
      expect(pathBounds(geometry.silhouette).minY).toBeCloseTo(
        envelope.minY,
        6,
      );
    }
  });
});
