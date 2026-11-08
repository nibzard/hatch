/**
 * Unit tests for the humanization math (specification section 17).
 *
 * Every knob of the style texture maps to one bounded effect. These tests
 * pin the bounds, so a preset author can predict what a texture value does.
 */

import { describe, expect, it } from "vitest";

import type { Path, Point, Texture } from "@hatch/core";

import {
  DRIFT_SHARE,
  MAX_SPACING_VARIANCE,
  WOBBLE_SHARE,
  driftDegrees,
  endTrim,
  familyAmplitude,
  idealLine,
  lineFrame,
  pressureWeight,
  spacingStep,
  trimPolylineEnds,
  wavyStroke,
} from "../src/index.js";

import { testRng } from "./fixtures.js";

/** A texture with one knob turned to a known value. */
function textureWith(overrides: Partial<Texture>): Texture {
  return {
    lineJitter: 0,
    dropout: 0,
    pressureVariance: 0,
    paperNoise: 0,
    ...overrides,
  };
}

/** Shortest distance from `point` to the line through `a` and `b`. */
function distanceToLine(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const length = Math.hypot(abx, aby);
  if (length < 1e-12) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  return Math.abs(
    (point.x - a.x) * aby - (point.y - a.y) * abx,
  ) / length;
}

/** Every anchor point of a polyline path. */
function pathPoints(path: Path): Point[] {
  return path.commands
    .filter((command) => command.command !== "close")
    .map((command) => command.to);
}

describe("familyAmplitude", () => {
  it("adds the zone jitter and the paper jitter", () => {
    const texture = textureWith({ lineJitter: 0.4 });
    expect(familyAmplitude(0.3, texture)).toBeCloseTo(0.7, 12);
    expect(familyAmplitude(1.4, texture)).toBeCloseTo(1.8, 12);
    expect(familyAmplitude(0, textureWith({}))).toBe(0);
  });
});

describe("driftDegrees", () => {
  it("returns zero for a still line and consumes exactly one draw", () => {
    // A stream that skipped the drift call must line up with a stream that
    // made it, one draw later. That keeps the stream layout stable at every
    // amplitude.
    const reference = testRng("drift-zero");
    reference.next();
    const expected = reference.next();
    const stream = testRng("drift-zero");
    expect(driftDegrees(0, 500, stream)).toBe(0);
    expect(stream.next()).toBe(expected);
  });

  it("stays inside the rise bound of the drift share", () => {
    const amplitude = 2;
    const extent = 400;
    const rng = testRng("drift-bound");
    const bound =
      (Math.atan((2 * DRIFT_SHARE * amplitude) / extent) * 180) / Math.PI;
    for (let index = 0; index < 500; index += 1) {
      const drift = driftDegrees(amplitude, extent, rng);
      expect(Math.abs(drift)).toBeLessThanOrEqual(bound + 1e-12);
    }
    // The bound is small for a long line and larger for a short one, which
    // is what section 17 asks for: sky stays regular, foliage does not.
    expect(bound).toBeLessThan(1);
    const shortBound =
      (Math.atan((2 * DRIFT_SHARE * amplitude) / 40) * 180) / Math.PI;
    expect(shortBound).toBeGreaterThan(bound);
  });
});

describe("spacingStep", () => {
  it("returns the exact spacing when the amplitude is zero", () => {
    expect(spacingStep(7, 0, testRng("spacing-zero"))).toBe(7);
  });

  it("stays inside the spacing variance cap", () => {
    const spacing = 3;
    const rng = testRng("spacing-bound");
    for (let index = 0; index < 500; index += 1) {
      const step = spacingStep(spacing, 100, rng);
      expect(step).toBeGreaterThanOrEqual(spacing * (1 - MAX_SPACING_VARIANCE));
      expect(step).toBeLessThanOrEqual(spacing * (1 + MAX_SPACING_VARIANCE));
    }
  });

  it("varies the step for a jittered family", () => {
    const rng = testRng("spacing-vary");
    const steps = new Set<number>();
    for (let index = 0; index < 50; index += 1) {
      steps.add(spacingStep(5, 1.5, rng));
    }
    expect(steps.size).toBeGreaterThan(10);
  });
});

describe("pressureWeight", () => {
  it("returns the plain weight without pressure variance", () => {
    expect(pressureWeight(0.55, 0, testRng("pressure-zero"))).toBe(0.55);
  });

  it("stays inside the pressure spread", () => {
    const weight = 0.5;
    const rng = testRng("pressure-bound");
    for (let index = 0; index < 500; index += 1) {
      const value = pressureWeight(weight, 0.3, rng);
      expect(value).toBeGreaterThanOrEqual(weight * 0.7 - 1e-12);
      expect(value).toBeLessThanOrEqual(weight * 1.3 + 1e-12);
    }
  });

  it("keeps the weight positive for an extreme variance", () => {
    const rng = testRng("pressure-extreme");
    for (let index = 0; index < 100; index += 1) {
      expect(pressureWeight(0.5, 8, rng)).toBeGreaterThan(0);
    }
  });
});

