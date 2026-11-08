/**
 * Tests for boolean clipping of overlapping regions and for stroke
 * clipping against region boundaries.
 */

import { describe, expect, it } from "vitest";

import type { Path } from "@hatch/core";

import {
  booleanClip,
  carveStroke,
  clipStroke,
  isClosedPath,
  pathArea,
  pathLength,
  pointInPath,
  subpathsOf,
  subtractMasks,
  unitePaths,
} from "../src/index.js";

import {
  circlePath,
  rectPath,
  regularPolygonArea,
  roundedPath,
  strokePath,
} from "./fixtures.js";

/** Two overlapping unit regions: a square and its diagonal twin. */
const leftSquare = rectPath(0, 0, 100, 100);
const rightSquare = rectPath(50, 50, 100, 100);

describe("booleanClip on overlapping regions", () => {
  it("intersects two overlapping rectangles to the shared area", () => {
    const overlap = booleanClip(leftSquare, rightSquare, "intersect");
    expect(overlap).not.toBeNull();
    if (overlap !== null) {
      expect(pathArea(overlap)).toBeCloseTo(50 * 50, 3);
      expect(pointInPath(overlap, { x: 75, y: 75 })).toBe(true);
      expect(pointInPath(overlap, { x: 25, y: 25 })).toBe(false);
    }
  });

  it("subtracts the overlap from the subject", () => {
    const rest = booleanClip(leftSquare, rightSquare, "subtract");
    expect(rest).not.toBeNull();
    if (rest !== null) {
      expect(pathArea(rest)).toBeCloseTo(100 * 100 - 50 * 50, 3);
      expect(pointInPath(rest, { x: 25, y: 25 })).toBe(true);
      expect(pointInPath(rest, { x: 75, y: 75 })).toBe(false);
    }
  });

  it("unites two overlapping rectangles", () => {
    const union = booleanClip(leftSquare, rightSquare, "unite");
    expect(union).not.toBeNull();
    if (union !== null) {
      expect(pathArea(union)).toBeCloseTo(2 * 100 * 100 - 50 * 50, 3);
      expect(pointInPath(union, { x: 25, y: 25 })).toBe(true);
      expect(pointInPath(union, { x: 125, y: 125 })).toBe(true);
    }
  });

  it("excludes the shared area of both regions", () => {
    const remainder = booleanClip(leftSquare, rightSquare, "exclude");
    expect(remainder).not.toBeNull();
    if (remainder !== null) {
      expect(pathArea(remainder)).toBeCloseTo(2 * (100 * 100 - 50 * 50), 3);
      expect(pointInPath(remainder, { x: 25, y: 25 })).toBe(true);
      expect(pointInPath(remainder, { x: 125, y: 125 })).toBe(true);
      expect(pointInPath(remainder, { x: 75, y: 75 })).toBe(false);
    }
  });

  it("returns null for the intersection of disjoint regions", () => {
    const far = rectPath(500, 500, 100, 100);
    expect(booleanClip(leftSquare, far, "intersect")).toBeNull();
  });

  it("carves a circular hole out of a rectangle", () => {
    const mask = circlePath(50, 50, 15, 24);
    const clouded = subtractMasks(rectPath(0, 0, 100, 100), [mask]);
    expect(clouded).not.toBeNull();
    if (clouded !== null) {
      expect(subpathsOf(clouded)).toHaveLength(2);
      expect(pathArea(clouded)).toBeCloseTo(
        100 * 100 - regularPolygonArea(15, 24),
        3,
      );
      // The hole excludes the points inside it.
      expect(pointInPath(clouded, { x: 50, y: 50 })).toBe(false);
      expect(pointInPath(clouded, { x: 10, y: 10 })).toBe(true);
    }
  });

  it("subtracts several masks at once", () => {
    const carved = subtractMasks(rectPath(0, 0, 100, 60), [
      circlePath(25, 30, 10, 16),
      circlePath(75, 30, 10, 16),
    ]);
    expect(carved).not.toBeNull();
    if (carved !== null) {
      expect(pathArea(carved)).toBeCloseTo(
        100 * 60 - 2 * regularPolygonArea(10, 16),
        3,
      );
    }
  });

  it("unites disjoint pieces into one compound region", () => {
    const union = unitePaths([rectPath(0, 0, 40, 40), rectPath(60, 60, 40, 40)]);
    expect(union).not.toBeNull();
    if (union !== null) {
      expect(pathArea(union)).toBeCloseTo(2 * 40 * 40, 3);
      expect(pointInPath(union, { x: 20, y: 20 })).toBe(true);
      expect(pointInPath(union, { x: 80, y: 80 })).toBe(true);
      expect(pointInPath(union, { x: 50, y: 50 })).toBe(false);
    }
  });

  it("unites overlapping pieces without double-counted area", () => {
    const union = unitePaths([leftSquare, rightSquare]);
    expect(union).not.toBeNull();
    if (union !== null) {
      expect(pathArea(union)).toBeCloseTo(17500, 3);
    }
  });

  it("returns null for an empty input list", () => {
    expect(unitePaths([])).toBeNull();
  });

  it("gives identical output for identical input", () => {
    const first = booleanClip(leftSquare, rightSquare, "subtract");
    const second = booleanClip(leftSquare, rightSquare, "subtract");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first !== null && second !== null) {
      expect(roundedPath(second)).toEqual(roundedPath(first));
    }
  });

  it("rejects an unknown operation", () => {
    expect(() =>
      booleanClip(leftSquare, rightSquare, "xor" as never),
    ).toThrow(/operation/);
  });
});

