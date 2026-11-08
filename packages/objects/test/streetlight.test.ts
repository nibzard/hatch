/**
 * Tests for the streetlight generator: the contract of task T015, the pole,
 * the reaching arm, and the lit lens.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import {
  defaultStreetlightParameters,
  generateStreetlight,
  streetlightGenerator,
} from "../src/streetlight.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the streetlight parameters promise. */
function streetlightEnvelope(parameters: {
  height: number;
  armLength: number;
  headLength: number;
  baseWidth: number;
}): Envelope {
  const reach = parameters.armLength * parameters.height;
  const poleWidth = Math.min(Math.max(parameters.height * 0.03, 4), 14);
  // The plinth widens when the pole needs more ground than the base states.
  const plinthBase = Math.max(
    parameters.baseWidth / 2,
    poleWidth * 0.75 * 1.25,
  );
  return {
    // A short arm swings the head back over the pole, past the plinth.
    minX: Math.min(-plinthBase, reach - parameters.headLength / 2),
    minY: -parameters.height * 1.1,
    maxX: reach + parameters.headLength / 2,
    maxY: 0,
  };
}

describeObjectContract(streetlightGenerator, {
  envelopeOf: streetlightEnvelope,
  seedInvariant: true,
});

describe("generateStreetlight", () => {
  it("stands on the ground line and reaches its height", () => {
    const geometry = generateStreetlight(defaultStreetlightParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The arm root sits at the pole height.
    expect(bounds.minY).toBeLessThan(-defaultStreetlightParameters.height);
  });

  it("reaches the head out over the carriageway", () => {
    const geometry = generateStreetlight(defaultStreetlightParameters);
    const bounds = pathBounds(geometry.silhouette);
    const reach = defaultStreetlightParameters.armLength *
      defaultStreetlightParameters.height;
    expect(bounds.maxX).toBeGreaterThan(reach * 0.9);
    expect(bounds.maxX).toBeLessThan(
      reach + defaultStreetlightParameters.headLength / 2 + 1,
    );
  });

  it("fills the frame with metal and hangs a glass lens", () => {
    const geometry = generateStreetlight(defaultStreetlightParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "metal",
      "glass",
    ]);
    const lens = geometry.styleZones.find((zone) => zone.role === "glass");
    expect(lens).toBeDefined();
    if (lens !== undefined) {
      // The lens sits inside the head, above the ground.
      const bounds = pathBounds(lens.path);
      expect(bounds.maxY).toBeLessThan(0);
      expect(bounds.minY).toBeGreaterThan(-defaultStreetlightParameters.height * 1.1);
    }
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateStreetlight(defaultStreetlightParameters);
    const second = generateStreetlight(defaultStreetlightParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
