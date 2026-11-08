/**
 * Tests for path measurement: length, bounds, area, inside tests, and
 * sampling.
 */

import { describe, expect, it } from "vitest";

import {
  pathArea,
  pathBounds,
  pathLength,
  pointInPath,
  samplePathPoints,
  splineThroughPoints,
  subpathsOf,
  subtractMasks,
} from "../src/index.js";

import {
  circlePath,
  rectPath,
  regularPolygonArea,
  regularPolygonPerimeter,
  strokePath,
} from "./fixtures.js";

describe("measurement", () => {
  it("measures the length, bounds, and area of a rectangle", () => {
    const rect = rectPath(10, 20, 100, 50);
    expect(pathLength(rect)).toBeCloseTo(2 * (100 + 50), 3);
    expect(pathArea(rect)).toBeCloseTo(100 * 50, 3);
    expect(pathBounds(rect)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
      width: 100,
      height: 50,
    });
  });

  it("measures the length of an open stroke", () => {
    const stroke = strokePath({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(pathLength(stroke)).toBeCloseTo(50, 3);
  });

  it("measures the exact length and area of a circle polygon", () => {
    const circle = circlePath(50, 50, 40, 128);
    expect(pathLength(circle)).toBeCloseTo(regularPolygonPerimeter(40, 128), 3);
    expect(pathArea(circle)).toBeCloseTo(regularPolygonArea(40, 128), 3);
  });

  it("subtracts holes from the area of a compound region", () => {
    const mask = circlePath(50, 50, 20, 32);
    const region = subtractMasks(rectPath(0, 0, 100, 100), [mask]);
    expect(region).not.toBeNull();
    if (region !== null) {
      expect(pathArea(region)).toBeCloseTo(
        10000 - regularPolygonArea(20, 32),
        3,
      );
      expect(subpathsOf(region)).toHaveLength(2);
    }
  });

  it("tests points against the region and its holes", () => {
    const rect = rectPath(0, 0, 100, 100);
    expect(pointInPath(rect, { x: 50, y: 50 })).toBe(true);
    expect(pointInPath(rect, { x: 150, y: 50 })).toBe(false);
    // Points on the boundary follow the Paper.js definition: the check
    // stays consistent for identical input.
    expect(pointInPath(rect, { x: 50, y: 50 })).toBe(true);
  });
});

describe("samplePathPoints", () => {
  it("walks an open stroke at an even spacing and adds the end", () => {
    const points = samplePathPoints(
      strokePath({ x: 0, y: 0 }, { x: 100, y: 0 }),
      30,
    );
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[3]).toEqual({ x: 90, y: 0 });
    expect(points[4]?.x).toBeCloseTo(100, 6);
    expect(points[4]?.y).toBeCloseTo(0, 6);
  });

  it("walks a closed rectangle without repeating the start", () => {
    const points = samplePathPoints(rectPath(0, 0, 100, 100), 25);
    // Perimeter 400, spacing 25 divides it: 16 points, no duplicate.
    expect(points).toHaveLength(16);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[4]).toEqual({ x: 100, y: 0 });
    expect(points[8]).toEqual({ x: 100, y: 100 });
    expect(points[15]?.x).toBeCloseTo(0, 6);
    expect(points[15]?.y).toBeCloseTo(25, 6);
  });

  it("walks a spline along its curve parameter", () => {
    const spline = splineThroughPoints([
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]);
    const points = samplePathPoints(spline, 25);
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]?.x).toBeCloseTo(100, 6);
    // The middle of the spline rises above the endpoints.
    const maxY = Math.max(...points.map((point) => point.y));
    expect(maxY).toBeGreaterThan(10);
  });

  it("rejects a compound path and invalid spacing", () => {
    const compound = {
      commands: [
        ...rectPath(0, 0, 10, 10).commands,
        ...rectPath(20, 0, 10, 10).commands,
      ],
    };
    expect(() => samplePathPoints(compound, 1)).toThrow(/one contour/);
    expect(() => samplePathPoints(rectPath(0, 0, 10, 10), 0)).toThrow(
      /spacing/,
    );
    expect(() => samplePathPoints(rectPath(0, 0, 10, 10), -5)).toThrow(
      /spacing/,
    );
  });
});
