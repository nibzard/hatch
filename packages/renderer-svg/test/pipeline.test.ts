/**
 * End-to-end acceptance tests for the scene compiler pipeline (task T017).
 *
 * The three acceptance criteria, as tests:
 * 1. `renderScene` on an example spec returns valid SVG plus a JSON trace;
 * 2. the whole pipeline runs end to end: planning, geometry synthesis, style
 *    application, and render, over the real V1 collaborators;
 * 3. a re-render with the same inputs is byte-identical.
 *
 * The example scene uses every V1 feature at once: all five object kinds of
 * specification section 24, cloud cutouts, the paper background, and the
 * pastoral-v1 preset. Task T019 turns the same kind of scene into a golden
 * fixture; this file proves the compiler first.
 *
 * The RNG wiring criterion of the review repair is covered by the stream
 * test: the stages that receive a stream are handed the exact stage key of
 * the render identity, derived through `createStageRng` of @hatch/core.
 */

import { describe, expect, it } from "vitest";

import {
  COMPILER_VERSION,
  RenderTraceSchema,
  renderIdentityOf,
  sceneSeedKey,
  sceneSpecHash,
  TRACE_STAGES,
  type SceneSpec,
  type RenderTrace,
} from "@hatch/core";
import { generateSceneObject } from "@hatch/objects";

import {
  createV1Engine,
  renderSvg,
  renderSvgDocument,
  V1_ZONE_FAMILIES,
} from "../src/index.js";

import {
  assertWellFormedXml,
  elementMarkup,
  layerIndex,
  parseTags,
  type TagToken,
} from "./xml-check.js";

/**
 * The example scene of the V1 compiler: a pastoral creek at 4:3.
 *
 * Positions are normalized to the canvas. Every object kind of
 * specification section 24 appears once, plus the cloud cutouts of the sky.
 */
export function pastoralCreekSpec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    meta: {
      id: "pastoral-creek-0001",
      seed: 20261107,
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
      focalPoints: ["cottage-1"],
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
        id: "massif-1",
        kind: "mountain",
        role: "background",
        position: { x: 0.74, y: 0.68 },
        scale: 2,
        params: {
          width: 320,
          height: 190,
          secondaryPeaks: 2,
          ruggedness: 0.35,
          snowCap: 0.4,
        },
      },
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.7 },
        scale: 2.4,
        params: { width: 300, height: 80, crestIrregularity: 0.3, strips: 2 },
      },
      {
        id: "pond-1",
        kind: "water",
        role: "midground",
        position: { x: 0.28, y: 0.8 },
        scale: 1.5,
        params: { width: 360, depth: 90, waveAmplitude: 3, calmBand: 0.35 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.62, y: 0.78 },
        scale: 1.5,
        params: {
          width: 150,
          wallHeight: 80,
          roofPitch: 0.8,
          windows: 3,
          chimney: true,
          door: true,
        },
      },
      {
        id: "tree-2",
        kind: "tree",
        role: "midground",
        position: { x: 0.48, y: 0.75 },
        scale: 1.2,
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "foreground",
        position: { x: 0.8, y: 0.86 },
        scale: 2.2,
        params: {
          trunkHeight: 90,
          canopyRadius: 60,
          canopyLobes: 9,
          branchLines: 3,
        },
      },
    ],
    ...overrides,
  } as SceneSpec;
}

/** The region ids of one render, in document order. */
function regionIds(tokens: readonly TagToken[]): string[] {
  return tokens
    .filter(
      (token) =>
        token.kind !== "close" && token.attributes["data-region-id"] !== undefined,
    )
    .map((token) => token.attributes["data-region-id"] ?? "");
}

/** Every id the document defines, on any element. */
function definedIds(tokens: readonly TagToken[]): Set<string> {
  return new Set(
    tokens
      .map((token) => token.attributes["id"])
      .filter((id): id is string => id !== undefined),
  );
}

/** The tokens of one render, parsed once. */
function tags(markup: string): TagToken[] {
  return parseTags(markup);
}

