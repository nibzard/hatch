/**
 * Tests for the fence generator: the contract of task T015, the posts, the
 * rails, and the pickets.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  defaultFenceParameters,
  fenceGenerator,
  generateFence,
} from "../src/fence.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the fence parameters promise. */
function fenceEnvelope(parameters: {
  width: number;
  height: number;
  pointed: boolean;
}): Envelope {
  const postWidth = clamp(parameters.height * 0.09, 4, 18);
  const picketWidth = clamp(parameters.height * 0.06, 3, 12);
  const picketTop = parameters.pointed
    ? -parameters.height * 0.92 - picketWidth / 2
    : -parameters.height * 0.92;
  return {
    minX: -parameters.width / 2 - postWidth / 2,
    minY: Math.min(-parameters.height, picketTop),
    maxX: parameters.width / 2 + postWidth / 2,
    maxY: 0,
  };
}

describeObjectContract(fenceGenerator, {
  envelopeOf: fenceEnvelope,
  seedInvariant: true,
});

describe("generateFence", () => {
  it("stands on the ground line inside its height", () => {
    const geometry = generateFence(defaultFenceParameters);
    const bounds = pathBounds(geometry.silhouette);
    const postWidth = clamp(defaultFenceParameters.height * 0.09, 4, 18);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeCloseTo(-defaultFenceParameters.height, 6);
    // The end posts stand on the span ends, half a post past each.
    expect(bounds.minX).toBeCloseTo(
      -(defaultFenceParameters.width / 2 + postWidth / 2),
      6,
    );
    expect(bounds.maxX).toBeCloseTo(
      defaultFenceParameters.width / 2 + postWidth / 2,
      6,
    );
  });

  it("draws one boundary per post, rail, and picket that fits", () => {
    const geometry = generateFence(defaultFenceParameters);
    expect(geometry.internalBoundaries.length).toBeLessThanOrEqual(
      defaultFenceParameters.posts +
        defaultFenceParameters.rails +
        defaultFenceParameters.pickets,
    );
    expect(geometry.internalBoundaries.length).toBeGreaterThanOrEqual(
      defaultFenceParameters.posts + defaultFenceParameters.rails,
    );
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["architecture"]);
  });

  it("drops every picket that would cross a post", () => {
    const geometry = generateFence({
      ...defaultFenceParameters,
      width: 60,
      posts: 8,
      rails: 0,
      pickets: 24,
    });
    // The posts stand under 9 units apart, so no picket fits between two of
    // them: the run keeps its eight posts and nothing else.
    expect(geometry.internalBoundaries).toHaveLength(8);
  });

  it("points the picket tops on request", () => {
    const plain = generateFence(defaultFenceParameters);
    const pointed = generateFence({
      ...defaultFenceParameters,
      pointed: true,
    });
    const lastOf = (geometry: typeof plain) => {
      const last = geometry.internalBoundaries[
        geometry.internalBoundaries.length - 1
      ];
      if (last === undefined) {
        throw new Error("the fence test expected at least one picket");
      }
      return last;
    };
    // A pointed picket carries one anchor more than a flat one: the peak.
    expect(lastOf(pointed).commands.length).toBe(
      lastOf(plain).commands.length + 1,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateFence(defaultFenceParameters);
    const second = generateFence(defaultFenceParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