describe("endTrim and trimPolylineEnds", () => {
  it("trims at most a quarter of the piece", () => {
    const rng = testRng("trim-bound");
    for (let index = 0; index < 200; index += 1) {
      const trim = endTrim(20, 5, rng);
      expect(trim).toBeGreaterThanOrEqual(0);
      expect(trim).toBeLessThanOrEqual(5);
      expect(endTrim(2, 5, rng)).toBeLessThanOrEqual(0.5);
    }
  });

  it("removes length from both ends of a polyline", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 10, y: 0 } },
        { command: "line", to: { x: 20, y: 0 } },
      ],
    };
    const trimmed = trimPolylineEnds(path, 3, 2);
    expect(trimmed).not.toBeNull();
    if (trimmed !== null) {
      expect(pathPoints(trimmed)).toEqual([
        { x: 3, y: 0 },
        { x: 10, y: 0 },
        { x: 18, y: 0 },
      ]);
    }
  });

  it("moves a whole segment when the trim passes an anchor", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 10, y: 0 } },
        { command: "line", to: { x: 30, y: 0 } },
      ],
    };
    const trimmed = trimPolylineEnds(path, 12, 0);
    expect(trimmed).not.toBeNull();
    if (trimmed !== null) {
      expect(pathPoints(trimmed)).toEqual([
        { x: 12, y: 0 },
        { x: 30, y: 0 },
      ]);
    }
  });

  it("returns null when the trims eat the whole piece", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        { command: "line", to: { x: 4, y: 0 } },
      ],
    };
    expect(trimPolylineEnds(path, 3, 3)).toBeNull();
    expect(trimPolylineEnds(path, 4, 4)).toBeNull();
  });

  it("passes a curved path through unchanged", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        {
          command: "curve",
          to: { x: 10, y: 10 },
          control1: { x: 0, y: 5 },
          control2: { x: 10, y: 5 },
        },
      ],
    };
    expect(trimPolylineEnds(path, 1, 1)).toBe(path);
  });
});

describe("wavyStroke", () => {
  /** One long horizontal ideal line over a wide region. */
  function longLine(): ReturnType<typeof idealLine> {
    const frame = lineFrame(
      { minX: 0, minY: 0, maxX: 200, maxY: 100, width: 200, height: 100 },
      0,
    );
    return idealLine(frame, 20, 0, 2);
  }

  it("returns the straight ideal line when the amplitude is zero", () => {
    const line = longLine();
    const stroke = wavyStroke(line, 0, 0, testRng("wavy-zero"));
    expect(stroke.commands).toHaveLength(2);
    expect(pathPoints(stroke)[0]).toEqual(line.from);
    expect(pathPoints(stroke)[1]).toEqual(line.to);
  });

  it("keeps every sample inside the waviness share of the budget", () => {
    const line = longLine();
    const amplitude = 3;
    const stroke = wavyStroke(
      line,
      amplitude,
      0.2,
      testRng("wavy-bound"),
    );
    const points = pathPoints(stroke);
    expect(points.length).toBeGreaterThan(10);
    for (const point of points) {
      const distance = distanceToLine(point, line.from, line.to);
      expect(distance).toBeLessThanOrEqual(WOBBLE_SHARE * amplitude + 1e-9);
    }
  });

  it("moves samples off the ideal line", () => {
    const line = longLine();
    const stroke = wavyStroke(line, 3, 0.1, testRng("wavy-move"));
    const distances = pathPoints(stroke).map((point) =>
      distanceToLine(point, line.from, line.to),
    );
    expect(Math.max(...distances)).toBeGreaterThan(0.1);
  });

  it("samples the grain wave above twice per period", () => {
    // The grain wavelength is the shortest of the three. Sampling it below
    // twice per period would alias it into the longer waves, and the paper
    // grain would never appear as grain.
    const line = longLine();
    const stroke = wavyStroke(line, 3, 1, testRng("wavy-grain"));
    const points = pathPoints(stroke);
    const grainWavelength =
      Math.min(96, Math.max(24, line.length / 4)) / 4.3;
    for (let index = 1; index < points.length; index += 1) {
      const step = Math.hypot(
        points[index]!.x - points[index - 1]!.x,
        points[index]!.y - points[index - 1]!.y,
      );
      expect(step).toBeLessThan(grainWavelength / 2);
    }
  });
});
