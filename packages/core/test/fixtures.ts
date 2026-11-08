/**
 * Valid fixtures shared by the @hatch/core schema tests.
 *
 * Every builder returns a fresh object that satisfies the exported TypeScript
 * type and parses against its schema. Mutate a copy per test case.
 */

import type {
  Path,
  RenderIR,
  RenderTrace,
  SceneSpec,
  StyleSpec,
  SymbolDefinition,
} from "../src/index.js";

/** A closed triangle path. */
export function trianglePath(): Path {
  return {
    commands: [
      { command: "move", to: { x: 0, y: 0 } },
      { command: "line", to: { x: 10, y: 0 } },
      { command: "line", to: { x: 5, y: 8 } },
      { command: "close" },
    ],
  };
}

/** An axis-aligned rectangle path. */
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

/** One valid single-object rural scene. */
export function validSceneSpec(): SceneSpec {
  return {
    meta: {
      id: "scene-0001",
      seed: 42,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: {
      framing: "wide",
      lens: "normal",
      horizonY: 0.68,
    },
    composition: {
      focalPoints: ["tree-1"],
      balance: "asymmetric",
      negativeSpace: 0.35,
      depthLayers: 3,
    },
    environment: {
      type: "rural",
      sky: { cloudCount: 3 },
    },
    objects: [
      {
        id: "tree-1",
        kind: "tree",
        role: "midground",
        position: { x: 0.55, y: 0.6 },
        scale: 1,
        params: { canopySize: 0.8, trunkBend: 0.1 },
        styleRole: "foliage crosshatch",
      },
    ],
  };
}

/** One complete style preset shaped like pastoral-v1 (specification section 8). */
export function validStyleSpec(): StyleSpec {
  const ink = "#2f2a26";
  return {
    palette: {
      paper: "#f7f3e8",
      sky: "#a8c4d4",
      grass: "#7a9b5e",
      architecture: "#d8cfc0",
      water: "#9db8cc",
      accent: ink,
      mountain: "#8a8f98",
      trunk: "#6b4f3a",
    },
    hatchFamilies: {
      sky: { angle: 20, spacing: 6, stroke: ink, weight: 0.6, jitter: 0.4 },
      field: { angle: 5, spacing: 5, stroke: ink, weight: 0.5, jitter: 0.6 },
      foliage: {
        angleA: 45,
        angleB: 135,
        spacingA: 4,
        spacingB: 6,
        stroke: ink,
        weight: 0.5,
        jitter: 1.2,
      },
      mountain: { angle: 60, spacing: 5, stroke: ink, weight: 0.6, jitter: 0.5 },
      water: {
        angleA: 10,
        angleB: 100,
        spacingA: 5,
        spacingB: 7,
        stroke: ink,
        weight: 0.5,
        jitter: 0.3,
      },
      cliff: { angle: 80, spacing: 4, stroke: ink, weight: 0.7, jitter: 0.4 },
    },
    contours: { weight: 1.2, color: ink, wobble: 0.35, simplifyTolerance: 0.5 },
    objectGrammar: {
      abstractionLevel: 0.6,
      maxDetailPerObject: 12,
      edgeRoundnessBias: 0.5,
      keepNegativeSpace: true,
    },
    compositionGrammar: {
      // The floor the fixture spec's negativeSpace ask meets, so the
      // neutral fixture renders the stated hatch families unchanged.
      minEmptyAreaRatio: 0.35,
      preferredHorizonBand: [0.6, 0.75],
      focalObjectCount: 1,
    },
    texture: {
      lineJitter: 0.4,
      dropout: 0.05,
      pressureVariance: 0.2,
      paperNoise: 0.03,
    },
  };
}

/** One valid trace: identity block plus one event per recorded stage. */
export function validRenderTrace(): RenderTrace {
  return {
    specHash: "sha256:2fd4e1c67a2d28fc",
    preset: "pastoral-v1",
    seed: 42,
    compilerVersion: "0.1.0",
    events: [
      {
        stage: "planning",
        name: "horizon placed",
        message: "horizonY 0.68 sits inside the preferred band",
        data: { horizonY: 0.68 },
      },
      {
        stage: "render",
        name: "strokes emitted",
        data: { strokeCount: 128 },
      },
    ],
    metrics: {
      regionCount: 3,
      strokeCount: 128,
      svgSizeBytes: 24576,
      exportDurationMs: 12.5,
      visualDensityScore: 0.42,
    },
  };
}

/** The bird mark the intermediate representation places. */
export function birdSymbol(id = "bird-v1"): SymbolDefinition {
  const ink = "#2f2a26";
  return {
    id,
    strokes: [
      {
        path: {
          commands: [
            { command: "move", to: { x: 0, y: 0 } },
            { command: "line", to: { x: 5, y: -2 } },
          ],
        },
        weight: 0.9,
        color: ink,
      },
      {
        path: {
          commands: [
            { command: "move", to: { x: 5, y: -2 } },
            { command: "line", to: { x: 10, y: 0 } },
          ],
        },
        weight: 0.9,
        color: ink,
      },
    ],
  };
}

/** One valid intermediate representation. */
export function validRenderIR(): RenderIR {
  const ink = "#2f2a26";
  return {
    canvas: { width: 1024, height: 768 },
    regions: [
      {
        id: "sky-region",
        role: "sky",
        path: rectPath(0, 0, 1024, 522),
        fillStyle: { type: "hatch", angle: 20, spacing: 6, stroke: ink, weight: 0.6, jitter: 0.4 },
        zIndex: 0,
      },
      {
        id: "cloud-hole",
        role: "cloud-hole",
        path: rectPath(200, 120, 160, 60),
        fillStyle: { type: "none" },
        zIndex: 1,
      },
      {
        id: "foliage-region",
        role: "foliage",
        path: trianglePath(),
        fillStyle: {
          type: "crosshatch",
          angleA: 45,
          angleB: 135,
          spacingA: 4,
          spacingB: 6,
          stroke: ink,
          weight: 0.5,
          jitter: 1.2,
        },
        zIndex: 2,
      },
    ],
    contours: [{ path: trianglePath(), weight: 1.2, color: ink, role: "contour" }],
    symbols: [{ symbolId: "bird-v1", position: { x: 300, y: 140 }, scale: 1 }],
    symbolLibrary: [birdSymbol()],
    masks: [{ id: "cloud-mask-1", path: rectPath(200, 120, 160, 60), invert: true }],
    anchors: [
      {
        objectId: "obj-tree-1",
        kind: "tree",
        role: "midground",
        position: { x: 512, y: 522 },
        scale: 1,
        depth: 1,
        depthIndex: 0,
        positionClamped: false,
      },
    ],
    style: { ...validStyleSpec(), preset: "pastoral-v1" },
    trace: validRenderTrace(),
  };
}