describe("acceptance: renderScene returns valid SVG plus a JSON trace", () => {
  const engine = createV1Engine();
  const result = engine.renderScene(pastoralCreekSpec());
  const tokens = tags(result.svg);

  it("returns the four V1 artifacts of the facade", () => {
    expect(typeof result.svg).toBe("string");
    expect(result.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
      true,
    );
    expect(result.sceneSpec.meta.id).toBe("pastoral-creek-0001");
    expect(result.ir.canvas).toEqual({ width: 1024, height: 768 });
    expect(result.trace.events.length).toBe(TRACE_STAGES.length);
  });

  it("emits well-formed SVG with one root element", () => {
    assertWellFormedXml(result.svg);
    const roots = tokens.filter(
      (token) => token.name === "svg" && token.kind === "open",
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]!.attributes["viewBox"]).toBe("0 0 1024 768");
  });

  it("carries a JSON trace that validates against the schema", () => {
    const parsed = RenderTraceSchema.safeParse(result.trace);
    expect(parsed.success ? parsed.data : String(parsed.error.issues)).toEqual(
      result.trace,
    );
    // The trace is JSON: it round-trips through JSON without loss.
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("records the render identity: spec hash, preset, seed, compiler version", () => {
    expect(result.trace.specHash).toBe(
      sceneSpecHash(result.sceneSpec),
    );
    expect(result.trace.specHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.trace.preset).toBe("pastoral-v1");
    expect(result.trace.seed).toBe(20261107);
    expect(result.trace.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("embeds the same identity in the metadata block of the SVG", () => {
    const metadata = tokens.find((token) => token.name === "metadata");
    expect(metadata).toBeDefined();
    const payload = JSON.parse(metadata!.text ?? "{}");
    expect(payload).toEqual({
      generator: "@hatch/renderer-svg",
      version: COMPILER_VERSION,
      seed: 20261107,
      preset: "pastoral-v1",
      specHash: result.trace.specHash,
    });
  });
});

describe("acceptance: the four stages run end to end", () => {
  const engine = createV1Engine();
  const result = engine.renderScene(pastoralCreekSpec());
  const tokens = tags(result.svg);

  it("records one trace event per stage, in pipeline order", () => {
    expect(result.trace.events.map((event) => event.stage)).toEqual([
      ...TRACE_STAGES,
    ]);
    for (const event of result.trace.events) {
      expect(event.name.length).toBeGreaterThan(0);
      expect(event.message).toBeDefined();
    }
  });

  it("plans the scene: canvas, horizon, regions, depth order, clouds", () => {
    const planning = result.trace.events[1]!;
    expect(planning.data).toMatchObject({
      canvasWidth: 1024,
      canvasHeight: 768,
      horizonY: 522.24,
      requestedHorizonY: 0.68,
      horizonClamped: false,
      regionIds: ["sky", "ground"],
      cloudCount: 3,
      depthOrder: ["massif-1", "hill-1", "pond-1", "tree-2", "tree-1", "cottage-1"],
      clampedObjectIds: [],
      focalObjectCount: 1,
      focalObjectLimit: 1,
      negativeSpace: {
        goal: 0.35,
        floor: 0.35,
        spacingMultiplier: 1,
        spacingMultiplierClamped: false,
      },
    });
  });

  it("synthesizes the geometry of every object in depth order", () => {
    const geometry = result.trace.events[2]!;
    expect(geometry.data).toMatchObject({ objectCount: 6 });
    const data = (geometry.data ?? {}) as {
      objects?: Array<{ id: string; kind: string; depthIndex: number }>;
    };
    expect(data.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "massif-1", kind: "mountain", depthIndex: 0 }),
        expect.objectContaining({ id: "tree-1", kind: "tree", depthIndex: 4 }),
        // The cottage carries the focal role, so it synthesizes last.
        expect.objectContaining({ id: "cottage-1", kind: "house", depthIndex: 5 }),
      ]),
    );
  });

  it("fills every region with the family its role names", () => {
    const style = result.trace.events[3]!;
    const data = (style.data ?? {}) as {
      regions?: Array<{
        id: string;
        role: string;
        family: string;
        fill: { type: string; angle?: number };
      }>;
    };
    const regions = data.regions ?? [];
    const byId = new Map(regions.map((entry) => [entry.id, entry]));
    expect(byId.get("sky")).toMatchObject({
      family: "sky",
      fill: { type: "hatch", angle: 15 },
    });
    expect(byId.get("ground")).toMatchObject({
      family: "field",
      fill: { type: "hatch", angle: 0 },
    });
    expect(regions.filter((entry) => entry.family === "foliage")).toHaveLength(2);
    expect(regions.filter((entry) => entry.family === "water")).toHaveLength(1);
    expect(regions.some((entry) => entry.family === "none")).toBe(true);
  });

  it("renders the region stack of the planned scene", () => {
    const ids = regionIds(tokens);
    expect(ids[0]).toBe("sky");
    expect(ids).toContain("ground");
    // Every object contributes at least one region of its own.
    for (const id of ["massif-1", "hill-1", "pond-1", "cottage-1", "tree-1", "tree-2"]) {
      expect(ids.some((region) => region.startsWith(`${id}:z`))).toBe(true);
    }
    // The stack draws in zIndex order.
    const zIndices = tokens
      .filter((token) => token.attributes["data-region-id"] !== undefined)
      .map((token) => Number(token.attributes["data-zindex"]));
    expect([...zIndices].sort((left, right) => left - right)).toEqual(zIndices);
  });

  it("draws real hatch strokes over the paper background", () => {
    expect(result.trace.metrics?.strokeCount ?? 0).toBeGreaterThan(200);
    expect(result.trace.metrics?.regionCount ?? 0).toBeGreaterThanOrEqual(8);
    expect(result.trace.metrics?.svgSizeBytes ?? 0).toBe(
      Buffer.byteLength(result.svg, "utf8"),
    );
    const paper = tokens.find((token) => token.attributes["data-layer"] === "paper");
    expect(paper?.attributes["fill"]).toBe("#f6f1e7");
  });

  it("carries the full output metric set of section 9E", () => {
    // Regions, strokes, SVG size, export timing, and the visual density
    // score: every render trace carries all five (task T027).
    const metrics = result.trace.metrics;
    expect(metrics).toBeDefined();
    expect(Object.keys(metrics ?? {}).sort()).toEqual([
      "exportDurationMs",
      "regionCount",
      "strokeCount",
      "svgSizeBytes",
      "visualDensityScore",
    ]);
    expect(metrics?.exportDurationMs).toBeGreaterThanOrEqual(0);
    // A real scene hatches most of its paper: the density score is a share
    // of ink length over canvas area, positive and far below one line per
    // square unit.
    expect(metrics?.visualDensityScore ?? 0).toBeGreaterThan(0);
    expect(metrics?.visualDensityScore ?? 1).toBeLessThan(1);
    // The score is the stroke length the renderer drew over the canvas.
    const canvas = result.ir.canvas;
    const direct = renderSvgDocument(result.ir);
    expect(metrics?.visualDensityScore).toBeCloseTo(
      direct.strokeLength / (canvas.width * canvas.height),
      10,
    );
    // And it parses: the trace stays a valid trace with the full set.
    expect(RenderTraceSchema.parse(result.trace)).toEqual(result.trace);
  });

  it("carves the cloud cutouts as masks around the region stack", () => {
    const ids = definedIds(tokens);
    expect(ids.has("m-cloud-1")).toBe(true);
    expect(ids.has("m-cloud-2")).toBe(true);
    expect(ids.has("m-cloud-3")).toBe(true);
    const wrappers = tokens.filter(
      (token) => token.kind === "open" && token.attributes["mask"] !== undefined,
    );
    expect(wrappers).toHaveLength(3);
    const regions = layerIndex(tokens, "regions");
    expect(tokens[regions - 1]?.name).toBe("g");
  });

  it("draws the contour layer above the hatch fields", () => {
    const contours = layerIndex(tokens, "contours");
    expect(contours).toBeGreaterThan(layerIndex(tokens, "regions"));
    const contourMarkup = result.svg.slice(
      result.svg.indexOf('data-layer="contours"'),
    );
    expect(contourMarkup).toContain('stroke="#26221e"');
    expect(contourMarkup).toContain('stroke-width="1.1"');
  });

  it("emits path data with finite coordinates only", () => {
    expect(result.svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("acceptance: a re-render with the same inputs is byte-identical", () => {
  const engine = createV1Engine();

  it("renders the same spec byte-identically twice", () => {
    const first = engine.renderScene(pastoralCreekSpec());
    const second = engine.renderScene(pastoralCreekSpec());
    expect(second.svg).toBe(first.svg);
    // The export duration is the one measured value of the trace
    // (specification section 9E): it rides on the render event and in the
    // metrics, and everything else about the two runs is identical.
    const stripDurations = (trace: RenderTrace): RenderTrace => ({
      ...trace,
      metrics: trace.metrics && { ...trace.metrics, exportDurationMs: 0 },
      events: trace.events.map((event) =>
        event.durationMs === undefined ? event : { ...event, durationMs: 0 },
      ),
    });
    expect(stripDurations(second.trace)).toEqual(stripDurations(first.trace));
    expect(
      JSON.stringify({ ...second.ir, trace: stripDurations(second.ir.trace) }),
    ).toBe(JSON.stringify({ ...first.ir, trace: stripDurations(first.ir.trace) }));
  });

  it("renders the same scene identically after another scene ran first", () => {
    const first = engine.renderScene(pastoralCreekSpec());
    engine.renderScene(pastoralCreekSpec({ meta: { ...first.sceneSpec.meta, seed: 7 } }));
    const third = engine.renderScene(pastoralCreekSpec());
    expect(third.svg).toBe(first.svg);
  });

  it("changes the output when the render identity changes", () => {
    const base = engine.renderScene(pastoralCreekSpec());
    const reseeded = engine.renderScene(
      pastoralCreekSpec({ meta: { ...base.sceneSpec.meta, seed: 7 } }),
    );
    expect(reseeded.svg).not.toBe(base.svg);
    expect(reseeded.trace.seed).toBe(7);
    // The seed is part of the spec, so it feeds the spec hash too.
    expect(reseeded.trace.specHash).not.toBe(base.trace.specHash);
  });

  it("changes the spec hash and the output when the spec changes", () => {
    const base = engine.renderScene(pastoralCreekSpec());
    const moved = engine.renderScene(
      pastoralCreekSpec({
        objects: base.sceneSpec.objects.map((object) =>
          object.id === "cottage-1"
            ? { ...object, position: { x: 0.55, y: 0.78 } }
            : object,
        ),
      }),
    );
    expect(moved.trace.specHash).not.toBe(base.trace.specHash);
    expect(moved.svg).not.toBe(base.svg);
  });

  it("re-renders the returned intermediate representation to the same bytes", () => {
    const first = engine.renderScene(pastoralCreekSpec());
    // The trace the IR carries holds more than the metadata embeds, and the
    // renderer draws only from the identity, so the round trip is stable.
    expect(renderSvg(first.ir)).toBe(first.svg);
  });
});

describe("every stage draws from its own stream of the render identity", () => {
  it("hands the geometry stage and the render stage their own keys", () => {
    const spec = pastoralCreekSpec({ environment: { type: "rural" } });
    const identity = renderIdentityOf(spec);
    const root = sceneSeedKey(identity);
    const objectKeys: string[] = [];
    const renderKeys: string[] = [];
    const engine = createV1Engine({
      objects: {
        generateObject: (request) => {
          objectKeys.push(request.rng.seedKey);
          return generateSceneObject(request);
        },
      },
      renderer: {
        render: (ir, rng) => {
          renderKeys.push(rng.seedKey);
          return renderSvgDocument(ir, rng);
        },
      },
    });

    const result = engine.renderScene(spec);

    // One geometry stream per object, all derived from the identity, and a
    // separate render stream: what one stage draws never shifts another.
    expect(objectKeys).toHaveLength(spec.objects.length);
    expect(new Set(objectKeys)).toEqual(new Set([`${root}#stage:geometry`]));
    expect(renderKeys).toEqual([`${root}#stage:render`]);
    // The scene without clouds plans without drawing, and still renders.
    expect(result.trace.events[1]!.data).toMatchObject({ cloudCount: 0 });
    assertWellFormedXml(result.svg);
  });
});

describe("the V1 binding", () => {
  it("registers every shipped preset and the five V1 object kinds", () => {
    const engine = createV1Engine();
    expect(engine.listPresets()).toEqual([
      "coastal-v1",
      "pastoral-v1",
      "skatepark-v1",
      "urban-v1",
    ]);
    expect(engine.hasPreset("pastoral-v1")).toBe(true);
    expect(engine.hasPreset("coastal-v1")).toBe(true);
    expect(engine.hasPreset("urban-v1")).toBe(true);
    expect(engine.hasPreset("skatepark-v1")).toBe(true);
    expect(engine.hasPreset("interior-v1")).toBe(false);
  });

  it("fails with a readable error for an unknown object kind", () => {
    const engine = createV1Engine();
    expect(() =>
      engine.renderScene(
        pastoralCreekSpec({
          objects: [
            {
              id: "volcano-1",
              kind: "volcano",
              position: { x: 0.5, y: 0.7 },
              scale: 1,
            },
          ],
          // The replaced objects leave the focal point of the fixture
          // dangling, and planning rejects that before geometry runs.
          composition: {
            ...pastoralCreekSpec().composition,
            focalPoints: [],
          },
        }),
      ),
    ).toThrow(/unknown object kind "volcano"; the object kinds are/);
  });

  it("fails with a readable error for an unknown style preset", () => {
    const engine = createV1Engine();
    expect(() =>
      engine.renderScene(
        pastoralCreekSpec({
          meta: {
            id: "scene-0001",
            seed: 1,
            stylePreset: "interior-v1",
            aspectRatio: "4:3",
            version: "1.0.0",
          },
        }),
      ),
    ).toThrow(/unknown style preset 'interior-v1'/);
  });

  it("rejects an invalid scene spec before any stage runs", () => {
    const engine = createV1Engine();
    expect(() => engine.renderScene({ meta: { id: "broken" } })).toThrow(
      /invalid SceneSpec/,
    );
  });

  it("renders a scene without objects as sky and ground alone", () => {
    const engine = createV1Engine();
    const result = engine.renderScene(
      pastoralCreekSpec({
        objects: [],
        // No object is left for the focal point of the fixture to name.
        composition: { ...pastoralCreekSpec().composition, focalPoints: [] },
      }),
    );
    expect(regionIds(tags(result.svg))).toEqual(["sky", "ground"]);
    expect(result.trace.metrics?.regionCount).toBe(2);
    assertWellFormedXml(result.svg);
  });

  it("applies the style overrides of the spec", () => {
    const engine = createV1Engine();
    const base = engine.renderScene(pastoralCreekSpec());
    const denser = engine.renderScene(
      pastoralCreekSpec({
        styleOverrides: {
          texture: { lineJitter: 0.8, dropout: 0.2, pressureVariance: 0.3, paperNoise: 0.06 },
        },
      }),
    );
    expect(denser.ir.style.texture.dropout).toBe(0.2);
    expect(base.ir.style.texture.dropout).toBe(0.04);
    expect(denser.svg).not.toBe(base.svg);
  });

  it("covers every role the generators emit in its zone table", () => {
    for (const role of [
      "architecture",
      "roof",
      "foliage",
      "field",
      "mountain",
      "rock",
      "water",
      "snow",
      "concrete",
      "pavement",
      "metal",
      "glass",
      "shadow",
      "figure",
      "sky",
      "ground",
    ]) {
      expect(V1_ZONE_FAMILIES[role]).toBeDefined();
    }
  });
});

describe("the debug overlays of specification sections 5 and 9 (T022)", () => {
  /** Every `data-layer` value of one document, in draw order. */
  function layers(markup: string): string[] {
    return tags(markup)
      .filter((token) => token.attributes["data-layer"] !== undefined)
      .map((token) => token.attributes["data-layer"] ?? "");
  }

  /** The markup of the artwork, before the first overlay or the close tag. */
  function artwork(markup: string): string {
    const overlay = markup.indexOf('<g data-layer="debug-');
    const cut = overlay >= 0 ? overlay : markup.indexOf("</svg>");
    return markup.slice(0, cut).replace(/\s+$/, "");
  }

  it("adds one overlay layer per flag over the real V1 pipeline", () => {
    const engine = createV1Engine();
    const plain = engine.renderScene(pastoralCreekSpec());
    const withOverlays = engine.renderScene(
      pastoralCreekSpec({
        debug: {
          showRegions: true,
          showDepthMap: true,
          showHatchDirections: true,
          showNegativeSpace: true,
          showAnchors: true,
          showConstructionLines: true,
          showContourOnly: true,
        },
      }),
    );
    assertWellFormedXml(withOverlays.svg);
    expect(layers(withOverlays.svg)).toEqual([
      ...layers(plain.svg),
      "debug-contour-only",
      "debug-regions",
      "debug-depth",
      "debug-hatch-directions",
      "debug-negative-space",
      "debug-anchors",
      "debug-construction",
    ]);
  });

  it("leaves every byte of the plain render in front of the overlays", () => {
    const engine = createV1Engine();
    const plain = engine.renderScene(pastoralCreekSpec());
    const withOverlays = engine.renderScene(
      pastoralCreekSpec({ debug: { showRegions: true, showAnchors: true } }),
    );
    expect(artwork(withOverlays.svg)).toBe(artwork(plain.svg));
  });

  it("renders a block of false flags byte-identically to no debug object", () => {
    const engine = createV1Engine();
    const plain = engine.renderScene(pastoralCreekSpec());
    const allOff = engine.renderScene(
      pastoralCreekSpec({
        debug: {
          showRegions: false,
          showDepthMap: false,
          showHatchDirections: false,
          showNegativeSpace: false,
          showAnchors: false,
          showConstructionLines: false,
          showContourOnly: false,
        },
      }),
    );
    expect(allOff.svg).toBe(plain.svg);
    expect(allOff.trace.specHash).toBe(plain.trace.specHash);
  });

  it("keeps the render identity, and so the hatching, across the overlays", () => {
    const engine = createV1Engine();
    const plain = engine.renderScene(pastoralCreekSpec());
    const withOverlays = engine.renderScene(
      pastoralCreekSpec({ debug: { showDepthMap: true } }),
    );
    expect(withOverlays.trace.specHash).toBe(plain.trace.specHash);
    expect(withOverlays.trace.metrics?.strokeCount).toBe(
      plain.trace.metrics?.strokeCount,
    );
    // The artwork of the overlay render is the artwork of the plain render,
    // so the overlay explains that drawing and no other.
    expect(artwork(withOverlays.svg)).toBe(artwork(plain.svg));
  });

  it("marks every anchor the planner placed in a full scene", () => {
    const engine = createV1Engine();
    const result = engine.renderScene(
      pastoralCreekSpec({ debug: { showAnchors: true } }),
    );
    const layer = elementMarkup(
      result.svg,
      tags(result.svg),
      layerIndex(tags(result.svg), "debug-anchors"),
    );
    for (const anchor of result.ir.anchors) {
      expect(layer).toContain(`data-object-id="${anchor.objectId}"`);
    }
    expect(result.ir.anchors.length).toBe(pastoralCreekSpec().objects.length);
  });

  it("records the enabled overlays in the intent event of the trace", () => {
    const engine = createV1Engine();
    const result = engine.renderScene(
      pastoralCreekSpec({ debug: { showRegions: true } }),
    );
    expect(result.trace.events[0]!.data).toMatchObject({
      debugOverlays: ["showRegions"],
    });
  });
});
