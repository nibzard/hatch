/**
 * Tests for simplification within a tolerance.
 */

import { describe, expect, it } from "vitest";

import type { Point } from "@hatch/core";

import {
  isClosedPath,
  simplifyPath,
  simplifyPolyline,
  splineThroughPoints,
} from "../src/index.js";

import {
  circlePath,
  circlePoints,
  nearestDistance,
  roundedPath,
} from "./fixtures.js";

/** A dense circle polygon with 64 anchors. */
const denseCircle = circlePath(100, 100, 50, 64);

describe("simplifyPath within tolerance", () => {
  it("keeps every original anchor within the tolerance", () => {
    const simplified = simplifyPath(denseCircle, 2);
    for (const anchor of circlePoints(100, 100, 50, 64)) {
      expect(nearestDistance(simplified, anchor)).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it("reduces the command count of a dense polygon", () => {
    const simplified = simplifyPath(denseCircle, 2);
    expect(simplified.commands.length).toBeLessThan(denseCircle.commands.length);
    // A circle still needs several anchors: far fewer than 64, clearly
    // more than a triangle.
    expect(simplified.commands.length).toBeLessThan(40);
    expect(simplified.commands.length).toBeGreaterThan(5);
    expect(isClosedPath(simplified)).toBe(true);
  });

  it("keeps the area close to the original for a modest tolerance", () => {
    const simplified = simplifyPath(denseCircle, 1);
    // The tolerance bounds the drift of the contour, so the area moves
    // by no more than the perimeter times the tolerance.
    const originalArea = Math.PI * 50 * 50;
    expect(Math.abs(areaOf(simplified) - originalArea)).toBeLessThan(
      2 * Math.PI * 50 * 1,
    );
  });

  it("flattens a nearly straight polyline into few commands", () => {
    const jittered: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 1.5 },
      { x: 20, y: -1 },
      { x: 30, y: 0.8 },
      { x: 40, y: 0 },
      { x: 50, y: 1.2 },
      { x: 60, y: 0 },
    ];
    const simplified = simplifyPath(
      {
        commands: [
          { command: "move", to: jittered[0] as Point },
          ...jittered
            .slice(1)
            .map((point) => ({ command: "line" as const, to: point })),
        ],
      },
      2,
    );
    expect(simplified.commands.length).toBeLessThan(jittered.length);
    for (const point of jittered) {
      expect(nearestDistance(simplified, point)).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it("simplifies a smooth spline within the tolerance", () => {
    const spline = splineThroughPoints(
      circlePoints(50, 50, 30, 12),
      { closed: true },
    );
    const simplified = simplifyPath(spline, 1);
    expect(simplified.commands.length).toBeLessThanOrEqual(
      spline.commands.length,
    );
    for (const anchor of circlePoints(50, 50, 30, 12)) {
      expect(nearestDistance(simplified, anchor)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("returns the input unchanged for a zero tolerance", () => {
    const simplified = simplifyPath(denseCircle, 0);
    expect(simplified.commands).toEqual(denseCircle.commands);
  });

  it("gives identical output for identical input", () => {
    const first = simplifyPath(denseCircle, 2);
    const second = simplifyPath(denseCircle, 2);
    expect(roundedPath(second)).toEqual(roundedPath(first));
  });

  it("rejects a negative tolerance", () => {
    expect(() => simplifyPath(denseCircle, -1)).toThrow(/tolerance/);
  });
});

describe("simplifyPolyline", () => {
  it("keeps only the endpoints of a straight line", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(simplifyPolyline(points, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("keeps every point for a zero tolerance", () => {
    const points = circlePoints(0, 0, 10, 8);
    const kept = simplifyPolyline([...points, points[0] as Point], 0);
    expect(kept).toHaveLength(points.length + 1);
  });

  it("keeps a subset of the input, in input order", () => {
    const points = circlePoints(0, 0, 10, 16);
    const ring = [...points, points[0] as Point];
    const kept = simplifyPolyline(ring, 1);
    expect(kept.length).toBeLessThan(ring.length);
    expect(kept[0]).toEqual(ring[0]);
    expect(kept[kept.length - 1]).toEqual(ring[ring.length - 1]);
    // Every kept point is one of the input points.
    const inputKeys = new Set(ring.map((point) => `${point.x},${point.y}`));
    for (const point of kept) {
      expect(inputKeys.has(`${point.x},${point.y}`)).toBe(true);
    }
  });

  it("keeps a sharp corner that exceeds the tolerance", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ];
    // The corner drifts 10 units from the chord, so it must stay for
    // any tolerance below that.
    expect(simplifyPolyline(points, 5)).toEqual(points);
    expect(simplifyPolyline(points, 12)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("keeps every dropped point within the tolerance of the result", () => {
    const points = circlePoints(0, 0, 20, 24);
    const kept = simplifyPolyline(points, 1.5);
    for (const point of points) {
      const distance = distanceToPolyline(point, kept);
      expect(distance).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it("returns short inputs unchanged", () => {
    const single: Point[] = [{ x: 1, y: 2 }];
    expect(simplifyPolyline(single, 1)).toEqual(single);
    const pair: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(simplifyPolyline(pair, 1)).toEqual(pair);
  });

  it("rejects a negative tolerance", () => {
    expect(() =>
      simplifyPolyline(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        -0.5,
      ),
    ).toThrow(/tolerance/);
  });
});

/** Area of a closed polygon path, by the shoelace formula. */
function areaOf(path: { commands: ReadonlyArray<{ command: string; to?: Point }> }): number {
  const anchors = path.commands
    .filter((command) => command.to !== undefined)
    .map((command) => command.to as Point);
  let sum = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index];
    const next = anchors[(index + 1) % anchors.length];
    if (current === undefined || next === undefined) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

/** Shortest distance from a point to a polyline through the points. */
function distanceToPolyline(point: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared < 1e-18) {
      best = Math.min(best, Math.hypot(point.x - a.x, point.y - a.y));
      continue;
    }
    const t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared;
    const clamped = Math.min(1, Math.max(0, t));
    best = Math.min(
      best,
      Math.hypot(point.x - a.x - clamped * abx, point.y - a.y - clamped * aby),
    );
  }
  return best;
}
