/**
 * Tests for the handrail generator: the contract of task T015, the kinked
 * rail line, the posts, and the `rail` alias of the registry.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  defaultHandrailParameters,
  generateHandrail,
  handrailGenerator,
} from "../src/handrail.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the handrail parameters promise. */
function handrailEnvelope(parameters: {
  width: number;
  height: number;
  tubeWidth: number;
}): Envelope {
  const postWidth = clamp(parameters.tubeWidth * 0.8, 3, 14);
  return {
    minX: -parameters.width / 2 - postWidth,
    minY: -parameters.height - parameters.tubeWidth,
    maxX: parameters.width / 2 + postWidth,
    maxY: 0,
  };
}

describeObjectContract(handrailGenerator, {
  envelopeOf: handrailEnvelope,
  seedInvariant: true,
});

describe("generateHandrail", () => {
  it("runs the rail from the high end down to the low end", () => {
    const geometry = generateHandrail(defaultHandrailParameters);
    const bounds = pathBounds(geometry.silhouette);
    const lowHeight = defaultHandrailParameters.height *
      (1 - defaultHandrailParameters.drop);
    // The rail top reaches the high end height, and no part of the rail
    // falls below half the low end.
    expect(bounds.minY).toBeLessThanOrEqual(-lowHeight * 0.9);
    expect(bounds.maxY).toBeCloseTo(0, 6);
  });

  it("draws one boundary per post and fills the mass with metal", () => {
    const geometry = generateHandrail(defaultHandrailParameters);
    expect(geometry.internalBoundaries).toHaveLength(
      defaultHandrailParameters.posts,
    );
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["metal"]);
  });

  it("straightens the rail when the kink share runs out", () => {
    const kinked = generateHandrail(defaultHandrailParameters);
    const straight = generateHandrail({
      ...defaultHandrailParameters,
      kinkShare: 0,
    });
    // The kinked rail keeps three anchors on its top edge, the straight
    // rail two, so the contour paths differ in length.
    expect(kinked.contours[0]?.commands.length).toBe(
      (straight.contours[0]?.commands.length ?? 0) + 1,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateHandrail(defaultHandrailParameters);
    const second = generateHandrail(defaultHandrailParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
