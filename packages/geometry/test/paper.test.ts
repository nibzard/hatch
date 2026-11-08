/**
 * Tests for the Paper.js bridge: conversions, subpaths, and shape flags.
 */

import { describe, expect, it } from "vitest";

import type { Path } from "@hatch/core";

import {
  fromPaperPath,
  isClosedPath,
  pathPoints,
  splineThroughPoints,
  subpathsOf,
  toPaperPath,
} from "../src/index.js";

import { circlePath, circlePoints, nearestDistance, rectPath, strokePath } from "./fixtures.js";

describe("path model conversion", () => {
  it("round-trips a polygon through Paper.js without change", () => {
    const rect = rectPath(0, 0, 100, 100);
    const roundTrip = fromPaperPath(toPaperPath(rect));
    expect(roundTrip).not.toBeNull();
    if (roundTrip !== null) {
      expect(roundTrip.commands).toEqual(rect.commands);
    }
  });

  it("round-trips absolute bezier control points", () => {
    const curved: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        {
          command: "curve",
          to: { x: 100, y: 0 },
          control1: { x: 25, y: 40 },
          control2: { x: 75, y: 40 },
        },
      ],
    };
    const roundTrip = fromPaperPath(toPaperPath(curved));
    expect(roundTrip).not.toBeNull();
    if (roundTrip !== null) {
      expect(roundTrip.commands).toEqual(curved.commands);
    }
  });

  it("round-trips a closed spline with its close command", () => {
    const anchors = circlePoints(50, 50, 40, 8);
    const spline = splineThroughPoints(anchors, { closed: true });
    const roundTrip = fromPaperPath(toPaperPath(spline));
    expect(roundTrip).not.toBeNull();
    if (roundTrip !== null) {
      expect(roundTrip.commands[0]?.command).toBe("move");
      expect(roundTrip.commands[1]?.command).toBe("curve");
      expect(roundTrip.commands[roundTrip.commands.length - 1]?.command).toBe(
        "close",
      );
      // The spline passes through every anchor, so the round-tripped
      // path must sit on every anchor as well.
      for (const anchor of anchors) {
        expect(nearestDistance(roundTrip, anchor)).toBeLessThan(1e-6);
      }
    }
  });

  it("keeps every contour of a compound path in order", () => {
    const compound: Path = {
      commands: [
        ...rectPath(0, 0, 10, 10).commands,
        ...rectPath(20, 0, 10, 10).commands,
      ],
    };
    const roundTrip = fromPaperPath(toPaperPath(compound));
    expect(roundTrip).not.toBeNull();
    if (roundTrip !== null) {
      expect(roundTrip.commands).toEqual(compound.commands);
      expect(subpathsOf(roundTrip)).toHaveLength(2);
    }
  });

  it("rejects a close command that is followed by more drawing", () => {
    const malformed: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 10, y: 0 } },
        { command: "close" },
        { command: "line", to: { x: 20, y: 0 } },
      ],
    };
    expect(() => toPaperPath(malformed)).toThrow(/must follow a move command/);
  });
});

describe("subpathsOf", () => {
  it("returns one path per move group, each with its own close", () => {
    const compound: Path = {
      commands: [
        ...rectPath(0, 0, 10, 10).commands,
        ...circlePath(30, 5, 4, 6).commands,
      ],
    };
    const parts = subpathsOf(compound);
    expect(parts).toHaveLength(2);
    expect(isClosedPath(parts[0] as Path)).toBe(true);
    expect(isClosedPath(parts[1] as Path)).toBe(true);
    expect(isClosedPath(strokePath({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(
      false,
    );
  });

  it("marks a path with one open group as open", () => {
    expect(isClosedPath(rectPath(0, 0, 5, 5))).toBe(true);
    expect(isClosedPath(strokePath({ x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(
      false,
    );
  });
});

describe("pathPoints", () => {
  it("lists every anchor in command order", () => {
    const points = pathPoints(rectPath(1, 2, 10, 20));
    expect(points).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 2 },
      { x: 11, y: 22 },
      { x: 1, y: 22 },
    ]);
  });
});
