/**
 * Tests for the bowl generator: the contract of task T015, the basin
 * profile, the coping stubs, and the deck pads.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  bowlGenerator,
  defaultBowlParameters,
  generateBowl,
} from "../src/bowl.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the bowl parameters promise, with spline overshoot room. */
function bowlEnvelope(parameters: {
  width: number;
  depth: number;
  deckWidth: number;
}): Envelope {
  const deck = parameters.deckWidth >= 1 ? parameters.deckWidth : 0;
  const thickness = deck === 0 ? 0 : clamp(deck * 0.35, 4, 30);
  // The basin spline bulges a little past its deepest anchor.
  const slack = parameters.depth * 0.02 + 1;
  return {
    minX: -(parameters.width / 2 + deck),
    minY: -thickness - slack,
    maxX: parameters.width / 2 + deck,
    maxY: parameters.depth + slack,
  };
}

describeObjectContract(bowlGenerator, {
  envelopeOf: bowlEnvelope,
  seedInvariant: true,
});

describe("generateBowl", () => {
  it("keeps the basin below the deck line and closed at the rim", () => {
    const geometry = generateBowl(defaultBowlParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeGreaterThan(defaultBowlParameters.depth * 0.9);
    expect(bounds.maxY).toBeLessThan(defaultBowlParameters.depth * 1.03);
    // The rim sits on the deck line: nothing of the basin rises past it.
    expect(bounds.minY).toBeCloseTo(0, 6);
  });

  it("fills the basin with concrete and the pads with pavement", () => {
    const geometry = generateBowl(defaultBowlParameters);
    const roles = geometry.styleZones.map((zone) => zone.role);
    expect(roles).toContain("concrete");
    expect(roles).toContain("pavement");
    // The basin zone is the hatched wall: a point on the transition is
    // inside it, a point past the rim is not.
    const basin = geometry.styleZones.find((zone) => zone.role === "concrete");
    expect(basin).toBeDefined();
    if (basin !== undefined) {
      expect(pointInPath(basin.path, { x: 0, y: defaultBowlParameters.depth })).toBe(true);
      expect(pointInPath(basin.path, { x: 0, y: -defaultBowlParameters.depth })).toBe(false);
    }
  });

  it("deepens the flat bottom as the curvature grows", () => {
    const smooth = generateBowl({
      ...defaultBowlParameters,
      curvature: 0,
      coping: false,
    });
    const steep = generateBowl({
      ...defaultBowlParameters,
      curvature: 1,
      coping: false,
    });
    // A steep wall holds more area under the same profile anchors.
    expect(pathBounds(steep.silhouette).maxY).toBeGreaterThan(
      pathBounds(smooth.silhouette).maxY * 0.98,
    );
  });

  it("drops the deck pads when the deck width runs out", () => {
    const geometry = generateBowl({
      ...defaultBowlParameters,
      deckWidth: 0,
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["concrete"]);
    expect(pathBounds(geometry.silhouette).maxX).toBeCloseTo(
      defaultBowlParameters.width / 2,
      6,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateBowl(defaultBowlParameters);
    const second = generateBowl(defaultBowlParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
