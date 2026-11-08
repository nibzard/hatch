/**
 * Tests for the lamp post generator: the contract of task T015, the post,
 * the lantern, and the pane lines.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import {
  defaultLampPostParameters,
  generateLampPost,
  lampPostGenerator,
} from "../src/lamp-post.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the lamp post parameters promise. */
function lampPostEnvelope(parameters: {
  height: number;
  lanternSize: number;
  baseWidth: number;
}): Envelope {
  // The collar under the lantern and the plinth at the ground are the two
  // widest frame pieces, and the lantern sits over both of them.
  const collar = Math.min(Math.max(parameters.height * 0.018, 3), 10) * 1.7;
  const foot = Math.min(Math.max(parameters.height * 0.045, 5), 22);
  const plinth = Math.max(parameters.baseWidth / 2, foot * 0.62 * 1.25);
  const spread = Math.max(plinth, parameters.lanternSize * 0.52, collar / 2);
  return {
    minX: -spread,
    minY: -(parameters.height + parameters.lanternSize * 1.35),
    maxX: spread,
    maxY: 0,
  };
}

describeObjectContract(lampPostGenerator, {
  envelopeOf: lampPostEnvelope,
  seedInvariant: true,
});

describe("generateLampPost", () => {
  it("stands on the ground line and carries the lantern above the post", () => {
    const geometry = generateLampPost(defaultLampPostParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeLessThan(
      -defaultLampPostParameters.height - defaultLampPostParameters.lanternSize * 0.5,
    );
  });

  it("fills the frame with metal and the lantern with glass", () => {
    const geometry = generateLampPost(defaultLampPostParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "metal",
      "glass",
    ]);
    const lantern = geometry.styleZones.find((zone) => zone.role === "glass");
    expect(lantern).toBeDefined();
    if (lantern !== undefined) {
      const bounds = pathBounds(lantern.path);
      // The lantern sits above the post top and stays narrow.
      expect(bounds.maxY).toBeLessThanOrEqual(-defaultLampPostParameters.height);
      expect(bounds.minY).toBeGreaterThan(
        -defaultLampPostParameters.height -
          defaultLampPostParameters.lanternSize * 1.1,
      );
    }
  });

  it("splits the lantern into one pane line per pane boundary", () => {
    const geometry = generateLampPost({
      ...defaultLampPostParameters,
      panes: 4,
    });
    // Two base lines plus three pane lines, and the finial adds one.
    expect(geometry.internalBoundaries).toHaveLength(6);
  });

  it("drops the finial on request", () => {
    const withFinial = generateLampPost(defaultLampPostParameters);
    const withoutFinial = generateLampPost({
      ...defaultLampPostParameters,
      finial: false,
    });
    expect(pathBounds(withFinial.silhouette).minY).toBeCloseTo(
      pathBounds(withoutFinial.silhouette).minY,
      6,
    );
    expect(withoutFinial.internalBoundaries).toHaveLength(
      withFinial.internalBoundaries.length - 1,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateLampPost(defaultLampPostParameters);
    const second = generateLampPost(defaultLampPostParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