describe("clipStroke against regions", () => {
  it("trims a crossing stroke to the region", () => {
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    const pieces = clipStroke(stroke, leftSquare);
    expect(pieces).toHaveLength(1);
    const piece = pieces[0];
    if (piece === undefined) {
      throw new Error("expected one clipped piece");
    }
    expect(isClosedPath(piece)).toBe(false);
    expect(pathLength(piece)).toBeCloseTo(100, 3);
    // The piece spans the square from its left edge to its right edge.
    expect(nearestAnchor(piece, 0)).toBeCloseTo(0, 3);
    expect(pathBoundsMaxX(piece)).toBeCloseTo(100, 3);
  });

  it("returns the whole stroke when it lies inside", () => {
    const stroke = strokePath({ x: 10, y: 20 }, { x: 40, y: 20 });
    const pieces = clipStroke(stroke, leftSquare);
    expect(pieces).toHaveLength(1);
    if (pieces[0] !== undefined) {
      expect(pathLength(pieces[0])).toBeCloseTo(30, 3);
    }
  });

  it("returns no piece for a stroke outside the region", () => {
    const stroke = strokePath({ x: -50, y: -50 }, { x: -10, y: -50 });
    expect(clipStroke(stroke, leftSquare)).toEqual([]);
  });

  it("stops a stroke at a hole inside the region", () => {
    const region = subtractMasks(rectPath(0, 0, 100, 100), [
      circlePath(50, 50, 20, 32),
    ]);
    expect(region).not.toBeNull();
    if (region === null) return;
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    const pieces = clipStroke(stroke, region);
    expect(pieces).toHaveLength(2);
    const totalLength = pieces.reduce(
      (total, piece) => total + pathLength(piece),
      0,
    );
    expect(totalLength).toBeCloseTo(30 + 30, 2);
    if (pieces[0] !== undefined && pieces[1] !== undefined) {
      expect(pathBoundsMaxX(pieces[0])).toBeCloseTo(30, 2);
      expect(nearestAnchor(pieces[1], 0)).toBeCloseTo(70, 2);
    }
  });

  it("keeps every piece of a stroke that enters and leaves twice", () => {
    // An hourglass region: the stroke crosses two bars of it.
    const region = unitePaths([rectPath(0, 0, 100, 20), rectPath(0, 40, 100, 20)]);
    expect(region).not.toBeNull();
    if (region === null) return;
    const stroke = strokePath({ x: 50, y: -20 }, { x: 50, y: 80 });
    const pieces = clipStroke(stroke, region);
    expect(pieces).toHaveLength(2);
  });

  it("clips a diagonal stroke that enters the region partway", () => {
    const stroke = strokePath({ x: 0, y: 0 }, { x: 140, y: 140 });
    const pieces = clipStroke(stroke, rightSquare);
    expect(pieces).toHaveLength(1);
    if (pieces[0] !== undefined) {
      // The piece runs from the entry at (50, 50) to the end at
      // (140, 140).
      expect(pathLength(pieces[0])).toBeCloseTo(Math.hypot(90, 90), 3);
    }
  });

  it("gives identical output for identical input", () => {
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    const first = clipStroke(stroke, leftSquare);
    const second = clipStroke(stroke, leftSquare);
    expect(second.map(roundedPath)).toEqual(first.map(roundedPath));
  });

  it("rejects a closed stroke", () => {
    expect(() => clipStroke(leftSquare, leftSquare)).toThrow(/open stroke/);
  });

  it("rejects a compound stroke", () => {
    const compound: Path = {
      commands: [
        ...strokePath({ x: 0, y: 0 }, { x: 10, y: 0 }).commands,
        ...strokePath({ x: 0, y: 5 }, { x: 10, y: 5 }).commands,
      ],
    };
    expect(() => clipStroke(compound, leftSquare)).toThrow(/one contour/);
  });
});

