/**
 * Shared fixtures for the @hatch/renderer-svg tests.
 *
 * Every fixture is a complete, valid RenderIR or one of its parts. The
 * sky-and-field scene carries every feature of task T014 at once: a paper
 * background, a stacked region order that arrives shuffled, a region clip
 * extent, a cloud cutout mask, a contour stroke, and a symbol placement that
 * resolves to the bird definition of the symbol library.
 */

import type {
  Mask,
  ObjectAnchor,
  Path,
  Region,
  RenderIR,
  RenderTrace,
  ResolvedStyleSpec,
  SymbolDefinition,
  Texture,
} from "@hatch/core";

/** Hatch ink of the fixtures. */
export const INK = "#3a342e";

/** Contour ink of the fixtures. */
export const CONTOUR_INK = "#26221e";

/** Paper color of the fixtures. */
export const PAPER = "#f6f1e7";

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
  count = 40,
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

/** One open polyline through the given points. */
export function linePath(points: { x: number; y: number }[]): Path {
  if (points.length === 0) {
    throw new Error("linePath needs at least one point");
  }
  const [first, ...rest] = points;
  return {
    commands: [
      { command: "move", to: first! },
      ...rest.map((point) => ({ command: "line" as const, to: point })),
    ],
  };
}

/** A texture with live jitter, so hatch strokes vary visibly. */
export const livelyTexture: Texture = {
  lineJitter: 0.8,
  dropout: 0.03,
  pressureVariance: 0.2,
  paperNoise: 0.05,
};

/**
 * One complete resolved style. The values mirror pastoral-v1 in shape; the
 * renderer reads only the palette and the hatch families of the regions,
 * which the region fixtures carry directly.
 */
export function resolvedStyle(
  preset = "pastoral-v1",
  texture: Texture = livelyTexture,
): ResolvedStyleSpec {
  return {
    palette: {
      paper: PAPER,
      sky: "#a3c6d9",
      grass: "#7fa361",
      architecture: "#e2d8c8",
      water: "#a6c0d2",
      accent: "#b0452e",
      mountain: "#8b93a4",
      trunk: "#6d4c38",
    },
    hatchFamilies: {
      sky: { angle: 15, spacing: 8, stroke: INK, weight: 0.55, jitter: 0.3 },
      field: { angle: 0, spacing: 7, stroke: INK, weight: 0.5, jitter: 0.55 },
      foliage: {
        angleA: 45,
        angleB: 135,
        spacingA: 8,
        spacingB: 10,
        stroke: INK,
        weight: 0.5,
        jitter: 1.4,
      },
      mountain: { angle: 60, spacing: 8, stroke: INK, weight: 0.6, jitter: 0.45 },
      water: {
        angleA: 10,
        angleB: 100,
        spacingA: 8,
        spacingB: 10,
        stroke: INK,
        weight: 0.5,
        jitter: 0.3,
      },
      cliff: { angle: 80, spacing: 8, stroke: INK, weight: 0.65, jitter: 0.5 },
    },
    contours: { weight: 1.1, color: CONTOUR_INK, wobble: 0.35, simplifyTolerance: 0.6 },
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
    preset,
  };
}

/** One valid trace identity, with every field overridable. */
export function traceOf(overrides: Partial<RenderTrace> = {}): RenderTrace {
  return {
    specHash: "sha256:9f2c",
    preset: "pastoral-v1",
    seed: 42,
    compilerVersion: "0.1.0",
    events: [],
    ...overrides,
  };
}

/** The cloud cutout of the scene, parked inside the sky region. */
export function cloudMask(): Mask {
  return { id: "cloud-1", path: circlePath(120, 70, 38), invert: true };
}

/**
 * The same cloud cutout as unvalidated input: no `invert` field.
 *
 * MaskSchema fills the absent field with its default `true`, which is what
 * a JSON scene spec produces when it stays silent about the mask sense. The
 * `Mask` type is the parse *output*, where `invert` is always present, so
 * the cast records that this fixture deliberately sits on the input side of
 * that line.
 */
