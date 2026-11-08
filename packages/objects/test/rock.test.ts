/**
 * Tests for the rock generator: the contract of the registry, the lobed
 * crest, the wash line, and the cracks.
 */

import { describe, expect, it } from "vitest";

import { pathArea, pathBounds } from "@hatch/geometry";

import {
  defaultRockParameters,
  generateRock,
  rockGenerator,
} from "../src/rock.js";

import {
  describeObjectContract,
  type Envelope,
  testRng,
} from "./sweep.js";

/**
 * The envelope the rock parameters promise, with spline overshoot room.
 *
 * Every anchor sits inside the frame the parameters state, and a closed
 * spline through the lobes bulges past their extremes: under ten percent of
 * the height above the crest and four percent of the width past the base
 * corners.
 */
function rockEnvelope(parameters: {
  width: number;
  height: number;
}): Envelope {
  const topSlack = parameters.height * 0.12 + 2;
  const sideSlack = parameters.width * 0.06 + 2;
  return {
    minX: -parameters.width / 2 - sideSlack,
    maxX: parameters.width / 2 + sideSlack,
    minY: -parameters.height - topSlack,
    // The base line closes the mass, so the rock never dips far below the
    // ground it sits on.
    maxY: topSlack,
  };
}

describeObjectContract(rockGenerator, {
  envelopeOf: rockEnvelope,
});

describe("generateRock", () => {
  it("sits on the ground line and keeps its stated span", () => {
    const geometry = generateRock(defaultRockParameters, {
      rng: testRng("rock:defaults"),
    });
    const bounds = pathBounds(geometry.silhouette);
    const envelope = rockEnvelope(defaultRockParameters);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // Both base corners sit on the stated span, and the lobed crest bulges
    // only inside the overshoot room the envelope states.
    expect(bounds.minX).toBeLessThanOrEqual(-defaultRockParameters.width / 2);
    expect(bounds.maxX).toBeGreaterThanOrEqual(defaultRockParameters.width / 2);
    expect(bounds.minX).toBeGreaterThanOrEqual(envelope.minX);
    expect(bounds.maxX).toBeLessThanOrEqual(envelope.maxX);
    expect(pathArea(geometry.silhouette)).toBeGreaterThan(0);
  });

  it("fills one rock zone, the hardest hatch of the style", () => {
    const geometry = generateRock(defaultRockParameters, {
      rng: testRng("rock:zone"),
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["rock"]);
  });

  it("carries the wash line even when no crack is asked for", () => {
    const geometry = generateRock(
      { ...defaultRockParameters, cracks: 0 },
      { rng: testRng("rock:wash") },
    );
    expect(geometry.internalBoundaries).toHaveLength(1);
    const wash = geometry.internalBoundaries[0];
    expect(wash).toBeDefined();
    if (wash === undefined) {
      return;
    }
    const bounds = pathBounds(wash);
    // The wash line sits low on the mass, above the ground line.
    expect(bounds.maxY).toBeLessThan(0);
    expect(bounds.minY).toBeGreaterThan(-defaultRockParameters.height * 0.4);
  });

  it("draws one crack boundary per count", () => {
    for (const cracks of [0, 1, 3]) {
      const geometry = generateRock(
        { ...defaultRockParameters, cracks },
        { rng: testRng("rock:cracks") },
      );
      expect(geometry.internalBoundaries).toHaveLength(cracks + 1);
    }
  });

  it("keeps both base corners on the ground line", () => {
    const parameters = { ...defaultRockParameters, lobes: 12, irregularity: 0.7 };
    const geometry = generateRock(parameters, {
      rng: testRng("rock:corners"),
    });
    const bounds = pathBounds(geometry.silhouette);
    const envelope = rockEnvelope(parameters);
    expect(bounds.minY).toBeGreaterThanOrEqual(envelope.minY);
    expect(bounds.maxY).toBeLessThanOrEqual(envelope.maxY);
    expect(bounds.maxY).toBeCloseTo(0, 6);
  });
});
