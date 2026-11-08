/**
 * Tests for the road generator: the contract of task T015, the kerb band,
 * and the dashed lane markings.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import {
  defaultRoadParameters,
  generateRoad,
  roadGenerator,
} from "../src/road.js";

import {
  describeObjectContract,
  type Envelope,
  testRng,
} from "./sweep.js";

/** The envelope the road parameters promise, with spline overshoot room. */
function roadEnvelope(parameters: {
  width: number;
  depth: number;
  wander: number;
}): Envelope {
  const drift = parameters.depth * 0.05 * parameters.wander;
  // A spline through wandering anchors bulges a little past their extremes.
  const slack = drift * 0.35 + 1;
  return {
    minX: -parameters.width / 2,
    minY: -drift - slack,
    maxX: parameters.width / 2,
    maxY: parameters.depth + drift + slack,
  };
}

describeObjectContract(roadGenerator, {
  envelopeOf: roadEnvelope,
});

describe("generateRoad", () => {
  it("spans the full width and keeps the band between its kerbs", () => {
    const geometry = generateRoad(defaultRoadParameters, {
      rng: testRng("road:band"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(-defaultRoadParameters.width / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultRoadParameters.width / 2, 6);
    expect(bounds.maxY).toBeGreaterThan(defaultRoadParameters.depth * 0.9);
  });

  it("draws one dashed marking per lane boundary", () => {
    const geometry = generateRoad(
      { ...defaultRoadParameters, lanes: 4 },
      { rng: testRng("road:lanes") },
    );
    expect(geometry.internalBoundaries).toHaveLength(3);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["pavement"]);
  });

  it("keeps one interior line on a single lane without markings", () => {
    const geometry = generateRoad(
      { ...defaultRoadParameters, lanes: 1, markings: false },
      { rng: testRng("road:crown") },
    );
    expect(geometry.internalBoundaries).toHaveLength(1);
  });

  it("dashes each marking into more than one piece", () => {
    const geometry = generateRoad(defaultRoadParameters, {
      rng: testRng("road:dashes"),
    });
    for (const marking of geometry.internalBoundaries) {
      // Every dash opens with its own move command.
      const moves = marking.commands.filter(
        (command) => command.command === "move",
      ).length;
      expect(moves).toBeGreaterThan(1);
    }
  });

  it("replays the identical road from the same stream", () => {
    const first = generateRoad(defaultRoadParameters, {
      rng: testRng("road:replay"),
    });
    const second = generateRoad(defaultRoadParameters, {
      rng: testRng("road:replay"),
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
