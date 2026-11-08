/**
 * Tests for region composition: clip extents, masks, and draw order.
 */

import { describe, expect, it } from "vitest";

import type { FillStyle } from "@hatch/core";
import { RegionSchema } from "@hatch/core";

import {
  composeRegion,
  composeRegions,
  pathArea,
  pointInPath,
  subpathsOf,
  unitePaths,
} from "../src/index.js";

import {
  circlePath,
  hatchFill,
  rectPath,
  regularPolygonArea,
} from "./fixtures.js";

describe("composeRegion", () => {
  it("passes a plain region through with its fill style", () => {
    const regions = composeRegion({
      id: "sky",
      role: "sky",
      path: rectPath(0, 0, 100, 60),
      fillStyle: hatchFill(),
      zIndex: 0,
    });
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) return;
    expect(region.id).toBe("sky");
    expect(region.role).toBe("sky");
    expect(region.zIndex).toBe(0);
    expect(region.fillStyle).toEqual(hatchFill());
    expect(pathArea(region.path)).toBeCloseTo(6000, 3);
    expect(() => RegionSchema.parse(region)).not.toThrow();
  });

  it("clips a region to its extent", () => {
    const regions = composeRegion({
      id: "field",
      path: rectPath(0, 0, 200, 100),
      fillStyle: hatchFill(),
      clip: rectPath(50, 0, 200, 50),
      zIndex: 1,
    });
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) return;
    expect(pathArea(region.path)).toBeCloseTo(150 * 50, 3);
    expect(pointInPath(region.path, { x: 100, y: 25 })).toBe(true);
    expect(pointInPath(region.path, { x: 25, y: 25 })).toBe(false);
    // The applied clip is geometry now, not a property of the region.
    expect(region.clip).toBeUndefined();
  });

  it("carves masks out of the region as holes", () => {
    const regions = composeRegion({
      id: "sky",
      role: "sky",
      path: rectPath(0, 0, 100, 60),
      fillStyle: hatchFill(),
      masks: [circlePath(50, 30, 12, 24)],
      zIndex: 0,
    });
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) return;
    expect(subpathsOf(region.path)).toHaveLength(2);
    expect(pathArea(region.path)).toBeCloseTo(
      6000 - regularPolygonArea(12, 24),
      3,
    );
    expect(pointInPath(region.path, { x: 50, y: 30 })).toBe(false);
    expect(pointInPath(region.path, { x: 10, y: 10 })).toBe(true);
    expect(() => RegionSchema.parse(region)).not.toThrow();
  });

  it("applies the clip before the masks", () => {
    const regions = composeRegion({
      id: "sea",
      path: rectPath(0, 0, 100, 100),
      fillStyle: hatchFill(),
      clip: rectPath(0, 0, 100, 50),
      masks: [circlePath(50, 25, 10, 24)],
      zIndex: 2,
    });
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) return;
    // The mask center sits inside the clip extent, so the hole exists.
    expect(pointInPath(region.path, { x: 50, y: 25 })).toBe(false);
    expect(pathArea(region.path)).toBeCloseTo(
      100 * 50 - regularPolygonArea(10, 24),
      3,
    );
  });

  it("drops a region that the masks remove completely", () => {
    const regions = composeRegion({
      id: "cloud",
      path: rectPath(0, 0, 20, 20),
      fillStyle: hatchFill(),
      masks: [rectPath(-10, -10, 40, 40)],
      zIndex: 0,
    });
    expect(regions).toEqual([]);
  });

  it("drops a region outside its clip extent", () => {
    const regions = composeRegion({
      id: "far-hill",
      path: rectPath(0, 0, 20, 20),
      fillStyle: hatchFill(),
      clip: rectPath(100, 100, 50, 50),
      zIndex: 0,
    });
    expect(regions).toEqual([]);
  });

  it("keeps disjoint pieces of a clipped region in one compound path", () => {
    const clip = unitePaths([rectPath(0, 0, 40, 40), rectPath(60, 60, 40, 40)]);
    expect(clip).not.toBeNull();
    if (clip === null) return;
    const regions = composeRegion({
      id: "rock",
      path: rectPath(0, 0, 100, 100),
      fillStyle: hatchFill(),
      clip,
      zIndex: 0,
    });
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) return;
    expect(region.id).toBe("rock");
    expect(subpathsOf(region.path)).toHaveLength(2);
    expect(pathArea(region.path)).toBeCloseTo(2 * 40 * 40, 3);
    expect(pointInPath(region.path, { x: 20, y: 20 })).toBe(true);
    expect(pointInPath(region.path, { x: 80, y: 80 })).toBe(true);
    expect(pointInPath(region.path, { x: 50, y: 50 })).toBe(false);
    expect(() => RegionSchema.parse(region)).not.toThrow();
  });

  it("rejects an invalid fill style with a readable error", () => {
    const badStyle = { type: "gradient" } as unknown as FillStyle;
    expect(() =>
      composeRegion({
        id: "bad",
        path: rectPath(0, 0, 10, 10),
        fillStyle: badStyle,
        zIndex: 0,
      }),
    ).toThrow(/composed region is invalid/);
  });
});

describe("composeRegions", () => {
  it("returns the regions in draw order and keeps input order between equals", () => {
    const regions = composeRegions([
      {
        id: "field",
        path: rectPath(0, 0, 10, 10),
        fillStyle: hatchFill(),
        zIndex: 5,
      },
      {
        id: "sky",
        path: rectPath(0, 0, 10, 10),
        fillStyle: hatchFill(),
        zIndex: 1,
      },
      {
        id: "hill",
        path: rectPath(0, 0, 10, 10),
        fillStyle: hatchFill(),
        zIndex: 5,
      },
    ]);
    expect(regions.map((region) => region.id)).toEqual([
      "sky",
      "field",
      "hill",
    ]);
    expect(regions.map((region) => region.zIndex)).toEqual([1, 5, 5]);
  });

  it("composes each input and drops the empty ones", () => {
    const regions = composeRegions([
      {
        id: "visible",
        path: rectPath(0, 0, 10, 10),
        fillStyle: hatchFill(),
        zIndex: 0,
      },
      {
        id: "masked-away",
        path: rectPath(0, 0, 10, 10),
        fillStyle: hatchFill(),
        masks: [rectPath(-10, -10, 30, 30)],
        zIndex: 1,
      },
    ]);
    expect(regions.map((region) => region.id)).toEqual(["visible"]);
  });

  it("gives identical output for identical input", () => {
    const inputs = [
      {
        id: "sky",
        role: "sky",
        path: rectPath(0, 0, 100, 60),
        fillStyle: hatchFill(),
        masks: [circlePath(50, 30, 12, 24)],
        zIndex: 0,
      },
    ];
    const first = composeRegions(inputs);
    const second = composeRegions(inputs);
    expect(second).toEqual(first);
  });
});
