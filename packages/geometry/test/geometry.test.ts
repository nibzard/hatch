/**
 * Package-level tests for @hatch/geometry: identity, exports, and one
 * pipeline that chains every helper the way a render stage will.
 */

import { describe, expect, it } from "vitest";

import { RegionSchema } from "@hatch/core";

import {
  BOOLEAN_OPERATIONS,
  OFFSET_JOINS,
  booleanClip,
  clipStroke,
  composeRegion,
  isClosedPath,
  offsetPath,
  packageName,
  packageRole,
  pathArea,
  pointInPath,
  simplifyPath,
  splineThroughPoints,
} from "../src/index.js";

import {
  circlePoints,
  hatchFill,
  nearestDistance,
  rectPath,
  roundedPath,
  strokePath,
} from "./fixtures.js";

describe("@hatch/geometry", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/geometry");
    expect(packageRole.length).toBeGreaterThan(0);
  });

  it("lists the boolean operations and join styles", () => {
    expect([...BOOLEAN_OPERATIONS]).toEqual([
      "unite",
      "intersect",
      "subtract",
      "exclude",
    ]);
    expect([...OFFSET_JOINS]).toEqual(["miter", "bevel", "round"]);
  });
});

describe("geometry pipeline", () => {
  it("chains spline, offset, composition, clipping, and simplification", () => {
    // A hill region drawn as a spline, shrunk by a contour band,
    // composed as a region, cut by the canvas, and simplified.
    const anchors = [
      { x: 0, y: 120 },
      { x: 60, y: 40 },
      { x: 120, y: 10 },
      { x: 180, y: 60 },
      { x: 240, y: 130 },
      { x: 120, y: 140 },
    ];
    const hill = splineThroughPoints(anchors, { closed: true });
    const band = offsetPath(hill, -8);
    expect(band).not.toBeNull();
    if (band === null) return;

    const regions = composeRegion({
      id: "hill",
      role: "field",
      path: band,
      fillStyle: hatchFill(),
      clip: rectPath(0, 0, 200, 200),
      zIndex: 2,
    });
    expect(regions.length).toBeGreaterThanOrEqual(1);
    for (const region of regions) {
      expect(() => RegionSchema.parse(region)).not.toThrow();
    }
    const hillRegion = regions[0];
    if (hillRegion === undefined) return;

    const simplified = simplifyPath(hillRegion.path, 1);
    expect(simplified.commands.length).toBeLessThanOrEqual(
      hillRegion.path.commands.length,
    );

    // A stroke across the region stops at its boundary.
    const crossing = strokePath({ x: 100, y: -50 }, { x: 100, y: 300 });
    const pieces = clipStroke(crossing, hillRegion.path);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const piece of pieces) {
      expect(isClosedPath(piece)).toBe(false);
      const firstCommand = piece.commands[0];
      if (firstCommand !== undefined && firstCommand.command !== "close") {
        // The clipped piece starts inside the canvas, below the stroke
        // start outside the region.
        expect(firstCommand.to.y).toBeGreaterThan(-50);
      }
    }

    // The whole pipeline is deterministic: identical input gives
    // identical output (specification section 10).
    const bandAgain = offsetPath(hill, -8);
    expect(bandAgain).not.toBeNull();
    if (bandAgain !== null) {
      expect(roundedPath(bandAgain)).toEqual(roundedPath(band));
    }
  });

  it("reduces the anchors of a spline hill within the tolerance", () => {
    const anchors = circlePoints(100, 100, 60, 24);
    const hill = splineThroughPoints(anchors, { closed: true });
    const simplified = simplifyPath(hill, 2);
    expect(simplified.commands.length).toBeLessThanOrEqual(
      hill.commands.length,
    );
    for (const anchor of anchors) {
      expect(nearestDistance(simplified, anchor)).toBeLessThanOrEqual(
        2 + 1e-6,
      );
    }
  });

  it("clips overlapping spline regions to their shared area", () => {
    const first = splineThroughPoints(circlePoints(60, 60, 40, 8), {
      closed: true,
    });
    const second = splineThroughPoints(circlePoints(90, 60, 40, 8), {
      closed: true,
    });
    const overlap = booleanClip(first, second, "intersect");
    expect(overlap).not.toBeNull();
    if (overlap !== null) {
      expect(pathArea(overlap)).toBeGreaterThan(100);
      expect(pointInPath(overlap, { x: 75, y: 60 })).toBe(true);
      expect(pointInPath(overlap, { x: 25, y: 60 })).toBe(false);
    }
  });
});
