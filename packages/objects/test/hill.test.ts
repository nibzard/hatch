/**
 * Tests for the hill generator: structure, the crest envelope, the strip
 * boundaries, and the seeded parameter sweep of the task acceptance.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import {
  defaultHillParameters,
  generateHill,
  hillGenerator,
} from "../src/hill.js";

import {
  type Envelope,
  expectCompleteGeometry,
  expectWithinEnvelope,
  geometryJson,
  numberParameter,
  sweepGenerator,
  testRng,
} from "./sweep.js";

/** The envelope the hill parameters promise, with spline overshoot room. */
function hillEnvelope(parameters: {
  width: number;
  height: number;
}): Envelope {
  const slack = parameters.height * 0.08 + 1;
  return {
    minX: -parameters.width / 2,
    minY: -parameters.height - slack,
    maxX: parameters.width / 2,
    // The crest meets the base line at both ends, so the hill never dips
    // far below it; only spline overshoot can brush past.
    maxY: slack,
  };
}

describe("generateHill", () => {
  it("builds a complete geometry from the default parameters", () => {
    const geometry = generateHill(defaultHillParameters, {
      rng: testRng("hill:defaults"),
    });
    expectCompleteGeometry("hill", geometry);
    expectWithinEnvelope("hill", geometry, hillEnvelope(defaultHillParameters));
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["field"]);
  });

  it("closes the crest down to the base line at both ends", () => {
    const geometry = generateHill(defaultHillParameters, {
      rng: testRng("hill:base"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(-defaultHillParameters.width / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultHillParameters.width / 2, 6);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The crest never rises past the stated height.
    expect(bounds.minY).toBeGreaterThanOrEqual(-defaultHillParameters.height - 1e-6);
  });

  it("keeps every strip boundary inside the hill area", () => {
    const geometry = generateHill(
      { ...defaultHillParameters, strips: 4 },
      { rng: testRng("hill:strips") },
    );
    expect(geometry.internalBoundaries.length).toBe(4);
    for (const boundary of geometry.internalBoundaries) {
      const bounds = pathBounds(boundary);
      expect(bounds.minY).toBeGreaterThan(-defaultHillParameters.height);
      expect(pointInPath(geometry.silhouette, { x: 0, y: bounds.minY })).toBe(true);
    }
  });

  it("replays the identical hill from the same stream", () => {
    const first = generateHill(defaultHillParameters, { rng: testRng("hill:r") });
    const second = generateHill(defaultHillParameters, { rng: testRng("hill:r") });
    expect(geometryJson(second)).toBe(geometryJson(first));
  });
});

describe("hill parameter sweep", () => {
  it("returns non-empty geometry inside its bounds across seeded samples", () => {
    const samples = sweepGenerator(hillGenerator, "bounds", 32);
    expect(samples).toHaveLength(32);
    for (const { parameters, geometry } of samples) {
      expectCompleteGeometry("hill", geometry);
      expectWithinEnvelope(
        "hill",
        geometry,
        hillEnvelope({
          width: numberParameter(parameters, "width"),
          height: numberParameter(parameters, "height"),
        }),
      );
      // One strip boundary per requested strip, whatever the crest jitter
      // drew, because the strips divide the height the crest reached.
      expect(geometry.internalBoundaries.length).toBe(
        parameters.strips as number,
      );
    }
  });
});
