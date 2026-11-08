/**
 * Tests for the cliff generator: the contract of the registry, the headland
 * zones, the wave-cut face, and the strata of the front.
 */

import { describe, expect, it } from "vitest";

import { pathArea, pathBounds } from "@hatch/geometry";

import {
  cliffGenerator,
  cliffStations,
  defaultCliffParameters,
  generateCliff,
} from "../src/cliff.js";

import {
  describeObjectContract,
  type Envelope,
  testRng,
} from "./sweep.js";

/**
 * The envelope the cliff parameters promise, with spline overshoot room.
 *
 * Every anchor sits inside the frame the parameters state, and a spline
 * through them bulges a little past their extremes: under four percent of
 * the height above the plateau and of the width past the base corners.
 */
function cliffEnvelope(parameters: {
  width: number;
  height: number;
}): Envelope {
  const topSlack = parameters.height * 0.06 + 2;
  const sideSlack = parameters.width * 0.05 + 2;
  return {
    minX: -parameters.width / 2 - sideSlack,
    maxX: parameters.width / 2 + sideSlack,
    minY: -parameters.height - topSlack,
    // The base line closes the mass, so only spline overshoot brushes
    // past it downwards.
    maxY: topSlack,
  };
}

describeObjectContract(cliffGenerator, {
  envelopeOf: cliffEnvelope,
});

describe("generateCliff", () => {
  it("stands on the base line and reaches its plateau", () => {
    const geometry = generateCliff(defaultCliffParameters, {
      rng: testRng("cliff:defaults"),
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeLessThanOrEqual(-defaultCliffParameters.height);
    expect(bounds.minY).toBeGreaterThanOrEqual(
      cliffEnvelope(defaultCliffParameters).minY,
    );
  });

  it("splits the mass into a headland and a wave-cut face", () => {
    const geometry = generateCliff(defaultCliffParameters, {
      rng: testRng("cliff:zones"),
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "mountain",
      "rock",
    ]);
    for (const zone of geometry.styleZones) {
      expect(pathArea(zone.path)).toBeGreaterThan(0);
    }
    // The rock zone is the front: it reaches the foot of the face, past
    // the headland zone.
    const headlandZone = geometry.styleZones.find(
      (zone) => zone.role === "mountain",
    );
    const faceZone = geometry.styleZones.find((zone) => zone.role === "rock");
    expect(headlandZone).toBeDefined();
    expect(faceZone).toBeDefined();
    if (headlandZone === undefined || faceZone === undefined) {
      return;
    }
    const headland = pathBounds(headlandZone.path);
    const face = pathBounds(faceZone.path);
    expect(face.maxX).toBeCloseTo(defaultCliffParameters.width / 2, 5);
    expect(face.maxX).toBeGreaterThan(headland.maxX);
  });

  it("carries the edge of the headland as a boundary and a contour", () => {
    const geometry = generateCliff(
      { ...defaultCliffParameters, strata: 0 },
      { rng: testRng("cliff:edge") },
    );
    // No strata asked for, and the cut line still draws.
    expect(geometry.internalBoundaries).toHaveLength(1);
    expect(geometry.contours).toHaveLength(3);
  });

  it("draws one stratum line per count across the face", () => {
    for (const strata of [1, 3, 5]) {
      const geometry = generateCliff(
        { ...defaultCliffParameters, strata },
        { rng: testRng("cliff:strata") },
      );
      expect(geometry.internalBoundaries).toHaveLength(strata + 1);
    }
  });

  it("mirrors the mass when the face looks left", () => {
    const right = generateCliff(defaultCliffParameters, {
      rng: testRng("cliff:mirror"),
    });
    const left = generateCliff(
      { ...defaultCliffParameters, faceLeft: true },
      { rng: testRng("cliff:mirror") },
    );
    const rightBounds = pathBounds(right.silhouette);
    const leftBounds = pathBounds(left.silhouette);
    expect(leftBounds.minX).toBeCloseTo(-rightBounds.maxX, 4);
    expect(leftBounds.maxX).toBeCloseTo(-rightBounds.minX, 4);
    // The rock zone follows the face to the mirrored side.
    const faceZone = left.styleZones.find((zone) => zone.role === "rock");
    expect(faceZone).toBeDefined();
    if (faceZone !== undefined) {
      const face = pathBounds(faceZone.path);
      expect(face.minX).toBeCloseTo(-defaultCliffParameters.width / 2, 4);
    }
  });

  it("keeps the lip inland of the foot whatever the batter", () => {
    const parameters = {
      ...defaultCliffParameters,
      faceBatter: 0.45,
      height: 900,
    };
    const stations = cliffStations(parameters, 1);
    const halfWidth = parameters.width / 2;
    expect(stations.lip.x).toBeLessThan(halfWidth);
    expect(stations.lip.x).toBeGreaterThan(-halfWidth);
    // The plateau keeps its run whatever the batter took.
    expect(stations.plateau[0]?.x).toBeLessThan(stations.lip.x);
  });
});
