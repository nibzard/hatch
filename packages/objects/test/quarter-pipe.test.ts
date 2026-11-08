/**
 * Tests for the quarter pipe generator: the contract of task T015, the
 * riding curve, the platform, and the coping at the lip.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  defaultQuarterPipeParameters,
  generateQuarterPipe,
  quarterPipeGenerator,
} from "../src/quarter-pipe.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the quarter pipe parameters promise, with spline room. */
function quarterPipeEnvelope(parameters: {
  width: number;
  height: number;
  platform: number;
}): Envelope {
  const deck = parameters.platform >= 1 ? parameters.platform : 0;
  const thickness = deck === 0 ? 0 : clamp(deck * 0.3, 4, 24);
  // The riding spline bulges a little past its lip anchor.
  const slack = parameters.height * 0.02 + 1;
  return {
    minX: -parameters.width / 2,
    minY: -(parameters.height + thickness + slack),
    maxX: parameters.width / 2 + deck,
    maxY: slack,
  };
}

describeObjectContract(quarterPipeGenerator, {
  envelopeOf: quarterPipeEnvelope,
  seedInvariant: true,
});

describe("generateQuarterPipe", () => {
  it("stands on the ground line and reaches the lip height", () => {
    const geometry = generateQuarterPipe(defaultQuarterPipeParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The lip anchor is the highest point of the riding spline, give or
    // take the bulge of the curve past its anchor.
    expect(Math.abs(bounds.minY + defaultQuarterPipeParameters.height)).toBeLessThan(
      defaultQuarterPipeParameters.height * 0.02 + 1,
    );
    expect(bounds.minX).toBeCloseTo(-defaultQuarterPipeParameters.width / 2, 5);
  });

  it("fills the riding face with concrete and the deck with pavement", () => {
    const geometry = generateQuarterPipe(defaultQuarterPipeParameters);
    const roles = geometry.styleZones.map((zone) => zone.role);
    expect(roles).toEqual(["concrete", "pavement"]);
    const face = geometry.styleZones.find((zone) => zone.role === "concrete");
    expect(face).toBeDefined();
    if (face !== undefined) {
      // A point under the transition is inside the ramp body.
      expect(
        pointInPath(face.path, {
          x: defaultQuarterPipeParameters.width * 0.42,
          y: -defaultQuarterPipeParameters.height * 0.5,
        }),
      ).toBe(true);
    }
  });

  it("drops the platform when the platform depth runs out", () => {
    const geometry = generateQuarterPipe({
      ...defaultQuarterPipeParameters,
      platform: 0,
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["concrete"]);
    expect(pathBounds(geometry.silhouette).maxX).toBeCloseTo(
      defaultQuarterPipeParameters.width / 2,
      6,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateQuarterPipe(defaultQuarterPipeParameters);
    const second = generateQuarterPipe(defaultQuarterPipeParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
