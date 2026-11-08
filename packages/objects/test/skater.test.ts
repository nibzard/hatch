/**
 * Tests for the skater generator: the contract of task T015, the riding
 * stance, the board, and the cast shadow that grounds the figure.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import {
  defaultSkaterParameters,
  generateSkater,
  skaterGenerator,
} from "../src/skater.js";

import {
  describeObjectContract,
  type Envelope,
  testRng,
} from "./sweep.js";

/** The envelope the skater parameters promise. */
function skaterEnvelope(parameters: {
  height: number;
  boardLength: number;
}): Envelope {
  return {
    minX: -Math.max(parameters.boardLength / 2, parameters.height * 0.36),
    minY: -parameters.height * 0.95,
    maxX: Math.max(parameters.boardLength / 2, parameters.height * 0.36),
    maxY: 0,
  };
}

describeObjectContract(skaterGenerator, {
  envelopeOf: skaterEnvelope,
});

describe("generateSkater", () => {
  it("stands the figure on the ground inside its height", () => {
    const geometry = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:stance"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The head crown sits near the stated height, the board costs a share.
    expect(bounds.minY).toBeLessThan(-defaultSkaterParameters.height * 0.8);
    expect(bounds.minY).toBeGreaterThan(-defaultSkaterParameters.height);
  });

  it("keeps the figure as paper and grounds it with a shadow", () => {
    const geometry = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:zones"),
    });
    const zones = geometry.styleZones.map((zone) => zone.role);
    expect(zones).toContain("figure");
    expect(zones).toContain("shadow");
    expect(zones).toContain("architecture");
    expect(zones).toContain("metal");
    const shadow = geometry.styleZones.find((zone) => zone.role === "shadow");
    expect(shadow).toBeDefined();
    if (shadow !== undefined) {
      // The shadow lies under the figure and touches the ground line.
      const bounds = pathBounds(shadow.path);
      expect(bounds.maxY).toBeCloseTo(0, 6);
      expect(pointInPath(shadow.path, { x: 0, y: bounds.minY + 0.1 })).toBe(true);
    }
  });

  it("drops the board and its zones on request", () => {
    const geometry = generateSkater(
      { ...defaultSkaterParameters, board: false },
      { rng: testRng("skater:boardless") },
    );
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "figure",
      "shadow",
    ]);
  });

  it("replays the identical pose from the same stream", () => {
    const first = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:pose"),
    });
    const second = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:pose"),
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("changes pose with the stream, because a figure is organic", () => {
    const first = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:pose:a"),
    });
    const second = generateSkater(defaultSkaterParameters, {
      rng: testRng("skater:pose:b"),
    });
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });
});
