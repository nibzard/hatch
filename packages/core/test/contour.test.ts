/**
 * Tests for contour humanization (task T017).
 *
 * Every promise of {@link wobbleContour} is checked: a zero amplitude
 * changes nothing and draws nothing, a wobbled contour stays inside its
 * budget, a closed contour closes, and the same stream wobbles the same
 * contour.
 */

import { describe, expect, it } from "vitest";

import {
  CURVE_SUBSAMPLES,
  resampleContour,
  sampleContour,
  wobbleContour,
} from "../src/index.js";
import type { Path, Point, Texture } from "../src/index.js";
import { createRng, type SeededRng } from "../src/rng.js";

/** The texture of the tests: a light grain share, like pastoral-v1. */
const texture: Texture = {
  lineJitter: 0.4,
  dropout: 0.04,
  pressureVariance: 0.18,
  paperNoise: 0.03,
};

/** One open polyline through the given points. */
function linePath(points: Point[]): Path {
  const [first, ...rest] = points;
  if (first === undefined) {
    throw new Error("linePath needs at least one point");
  }
  return {
    commands: [
      { command: "move", to: first },
      ...rest.map((to) => ({ command: "line" as const, to })),
    ],
  };
}

/** One closed rectangle path. */
function rectPath(x: number, y: number, w: number, h: number): Path {
  return {
    commands: [
      { command: "move", to: { x, y } },
      { command: "line", to: { x: x + w, y } },
      { command: "line", to: { x: x + w, y: y + h } },
      { command: "line", to: { x, y: y + h } },
      { command: "close" },
    ],
  };
}

/** One stream for a test, reproducible by label. */
function wobbleRng(label: string): SeededRng {
  return createRng(`hatch-contour-test:${label}`);
}

/** Every point one path moves through, close commands excepted. */
function pointsOf(path: Path): Point[] {
  return path.commands.flatMap((command) =>
    command.command === "close" ? [] : [command.to],
  );
}

/** The largest distance of any wobbled point from the straight ideal. */
function maxDistanceFrom(path: Path, ideal: Point[]): number {
  return Math.max(
    ...pointsOf(path).map((point) => {
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index + 1 < ideal.length; index += 1) {
        const a = ideal[index]!;
        const b = ideal[index + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : Math.min(
                1,
                Math.max(
                  0,
                  ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
                ),
              );
        best = Math.min(
          best,
          Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)),
        );
      }
      return best;
    }),
  );
}

describe("sampleContour", () => {
  it("walks a polyline point by point with its arc lengths", () => {
    const path = linePath([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ]);
    const { samples, closed } = sampleContour(path);
    expect(closed).toBe(false);
    expect(samples.map((sample) => sample.distance)).toEqual([0, 30, 70]);
  });

  it("subdivides each curve command into straight runs", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        {
          command: "curve",
          to: { x: 100, y: 0 },
          control1: { x: 30, y: -40 },
          control2: { x: 70, y: -40 },
        },
      ],
    };
    expect(sampleContour(path).samples).toHaveLength(1 + CURVE_SUBSAMPLES);
  });

  it("repeats the first point at the end of a closed path", () => {
    const { samples, closed } = sampleContour(rectPath(0, 0, 30, 20));
    expect(closed).toBe(true);
    expect(samples[samples.length - 1]!.point).toEqual(samples[0]!.point);
    expect(samples[samples.length - 1]!.distance).toBe(100);
  });
});

describe("resampleContour", () => {
  it("spreads samples at even distances from start to end", () => {
    // The walk measures 10 + 1 + 90 = 101 user units of arc length.
    const { samples } = sampleContour(
      linePath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 1 },
        { x: 100, y: 1 },
      ]),
    );
    const grid = resampleContour(samples, 10);
    const distances = grid.map((sample) => sample.distance);
    expect(distances[0]).toBe(0);
    expect(distances[distances.length - 1]).toBe(101);
    for (let index = 1; index < distances.length - 1; index += 1) {
      expect(distances[index]! - distances[index - 1]!).toBeCloseTo(10, 6);
    }
  });
});

describe("wobbleContour", () => {
  it("returns a straight contour unchanged and draws nothing", () => {
    const path = linePath([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 120, y: 0 },
      { x: 180, y: 0 },
    ]);
    const before = wobbleRng("amplitude-zero").next();
    const stream = wobbleRng("amplitude-zero");
    const wobbled = wobbleContour(path, 0, texture, stream);
    expect(wobbled).toBe(path);
    // The stage stream stays untouched, so a style without wobble keeps
    // the stream layout of every later draw.
    expect(stream.next()).toBe(before);
  });

  it("keeps every point inside the wobble budget", () => {
    const ideal = [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 300, y: 0 },
    ];
    const wobbled = wobbleContour(
      linePath(ideal),
      0.35,
      texture,
      wobbleRng("budget"),
    );
    expect(maxDistanceFrom(wobbled, ideal)).toBeLessThanOrEqual(0.35 + 1e-9);
    // The contour really wobbled, or the budget proves nothing.
    expect(maxDistanceFrom(wobbled, ideal)).toBeGreaterThan(0);
  });

  it("stays open for an open contour and closed for a closed one", () => {
    const open = wobbleContour(
      linePath([
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ]),
      0.35,
      texture,
      wobbleRng("open"),
    );
    expect(open.commands[open.commands.length - 1]?.command).toBe("line");

    const closed = wobbleContour(rectPath(10, 10, 120, 60), 0.35, texture, wobbleRng("closed"));
    expect(closed.commands[closed.commands.length - 1]?.command).toBe("close");
    const points = pointsOf(closed);
    expect(points[points.length - 1]).toEqual(points[0]);
  });

  it("wobbles the identical contour for the identical stream", () => {
    const path = rectPath(10, 10, 120, 60);
    expect(wobbleContour(path, 0.35, texture, wobbleRng("same"))).toEqual(
      wobbleContour(path, 0.35, texture, wobbleRng("same")),
    );
    expect(wobbleContour(path, 0.35, texture, wobbleRng("other"))).not.toEqual(
      wobbleContour(path, 0.35, texture, wobbleRng("same")),
    );
  });

  it("carries the wobble of a curved contour too", () => {
    const path: Path = {
      commands: [
        { command: "move", to: { x: 0, y: 0 } },
        {
          command: "curve",
          to: { x: 200, y: 0 },
          control1: { x: 60, y: -90 },
          control2: { x: 140, y: -90 },
        },
        { command: "line", to: { x: 260, y: 10 } },
      ],
    };
    const wobbled = wobbleContour(path, 0.5, texture, wobbleRng("curve"));
    expect(pointsOf(wobbled).length).toBeGreaterThan(CURVE_SUBSAMPLES);
    expect(wobbled.commands.every((command) => command.command !== "close")).toBe(
      true,
    );
  });
});
