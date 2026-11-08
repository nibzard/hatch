/**
 * Shared fixtures for the @hatch/hatching tests.
 *
 * The tests assert geometry, not implementation details: every containment
 * check samples the emitted strokes and tests the samples against the
 * region, through the same Paper.js bridge the engine clips with.
 */

import type {
  CrossHatchFillStyle,
  FillStyle,
  HatchFillStyle,
  Path,
  Point,
  Region,
  StyleSpec,
  Texture,
} from "@hatch/core";
import { createRng } from "@hatch/core";
import type { SeededRng } from "@hatch/core";
import {
  offsetPath,
  pathBounds,
  pointInPath,
  samplePathPoints,
  subpathsOf,
} from "@hatch/geometry";

import type { HatchStroke } from "../src/index.js";
import { extentLength, lineFrame } from "../src/index.js";

/**
 * Tolerance for containment checks, in user units. Clipped stroke ends sit
 * on the region contour, so a strict inside test would race floating point
 * rounding. One thousandth of a unit is far below any visible gap.
 */
export const CONTAINMENT_TOLERANCE = 1e-3;

/** One hatch fill style, with every field overridable. */
export function hatchFill(
  overrides: Partial<HatchFillStyle> = {},
): HatchFillStyle {
  return {
    type: "hatch",
    angle: 0,
    spacing: 8,
    stroke: "#3a342e",
    weight: 0.5,
    jitter: 0,
    ...overrides,
  };
}

/** One crosshatch fill style, with every field overridable. */
export function crossHatchFill(
  overrides: Partial<CrossHatchFillStyle> = {},
): CrossHatchFillStyle {
  return {
    type: "crosshatch",
    angleA: 45,
    angleB: 135,
    spacingA: 8,
    spacingB: 10,
    stroke: "#3a342e",
    weight: 0.5,
    jitter: 0,
    ...overrides,
  };
}

/** One axis-aligned closed rectangle. */
export function rectPath(x: number, y: number, w: number, h: number): Path {
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

/** One closed polygon around a circle. */
export function circlePath(
  cx: number,
  cy: number,
  radius: number,
  count = 48,
): Path {
  const commands: Path["commands"] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const point = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
    commands.push(
      index === 0
        ? { command: "move" as const, to: point }
        : { command: "line" as const, to: point },
    );
  }
  commands.push({ command: "close" });
  return { commands };
}

/** One rectangular region. */
export function rectRegion(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fillStyle: FillStyle,
  extra: Partial<Pick<Region, "clip" | "zIndex" | "role">> = {},
): Region {
  return {
    id,
    path: rectPath(x, y, w, h),
    fillStyle,
    zIndex: 0,
    ...extra,
  };
}

/** One circular region. */
export function circleRegion(
  id: string,
  cx: number,
  cy: number,
  radius: number,
  fillStyle: FillStyle,
  extra: Partial<Pick<Region, "clip" | "zIndex" | "role">> = {},
): Region {
  return {
    id,
    path: circlePath(cx, cy, radius),
    fillStyle,
    zIndex: 0,
    ...extra,
  };
}

/** A quiet texture: no jitter, no dropout, no pressure spread, no grain. */
export const stillTexture: Texture = {
  lineJitter: 0,
  dropout: 0,
  pressureVariance: 0,
  paperNoise: 0,
};

/** A busy texture, so every humanization effect switches on. */
export const livelyTexture: Texture = {
  lineJitter: 1.2,
  dropout: 0.08,
  pressureVariance: 0.25,
  paperNoise: 0.1,
};

/**
 * One complete style, built around the given texture. Only the texture
 * drives the hatching engine, so the remaining sections hold plain values
 * that satisfy the StyleSpec schema.
 */
export function hatchStyle(texture: Texture = stillTexture): StyleSpec {
  const hatch = hatchFill();
  const cross = crossHatchFill();
  return {
    palette: {
      paper: "#f6f1e7",
      sky: "#a3c6d9",
      grass: "#7fa361",
      architecture: "#e2d8c8",
      water: "#a6c0d2",
      accent: "#b0452e",
      mountain: "#8b93a4",
      trunk: "#6d4c38",
    },
    hatchFamilies: {
      sky: hatch,
      field: hatch,
      foliage: cross,
      mountain: hatch,
      water: cross,
      cliff: hatch,
    },
    contours: {
      weight: 1.1,
      color: "#26221e",
      wobble: 0.35,
      simplifyTolerance: 0.6,
    },
    objectGrammar: {
      abstractionLevel: 0.6,
      maxDetailPerObject: 10,
      edgeRoundnessBias: 0.55,
      keepNegativeSpace: true,
    },
    compositionGrammar: {
      minEmptyAreaRatio: 0.35,
      preferredHorizonBand: [0.62, 0.72],
      focalObjectCount: 1,
    },
    texture,
  };
}

/** One seeded stream for a test label. Two calls with one label match. */
export function testRng(label: string): SeededRng {
  return createRng(`hatching-test:${label}`);
}

/** The region grown by the containment tolerance, holes included. */
export function toleranceRegion(region: Path): Path {
  const grown = offsetPath(region, CONTAINMENT_TOLERANCE);
  if (grown === null) {
    throw new Error("the test region vanished under its tolerance offset");
  }
  return grown;
}

/** Every point of one stroke, sampled at an even spacing, piece by piece. */
export function strokePoints(stroke: HatchStroke, spacing = 2): Point[] {
  return subpathsOf(stroke.path).flatMap((piece) =>
    samplePathPoints(piece, spacing),
  );
}

/** The y of the first point of a stroke, or NaN when it holds no point. */
export function startY(stroke: HatchStroke): number {
  const first = stroke.path.commands[0];
  return first !== undefined && first.command !== "close"
    ? first.to.y
    : Number.NaN;
}

/** Every point of every stroke of a set. */
export function setPoints(strokes: readonly HatchStroke[], spacing = 2): Point[] {
  return strokes.flatMap((stroke) => strokePoints(stroke, spacing));
}

/**
 * True when every sampled stroke point lies inside the region, or on its
 * contour within the containment tolerance.
 */
export function pointsStayInside(
  points: readonly Point[],
  region: Path,
): boolean {
  const grown = toleranceRegion(region);
  return points.every((point) => pointInPath(grown, point));
}

/** The largest drift one line may carry, in degrees, for one family angle. */
export function maxDriftDegrees(
  region: Path,
  angle: number,
  amplitude: number,
  margin: number,
): number {
  const frame = lineFrame(pathBounds(region), angle);
  const radians = Math.atan(
    (2 * 0.4 * amplitude) / Math.max(extentLength(frame, margin), 1),
  );
  return (radians * 180) / Math.PI;
}

/**
 * The largest distance from a horizontal line through the mean y of the
 * points. For a hatch family at angle 0 this measures how far a stroke
 * departs from its ideal line.
 */
export function maxHorizontalDeparture(points: readonly Point[]): number {
  if (points.length === 0) {
    return 0;
  }
  const meanY =
    points.reduce((total, point) => total + point.y, 0) / points.length;
  return points.reduce(
    (largest, point) => Math.max(largest, Math.abs(point.y - meanY)),
    0,
  );
}
