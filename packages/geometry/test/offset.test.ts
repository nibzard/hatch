/**
 * Tests for path offsets: growing, shrinking, and side movement.
 */

import { describe, expect, it } from "vitest";

import {
  booleanClip,
  isClosedPath,
  offsetPath,
  pathArea,
  pathBounds,
  pathLength,
  pathPoints,
  pointInPath,
} from "../src/index.js";

import {
  circlePath,
  polygonPath,
  rectPath,
  regularPolygonArea,
  roundedPath,
  strokePath,
} from "./fixtures.js";

describe("offsetPath on closed regions", () => {
  it("grows a rectangle by the distance with round joins", () => {
    const grown = offsetPath(rectPath(0, 0, 100, 100), 5);
    expect(grown).not.toBeNull();
    if (grown !== null) {
      const bounds = pathBounds(grown);
      expect(bounds.minX).toBeCloseTo(-5, 2);
      expect(bounds.minY).toBeCloseTo(-5, 2);
      expect(bounds.maxX).toBeCloseTo(105, 2);
      expect(bounds.maxY).toBeCloseTo(105, 2);
      // Straight edges add perimeter times distance; four quarter arcs
      // add the area of one circle with the offset radius.
      expect(pathArea(grown)).toBeGreaterThan(10000 + 400 * 5 - 1);
      expect(pathArea(grown)).toBeLessThan(10000 + 400 * 5 + Math.PI * 25 + 1);
      expect(isClosedPath(grown)).toBe(true);
    }
  });

  it("grows a rectangle to the exact miter area", () => {
    const grown = offsetPath(rectPath(0, 0, 100, 100), 5, { join: "miter" });
    expect(grown).not.toBeNull();
    if (grown !== null) {
      expect(pathArea(grown)).toBeCloseTo(110 * 110, 3);
    }
  });

  it("shrinks a rectangle by the distance", () => {
    const shrunk = offsetPath(rectPath(0, 0, 100, 100), -5);
    expect(shrunk).not.toBeNull();
    if (shrunk !== null) {
      expect(pathArea(shrunk)).toBeCloseTo(90 * 90, 3);
      expect(pointInPath(shrunk, { x: 7, y: 50 })).toBe(true);
      expect(pointInPath(shrunk, { x: 3, y: 50 })).toBe(false);
    }
  });

  it("grows a region whatever the winding of the input", () => {
    const reversed = polygonPath(
      [...pathPoints(rectPath(0, 0, 100, 100))].reverse(),
    );
    const grown = offsetPath(reversed, 5);
    expect(grown).not.toBeNull();
    if (grown !== null) {
      expect(pathArea(grown)).toBeGreaterThan(12000);
      expect(pointInPath(grown, { x: 50, y: -2 })).toBe(true);
    }
  });

  it("shrinks holes of a compound region along with the outer contour", () => {
    const region = booleanClip(
      rectPath(0, 0, 100, 100),
      circlePath(50, 50, 15, 24),
      "subtract",
    );
    expect(region).not.toBeNull();
    const grown = region === null ? null : offsetPath(region, 5);
    expect(grown).not.toBeNull();
    if (grown !== null) {
      // The outer contour grows to 110 x 110, the hole shrinks by the
      // distance. The join arcs of the offset leave a small margin, so
      // the check bounds the area instead of pinning it.
      const outer = 110 * 110;
      const hole = regularPolygonArea(10, 24);
      expect(pathArea(grown)).toBeGreaterThan(outer - hole - 25);
      expect(pathArea(grown)).toBeLessThan(outer - hole + 25);
      expect(pointInPath(grown, { x: 50, y: 50 })).toBe(false);
      // The grown outer contour spans -5 to 105.
      expect(pointInPath(grown, { x: 50, y: 104 })).toBe(true);
    }
  });

  it("returns null when a shrink removes the whole region", () => {
    expect(offsetPath(rectPath(0, 0, 10, 10), -20)).toBeNull();
  });

  it("returns the same geometry for a zero distance", () => {
    const rect = rectPath(10, 10, 40, 20);
    const unchanged = offsetPath(rect, 0);
    expect(unchanged).not.toBeNull();
    if (unchanged !== null) {
      expect(pathArea(unchanged)).toBeCloseTo(pathArea(rect), 6);
      expect(pathBounds(unchanged)).toEqual(pathBounds(rect));
    }
  });
});

describe("offsetPath on open strokes", () => {
  it("moves a horizontal stroke by the distance", () => {
    const moved = offsetPath(strokePath({ x: 0, y: 0 }, { x: 100, y: 0 }), 10);
    expect(moved).not.toBeNull();
    if (moved !== null) {
      expect(pathLength(moved)).toBeCloseTo(100, 3);
      const bounds = pathBounds(moved);
      expect(bounds.minY).toBeCloseTo(-10, 3);
      expect(bounds.maxY).toBeCloseTo(-10, 3);
      expect(isClosedPath(moved)).toBe(false);
    }
  });

  it("moves the same stroke to the other side for a negative distance", () => {
    const moved = offsetPath(strokePath({ x: 0, y: 0 }, { x: 100, y: 0 }), -10);
    expect(moved).not.toBeNull();
    if (moved !== null) {
      const bounds = pathBounds(moved);
      expect(bounds.minY).toBeCloseTo(10, 3);
    }
  });
});

describe("offsetPath determinism and validation", () => {
  it("gives identical output for identical input", () => {
    const first = offsetPath(rectPath(0, 0, 100, 100), 4);
    const second = offsetPath(rectPath(0, 0, 100, 100), 4);
    expect(second).not.toBeNull();
    expect(first).not.toBeNull();
    if (first !== null && second !== null) {
      expect(roundedPath(second)).toEqual(roundedPath(first));
    }
  });

  it("rejects an unknown join style, a non-finite distance, and a low miter limit", () => {
    const rect = rectPath(0, 0, 10, 10);
    expect(() => offsetPath(rect, 5, { join: "sharp" as never })).toThrow(
      /join/,
    );
    expect(() => offsetPath(rect, Number.NaN)).toThrow(/finite/);
    expect(() => offsetPath(rect, 5, { miterLimit: 0.5 })).toThrow(
      /miterLimit/,
    );
  });
});