describe("carveStroke against masks", () => {
  it("returns a stroke that crosses no mask as one unchanged piece", () => {
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    expect(carveStroke(stroke, [rectPath(200, 200, 40, 40)])).toEqual([
      stroke,
    ]);
  });

  it("returns the stroke unchanged for an empty mask list", () => {
    const stroke = strokePath({ x: 0, y: 0 }, { x: 50, y: 50 });
    expect(carveStroke(stroke, [])).toEqual([stroke]);
  });

  it("cuts a crossing stroke into the pieces outside the mask", () => {
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    const pieces = carveStroke(stroke, [leftSquare]);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => !isClosedPath(piece))).toBe(true);
    // The visible ink is the 20 units before the mask and the 20 after it.
    const totalLength = pieces.reduce(
      (total, piece) => total + pathLength(piece),
      0,
    );
    expect(totalLength).toBeCloseTo(40, 2);
    if (pieces[0] !== undefined && pieces[1] !== undefined) {
      expect(pathBoundsMaxX(pieces[0])).toBeCloseTo(0, 2);
      expect(nearestAnchor(pieces[1], 0)).toBeCloseTo(100, 2);
    }
  });

  it("returns nothing for a stroke the mask covers", () => {
    const stroke = strokePath({ x: 10, y: 50 }, { x: 90, y: 50 });
    expect(carveStroke(stroke, [leftSquare])).toEqual([]);
  });

  it("carves several masks at once", () => {
    const stroke = strokePath({ x: -20, y: 55 }, { x: 220, y: 55 });
    const pieces = carveStroke(stroke, [
      rectPath(0, 50, 30, 10),
      rectPath(70, 50, 30, 10),
    ]);
    // The stroke enters and leaves both masks, so the lead, the span
    // between the masks, and the tail survive.
    expect(pieces).toHaveLength(3);
    expect(nearestAnchor(pieces[0]!, 0)).toBeCloseTo(-20, 2);
    expect(pathBoundsMaxX(pieces[0]!)).toBeCloseTo(0, 2);
    expect(nearestAnchor(pieces[1]!, 0)).toBeCloseTo(30, 2);
    expect(pathBoundsMaxX(pieces[1]!)).toBeCloseTo(70, 2);
    expect(nearestAnchor(pieces[2]!, 0)).toBeCloseTo(100, 2);
    expect(pathBoundsMaxX(pieces[2]!)).toBeCloseTo(220, 2);
  });

  it("keeps the pieces around a mask a stroke dips into", () => {
    const mask = rectPath(0, 20, 100, 20);
    const stroke = strokePath({ x: 50, y: -20 }, { x: 50, y: 120 });
    const pieces = carveStroke(stroke, [mask]);
    expect(pieces).toHaveLength(2);
    const totalLength = pieces.reduce(
      (total, piece) => total + pathLength(piece),
      0,
    );
    // The stroke spans 140 units and the mask hides 20 of them.
    expect(totalLength).toBeCloseTo(120, 2);
  });

  it("opens a closed contour that crosses a mask", () => {
    const mask = rectPath(0, 45, 200, 20);
    const pieces = carveStroke(rectPath(25, 25, 50, 50), [mask]);
    // The mask swallows one span of each side edge of the ring, so the two
    // remaining arcs survive as open pieces: the bottom arc and the top
    // arc that closes over it.
    expect(pieces).toHaveLength(2);
    const totalLength = pieces.reduce(
      (total, piece) => total + pathLength(piece),
      0,
    );
    expect(totalLength).toBeCloseTo(4 * 50 - 2 * 20, 1);
    for (const piece of pieces) {
      expect(isClosedPath(piece)).toBe(false);
    }
    // Every arc endpoint sits on the mask boundary, and both arcs reach
    // the ring's corners the mask never touches.
    const anchors = pieces.flatMap((piece) =>
      piece.commands
        .filter((command) => command.command !== "close")
        .map((command) => command.to.y),
    );
    expect(Math.min(...anchors)).toBeCloseTo(25, 1);
    expect(Math.max(...anchors)).toBeCloseTo(75, 1);
  });

  it("drops a closed contour the mask covers completely", () => {
    expect(carveStroke(rectPath(30, 30, 20, 20), [leftSquare])).toEqual([]);
  });

  it("carves every contour of a compound stroke on its own", () => {
    const compound: Path = {
      commands: [
        ...strokePath({ x: -20, y: 50 }, { x: 120, y: 50 }).commands,
        ...strokePath({ x: 200, y: 50 }, { x: 300, y: 50 }).commands,
      ],
    };
    const pieces = carveStroke(compound, [leftSquare]);
    // The first contour splits around the mask, the second never touches
    // it and returns whole.
    expect(pieces).toHaveLength(3);
    expect(pathLength(pieces[2]!)).toBeCloseTo(100, 2);
  });

  it("gives identical output for identical input", () => {
    const stroke = strokePath({ x: -20, y: 50 }, { x: 120, y: 50 });
    const first = carveStroke(stroke, [leftSquare]);
    const second = carveStroke(stroke, [leftSquare]);
    expect(second.map(roundedPath)).toEqual(first.map(roundedPath));
  });
});

/** The smallest anchor coordinate of a path. */
function nearestAnchor(path: Path, axis: 0 | 1): number {
  const anchors = path.commands
    .filter((command) => command.command !== "close")
    .map((command) => (axis === 0 ? command.to.x : command.to.y));
  return Math.min(...anchors);
}

/** The largest x anchor of a path. */
function pathBoundsMaxX(path: Path): number {
  const anchors = path.commands
    .filter((command) => command.command !== "close")
    .map((command) => command.to.x);
  return Math.max(...anchors);
}
