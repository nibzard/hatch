/**
 * Tests for corner rounding (task T043).
 *
 * `roundPathCorners` is the path operation behind the
 * `objectGrammar.edgeRoundnessBias` field of a style preset, so its
 * contract is the one the object grammar pass relies on: a share of 0 is
 * the identity, every cut stays inside the corner it rounds, endpoints
 * and curve commands survive exactly, and no cut passes the midpoint of
 * the shorter segment it cuts into.
 */

import { describe, expect, it } from "vitest";

import type { Path, Point } from "@hatch/core";

import {
  MAX_CORNER_SHARE,
  roundPathCorners,
} from "../src/round.js";
import { pointInPath, samplePathPoints } from "../src/measure.js";

/** One closed square of side 40. */
function square(): Path {
  return {
    commands: [
      { command: "move", to: { x: 0, y: 0 } },
      { command: "line", to: { x: 40, y: 0 } },
      { command: "line", to: { x: 40, y: 40 } },
      { command: "line", to: { x: 0, y: 40 } },
      { command: "close" },
    ],
  };
}

/** One open polyline with one corner in the middle. */
function bentLine(): Path {
  return {
    commands: [
      { command: "move", to: { x: 0, y: 0 } },
      { command: "line", to: { x: 30, y: 0 } },
      { command: "line", to: { x: 30, y: 20 } },
    ],
  };
}

/** Every command target of a path, ignoring close commands. */
function targets(path: Path): Point[] {
  return path.commands.flatMap((command) =>
    command.command === "close" ? [] : [command.to],
  );
}

describe("roundPathCorners", () => {
  it("returns the input unchanged at share 0", () => {
    const path = square();
    expect(roundPathCorners(path, 0)).toBe(path);
  });

  it("rejects a share outside 0 to the half of a segment", () => {
    expect(() => roundPathCorners(square(), -0.1)).toThrow();
    expect(() => roundPathCorners(square(), MAX_CORNER_SHARE + 1e-9)).toThrow();
    expect(() => roundPathCorners(square(), Number.NaN)).toThrow();
  });

  it("cuts every corner of a closed polygon into one curve", () => {
    const rounded = roundPathCorners(square(), 0.25);
    const curves = rounded.commands.filter(
      (command) => command.command === "curve",
    );
    expect(curves).toHaveLength(4);
    // The corner vertices themselves are gone: the pen never reaches them.
    for (const corner of [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]) {
      expect(targets(rounded)).not.toContainEqual(corner);
    }
  });

  it("stays inside the polygon it rounds", () => {
    const rounded = roundPathCorners(square(), MAX_CORNER_SHARE);
    for (const point of samplePathPoints(rounded, 1)) {
      expect(pointInPath(square(), point)).toBe(true);
    }
  });

  it("never cuts past the midpoint of the shorter segment", () => {
    // A rectangle with one short side: the cut at every corner of the long
    // sides is bound by the short one.
    const rectangle: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 100, y: 0 } },
        { command: "line", to: { x: 100, y: 10 } },
        { command: "line", to: { x: 0, y: 10 } },
        { command: "close" },
      ],
    };
    const rounded = roundPathCorners(rectangle, MAX_CORNER_SHARE);
    for (const point of samplePathPoints(rounded, 0.5)) {
      expect(pointInPath(rectangle, point)).toBe(true);
    }
    // On the long edges the pen reaches exactly the midpoint of the short
    // side, five units from each corner, and never beyond it.
    const bottom = targets(rounded).filter((point) => point.y === 0);
    for (const point of bottom) {
      expect(point.x).toBeGreaterThanOrEqual(5);
      expect(point.x).toBeLessThanOrEqual(95);
    }
  });

  it("keeps the endpoints of an open polyline exactly", () => {
    const rounded = roundPathCorners(bentLine(), 0.3);
    const points = targets(rounded);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 30, y: 20 });
    // The corner at (30, 0) cuts six units into both segments: a share of
    // 0.3 of the shorter one, 20 units long.
    expect(rounded.commands).toContainEqual({
      command: "curve",
      to: { x: 30, y: 6 },
      control1: { x: 27.314, y: 0 },
      control2: { x: 30, y: 2.686 },
    });
  });

  it("leaves a straight continuation sharp", () => {
    const straight: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 10, y: 0 } },
        { command: "line", to: { x: 20, y: 0 } },
      ],
    };
    expect(roundPathCorners(straight, 0.4)).toBe(straight);
  });

  it("leaves a subpath that carries a curve exactly as it is", () => {
    const withCurve: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        {
          command: "curve",
          to: { x: 10, y: 10 },
          control1: { x: 0, y: 5 },
          control2: { x: 5, y: 10 },
        },
        { command: "line", to: { x: 20, y: 10 } },
      ],
    };
    expect(roundPathCorners(withCurve, 0.4)).toBe(withCurve);
  });

  it("rounds every subpath of a compound path", () => {
    const compound: Path = {
      commands: [
        ...square().commands,
        { command: "move", to: { x: 100, y: 0 } },
        { command: "line", to: { x: 140, y: 0 } },
        { command: "line", to: { x: 140, y: 40 } },
        { command: "line", to: { x: 100, y: 40 } },
        { command: "close" },
      ],
    };
    const rounded = roundPathCorners(compound, 0.25);
    const moves = rounded.commands.filter(
      (command) => command.command === "move",
    );
    const curves = rounded.commands.filter(
      (command) => command.command === "curve",
    );
    expect(moves).toHaveLength(2);
    expect(curves).toHaveLength(8);
  });

  it("is deterministic", () => {
    expect(roundPathCorners(square(), 0.275)).toEqual(
      roundPathCorners(square(), 0.275),
    );
  });
});
