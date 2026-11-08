/**
 * Tests for the tree generator: structure, the canopy clamp, stream use,
 * and the seeded parameter sweep of the task acceptance.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import {
  defaultTreeParameters,
  generateTree,
  treeGenerator,
} from "../src/tree.js";

import {
  type Envelope,
  expectCompleteGeometry,
  expectWithinEnvelope,
  geometryJson,
  numberParameter,
  sweepGenerator,
  testRng,
} from "./sweep.js";

/** The envelope the tree parameters promise, with spline overshoot room. */
function treeEnvelope(parameters: {
  trunkHeight: number;
  trunkWidth: number;
  trunkBend: number;
  canopyRadius: number;
  canopyIrregularity: number;
}): Envelope {
  // The canopy radius is clamped so the canopy stays above the ground line.
  const radius = Math.min(
    parameters.canopyRadius,
    parameters.trunkHeight / (0.65 + parameters.canopyIrregularity),
  );
  const reach = radius * (1 + parameters.canopyIrregularity);
  // A spline through lobed anchors bulges a little past its anchors.
  const slack = Math.max(radius * 0.3, 1);
  const bend = parameters.trunkBend * parameters.trunkHeight;
  const centerX = Math.min(-parameters.trunkWidth / 2, bend - reach - slack);
  const maxX = Math.max(parameters.trunkWidth / 2, bend + reach + slack);
  return {
    minX: centerX,
    minY: -(parameters.trunkHeight + radius * 0.35) - reach - slack,
    maxX,
    // The trunk foot sits on the ground line; the trunk edge splines may
    // brush past it by a fraction of the slack.
    maxY: slack,
  };
}

describe("generateTree", () => {
  it("builds a complete geometry from the default parameters", () => {
    const geometry = generateTree(defaultTreeParameters, {
      rng: testRng("tree:defaults"),
    });
    expectCompleteGeometry("tree", geometry);
    expectWithinEnvelope("tree", geometry, treeEnvelope(defaultTreeParameters));
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["foliage"]);
  });

  it("draws trunk contours and canopy boundaries", () => {
    const geometry = generateTree(defaultTreeParameters, {
      rng: testRng("tree:structure"),
    });
    // Two trunk edges, the canopy echo, the branches, and the clump arcs.
    expect(geometry.contours.length).toBeGreaterThanOrEqual(2);
    expect(geometry.internalBoundaries.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the canopy above the ground line for a wide canopy", () => {
    const parameters = {
      ...defaultTreeParameters,
      trunkHeight: 8,
      canopyRadius: 300,
      canopyIrregularity: 0.6,
    };
    const geometry = generateTree(parameters, { rng: testRng("tree:clamp") });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeLessThanOrEqual(
      treeEnvelope(parameters).maxY + 1e-6,
    );
    expectCompleteGeometry("tree", geometry);
  });

  it("replays the identical tree from the same stream", () => {
    const first = generateTree(defaultTreeParameters, {
      rng: testRng("tree:replay"),
    });
    const second = generateTree(defaultTreeParameters, {
      rng: testRng("tree:replay"),
    });
    expect(geometryJson(second)).toBe(geometryJson(first));
  });

  it("lets a different stream draw a different canopy", () => {
    const first = generateTree(defaultTreeParameters, { rng: testRng("tree:a") });
    const second = generateTree(defaultTreeParameters, { rng: testRng("tree:b") });
    expect(geometryJson(second)).not.toBe(geometryJson(first));
  });
});

describe("tree parameter sweep", () => {
  it("returns non-empty geometry inside its bounds across seeded samples", () => {
    const samples = sweepGenerator(treeGenerator, "bounds", 32);
    expect(samples).toHaveLength(32);
    for (const { parameters, geometry } of samples) {
      expectCompleteGeometry("tree", geometry);
      expectWithinEnvelope(
        "tree",
        geometry,
        treeEnvelope({
          trunkHeight: numberParameter(parameters, "trunkHeight"),
          trunkWidth: numberParameter(parameters, "trunkWidth"),
          trunkBend: numberParameter(parameters, "trunkBend"),
          canopyRadius: numberParameter(parameters, "canopyRadius"),
          canopyIrregularity: numberParameter(parameters, "canopyIrregularity"),
        }),
      );
    }
  });
});