export function cloudMaskInput(): Mask {
  return { id: "cloud-1", path: circlePath(120, 70, 38) } as Mask;
}

/**
 * The bird mark the scene places: two pen strokes in local units around the
 * origin, about 12 units wide. A placement's transform decides where and how
 * large it draws.
 */
export function birdSymbol(id = "bird-v1"): SymbolDefinition {
  return {
    id,
    strokes: [
      {
        path: linePath([
          { x: -6, y: 0 },
          { x: 0, y: -2.5 },
        ]),
        weight: 0.9,
        color: INK,
      },
      {
        path: linePath([
          { x: 0, y: -2.5 },
          { x: 6, y: 0 },
        ]),
        weight: 0.9,
        color: INK,
      },
    ],
  };
}

/** The region stack of the scene, in shuffled input order. */
export function sceneRegions(): Region[] {
  return [
    {
      id: "field",
      role: "field",
      path: rectPath(0, 140, 320, 100),
      fillStyle: {
        type: "hatch",
        angle: 0,
        spacing: 7,
        stroke: INK,
        weight: 0.5,
        jitter: 0.55,
      },
      zIndex: 20,
    },
    {
      id: "sky",
      role: "sky",
      path: rectPath(0, 0, 320, 140),
      fillStyle: {
        type: "hatch",
        angle: 15,
        spacing: 8,
        stroke: INK,
        weight: 0.55,
        jitter: 0.3,
      },
      // The sky stops at the hill crest, not at the canvas edge, so the
      // region clip extent has a visible job.
      clip: rectPath(0, 0, 320, 130),
      zIndex: 0,
    },
    {
      id: "hill",
      role: "mountain",
      path: circlePath(160, 140, 90),
      fillStyle: { type: "none" },
      zIndex: 10,
    },
  ];
}

/**
 * The complete sky-and-field scene: every T014 feature in one render, plus
 * the symbol library that resolves its placement (task T034).
 */
export function sceneIR(overrides: Partial<RenderIR> = {}): RenderIR {
  return {
    canvas: { width: 320, height: 240 },
    regions: sceneRegions(),
    contours: [
      {
        path: linePath([
          { x: 0, y: 140 },
          { x: 320, y: 140 },
        ]),
        weight: 1.1,
        color: CONTOUR_INK,
        role: "contour",
      },
    ],
    symbols: [{ symbolId: "bird-v1", position: { x: 60, y: 40 }, scale: 1, rotation: 12 }],
    symbolLibrary: [birdSymbol()],
    masks: [cloudMask()],
    anchors: sceneAnchors(),
    style: resolvedStyle(),
    trace: traceOf(),
    ...overrides,
  };
}

/**
 * The object anchors of the scene: one midground tree, centered, plus one
 * focal cottage the planner had to move back onto the canvas.
 */
export function sceneAnchors(): ObjectAnchor[] {
  return [
    {
      objectId: "tree-1",
      kind: "tree",
      role: "midground",
      position: { x: 96, y: 168 },
      scale: 1,
      depth: 1,
      depthIndex: 0,
      positionClamped: false,
    },
    {
      objectId: "cottage-1",
      kind: "house",
      role: "focal",
      position: { x: 224, y: 150 },
      scale: 1.5,
      depth: 3,
      depthIndex: 1,
      positionClamped: true,
    },
  ];
}

/**
 * A minimal region stack for the draw-order test: five regions, shuffled,
 * with one zIndex tie that proves the input order survives the sort.
 */
export function stackedIR(): RenderIR {
  const fill = {
    type: "hatch" as const,
    angle: 0,
    spacing: 20,
    stroke: INK,
    weight: 0.5,
    jitter: 0.2,
  };
  const band = (id: string, y: number, zIndex: number): Region => ({
    id,
    path: rectPath(0, y, 320, 20),
    fillStyle: fill,
    zIndex,
  });
  return sceneIR({
    regions: [
      band("field", 100, 20),
      band("sky", 0, 0),
      band("tree-b", 60, 11),
      band("hill", 40, 10),
      band("tree-c", 80, 11),
    ],
    masks: [],
    contours: [],
    symbols: [],
  });
}
