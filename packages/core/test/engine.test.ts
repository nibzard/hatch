/**
 * Tests for the scene compiler pipeline and the HatchEngine facade (T017).
 *
 * @hatch/core cannot import the packages it orchestrates, so these tests
 * inject stub collaborators: one square object generator, one renderer that
 * reports a stroke count, and the fixture preset under its own id. The
 * stage order, the trace, the render identity, and the determinism contract
 * are all observable here without any other package.
 *
 * The end-to-end scene over the real V1 collaborators is tested in
 * @hatch/renderer-svg (test/pipeline.test.ts).
 */

import { describe, expect, it } from "vitest";

import {
  applySceneStyle,
  ASYMMETRIC_SPREAD,
  COMPILER_VERSION,
  FRAMING_SUBJECT_SCALE,
  HatchEngine,
  LENS_PERSPECTIVE,
  OBJECT_ZONE_BAND_STRIDE,
  planScene,
  RAIN_REGION_ID,
  rainZoneZIndex,
  renderIdentityOf,
  RenderTraceSchema,
  sceneSeedKey,
  sceneSpecHash,
  synthesizeSceneGeometry,
  TRACE_STAGES,
  type Geometry,
  type HatchEngineOptions,
  type ObjectGeometryRequest,
  type Path,
  type Point,
  type RegionCompositionInput,
  type RenderIR,
  type RenderTrace,
  type EnvironmentType,
  type SceneSpec,
  type SeededRng,
  type StyleOverrides,
  type StyleSpec,
} from "../src/index.js";
import { createStageRng } from "../src/rng.js";
import { validSceneSpec, validStyleSpec } from "./fixtures.js";

/** The preset id the test engine registers. */
const PRESET_ID = "test-pastoral";

/** The zone families the stub scene needs. */
const ZONE_FAMILIES = {
  sky: "sky",
  ground: "field",
  foliage: "foliage",
} as const;

/**
 * The stub object: one square silhouette on the anchor, one contour, one
 * internal boundary, and two style zones so per-object region ids are
 * exercised. It draws nothing, so its geometry never moves.
 */
function stubGeometry(anchor: Point): Geometry {
  const left = anchor.x - 40;
  const top = anchor.y - 80;
  return {
    silhouette: {
      commands: [
        { command: "move", to: { x: left, y: anchor.y } },
        { command: "line", to: { x: left + 80, y: anchor.y } },
        { command: "line", to: { x: left + 80, y: top } },
        { command: "line", to: { x: left, y: top } },
        { command: "close" },
      ],
    },
    contours: [
      {
        commands: [
          { command: "move", to: { x: left, y: anchor.y } },
          { command: "line", to: { x: left + 80, y: anchor.y } },
        ],
      },
    ],
    internalBoundaries: [
      {
        commands: [
          { command: "move", to: { x: left + 20, y: anchor.y } },
          { command: "line", to: { x: left + 20, y: top } },
        ],
      },
    ],
    styleZones: [
      { role: "foliage", path: { commands: [{ command: "move", to: anchor }], }, zIndex: 20 },
      { role: "foliage", path: { commands: [{ command: "move", to: { x: anchor.x, y: top } }] } },
    ],
  };
}

/** The object source of the test engine, with optional request recording. */
function stubObjects(
  requests: ObjectGeometryRequest[] = [],
): HatchEngineOptions["objects"] {
  return {
    generateObject: (request) => {
      requests.push(request);
      return stubGeometry(request.anchor);
    },
  };
}

/** The renderer of the test engine, with optional IR recording. */
function stubRenderer(
  rendered: { ir: RenderIR; rng: SeededRng }[] = [],
): HatchEngineOptions["renderer"] {
  return {
    render: (ir, rng) => {
      rendered.push({ ir, rng });
      return {
        svg: `<svg data-regions="${ir.regions.length}"></svg>`,
        strokeCount: ir.regions.length * 3,
        // Every stub stroke draws ten user units of ink, so the visual
        // density score of the trace has a value a test can compute.
        strokeLength: ir.regions.length * 3 * 10,
      };
    },
  };
}

/** One engine over the stub collaborators. */
function testEngine(
  requests: ObjectGeometryRequest[] = [],
  rendered: { ir: RenderIR; rng: SeededRng }[] = [],
  overrides: Partial<HatchEngineOptions> = {},
): HatchEngine {
  return new HatchEngine({
    styles: [{ id: PRESET_ID, style: validStyleSpec() }],
    objects: stubObjects(requests),
    renderer: stubRenderer(rendered),
    zoneFamilies: ZONE_FAMILIES,
    ...overrides,
  });
}

/** The example spec of the engine tests: one tree-like object. */
function engineSpec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  const spec = validSceneSpec();
  spec.meta.stylePreset = PRESET_ID;
  spec.objects = [
    {
      id: spec.objects[0]!.id,
      kind: spec.objects[0]!.kind,
      role: "midground",
      position: { x: 0.5, y: 0.7 },
      scale: 1,
    },
  ];
  spec.environment = { type: "rural" };
  return { ...spec, ...overrides };
}

describe("acceptance: renderScene returns the four V1 artifacts", () => {
  const engine = testEngine();
  const result = engine.renderScene(engineSpec());

  it("returns svg, sceneSpec, ir, and trace", () => {
    expect(result.svg).toBe('<svg data-regions="4"></svg>');
    expect(result.sceneSpec.meta.id).toBe("scene-0001");
    expect(result.ir.canvas).toEqual({ width: 1024, height: 768 });
    expect(result.ir.trace).toBe(result.trace);
  });

  it("parses the input, so an invalid spec fails before any stage", () => {
    expect(() => engine.renderScene({ nope: true })).toThrow(
      /invalid SceneSpec/,
    );
  });

  it("records the render identity in the trace", () => {
    expect(result.trace.specHash).toBe(sceneSpecHash(result.sceneSpec));
    expect(result.trace.specHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.trace.preset).toBe(PRESET_ID);
    expect(result.trace.seed).toBe(result.sceneSpec.meta.seed);
    expect(result.trace.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("builds the region stack of the plan and the object zones", () => {
    // The zone without an authored zIndex draws at the documented default
    // of 10, under the authored 20 of the first zone. The scene holds one
    // object, so its band is the first and both layers paint inside it
    // unchanged.
    expect(result.ir.regions.map((region) => region.id)).toEqual([
      "sky",
      "ground",
      "tree-1:z1",
      "tree-1:z0",
    ]);
    expect(result.ir.regions.map((region) => region.zIndex)).toEqual([
      0, 1, 10, 20,
    ]);
    expect(result.ir.regions.map((region) => region.fillStyle.type)).toEqual([
      "hatch",
      "hatch",
      "crosshatch",
      "crosshatch",
    ]);
  });

  it("fills each family from the resolved style", () => {
    const style = validStyleSpec();
    expect(result.ir.regions[0]?.fillStyle).toEqual({
      type: "hatch",
      angle: style.hatchFamilies.sky.angle,
      spacing: style.hatchFamilies.sky.spacing,
      stroke: style.hatchFamilies.sky.stroke,
      weight: style.hatchFamilies.sky.weight,
      jitter: style.hatchFamilies.sky.jitter,
    });
    expect(result.ir.regions[2]?.fillStyle).toEqual({
      type: "crosshatch",
      angleA: style.hatchFamilies.foliage.angleA,
      angleB: style.hatchFamilies.foliage.angleB,
      spacingA: style.hatchFamilies.foliage.spacingA,
      spacingB: style.hatchFamilies.foliage.spacingB,
      stroke: style.hatchFamilies.foliage.stroke,
      weight: style.hatchFamilies.foliage.weight,
      jitter: style.hatchFamilies.foliage.jitter,
    });
    expect(result.ir.style.preset).toBe(PRESET_ID);
  });

  it("humanizes and draws the contours of every object", () => {
    // One contour and one internal boundary per object, wobbled and drawn
    // in the contour ink of the style.
    expect(result.ir.contours).toHaveLength(2);
    for (const contour of result.ir.contours) {
      expect(contour.role).toBe("contour");
      expect(contour.weight).toBe(validStyleSpec().contours.weight);
      expect(contour.color).toBe(validStyleSpec().contours.color);
      // The wobble resamples the line, so the polyline grows.
      expect(contour.path.commands.length).toBeGreaterThan(2);
    }
  });

  it("carries the output metrics of the render", () => {
    // The full section 9E set: regions, strokes, SVG size, export timing,
    // and the visual density score. The stub draws 12 strokes of 10 user
    // units each on a 1024x768 canvas.
    expect(result.trace.metrics?.regionCount).toBe(4);
    expect(result.trace.metrics?.strokeCount).toBe(12);
    expect(result.trace.metrics?.svgSizeBytes).toBe(
      Buffer.byteLength(result.svg, "utf8"),
    );
    expect(result.trace.metrics?.exportDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace.metrics?.visualDensityScore).toBe(
      (12 * 10) / (1024 * 768),
    );
  });
});

describe("the trace", () => {
  const engine = testEngine();
  const result = engine.renderScene(engineSpec());

  it("validates against the RenderTrace schema", () => {
    expect(RenderTraceSchema.parse(result.trace)).toEqual(result.trace);
  });

  it("records one event per stage, in pipeline order", () => {
    expect(result.trace.events.map((event) => event.stage)).toEqual([
      ...TRACE_STAGES,
    ]);
  });

  it("carries JSON-safe data on every event", () => {
    for (const event of result.trace.events) {
      expect(JSON.parse(JSON.stringify(event.data ?? {}))).toEqual(
        event.data ?? {},
      );
    }
  });

  it("names the horizon decision of the planner", () => {
    const planning = result.trace.events[1]!;
    expect(planning.name).toBe("scene planned");
    expect(planning.data).toMatchObject({
      horizonY: 0.68 * 768,
      requestedHorizonY: 0.68,
      horizonClamped: false,
      regionIds: ["sky", "ground"],
      depthOrder: ["tree-1"],
    });
    expect(planning.message).toContain("preferred band");
  });

  it("records the camera and the composition the layout followed", () => {
    const planning = result.trace.events[1]!.data as Record<string, unknown>;
    expect(planning["camera"]).toEqual({
      framing: "wide",
      framingScale: FRAMING_SUBJECT_SCALE.wide,
      lens: "normal",
      perspective: LENS_PERSPECTIVE.normal,
      perspectiveStrength: 1,
      perspectiveStrengthClamped: false,
      tiltDegrees: 0,
      tiltClamped: false,
      balance: "asymmetric",
      balanceShift: 0,
      balanceSpread: ASYMMETRIC_SPREAD,
      depthLayers: 3,
      depthLayersClamped: false,
      depthRamp: 2 / 3,
      focalPointIds: ["tree-1"],
    });
    expect(planning["focalPlacementIds"]).toEqual(["tree-1"]);
    expect(planning["placementCameras"]).toEqual([
      { id: "tree-1", scale: 1.0625, rotation: 0 },
    ]);
  });

  it("reports a horizon the style had to move", () => {
    const moved = engine.renderScene(
      engineSpec({
        camera: { ...engineSpec().camera, horizonY: 0.95 },
      }),
    );
    const planning = moved.trace.events[1]!;
    expect(planning.data).toMatchObject({
      requestedHorizonY: 0.95,
      horizonY: 0.75 * 768,
      horizonClamped: true,
    });
    expect(planning.message).toContain("moved from 0.95");
  });

  it("names the objects the planner clamped onto the canvas", () => {
    const clamped = engine.renderScene(
      engineSpec({
        objects: engineSpec().objects.map((object) => ({
          ...object,
          position: { x: 1.5, y: object.position.y },
        })),
      }),
    );
    expect(clamped.trace.events[1]!.data).toMatchObject({
      clampedObjectIds: ["tree-1"],
    });
  });

  it("reports the family of every region in the style event", () => {
    const style = result.trace.events[3]!;
    const data = (style.data ?? {}) as {
      regions?: Array<{ id: string; family: string }>;
    };
    const regions = data.regions ?? [];
    expect(regions).toEqual([
      expect.objectContaining({ id: "sky", family: "sky" }),
      expect.objectContaining({ id: "ground", family: "field" }),
      expect.objectContaining({ id: "tree-1:z1", family: "foliage" }),
      expect.objectContaining({ id: "tree-1:z0", family: "foliage" }),
    ]);
  });

  it("reports the render facts in the render event", () => {
    expect(result.trace.events[4]!.data).toEqual({
      svgSizeBytes: result.trace.metrics?.svgSizeBytes,
      strokeCount: 12,
      regionCount: 4,
      visualDensityScore: result.trace.metrics?.visualDensityScore,
    });
    // The export timing of section 9E rides on the event's duration field.
    expect(result.trace.events[4]!.durationMs).toBe(
      result.trace.metrics?.exportDurationMs,
    );
  });
});

describe("determinism of the pipeline", () => {
  it("renders the same spec byte-identically twice", () => {
    const engine = testEngine();
    const first = engine.renderScene(engineSpec());
    const second = engine.renderScene(engineSpec());
    expect(second.svg).toBe(first.svg);
    // The one wall-clock value of the trace is the export duration
    // (specification section 9E), a measurement of the run rather than a
    // fact of the compile. It travels as the metrics' exportDurationMs and
    // as the durationMs of the render event, so the comparison zeroes both
    // and checks the measurement itself separately.
    const stripDurations = (trace: RenderTrace): RenderTrace => ({
      ...trace,
      metrics: trace.metrics && { ...trace.metrics, exportDurationMs: 0 },
      events: trace.events.map((event) =>
        event.durationMs === undefined ? event : { ...event, durationMs: 0 },
      ),
    });
    expect(stripDurations(second.trace)).toEqual(stripDurations(first.trace));
    for (const result of [first, second]) {
      expect(result.trace.metrics?.exportDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.trace.events[4]!.durationMs).toBe(
        result.trace.metrics?.exportDurationMs,
      );
    }
    expect(
      JSON.stringify({ ...second.ir, trace: stripDurations(second.ir.trace) }),
    ).toBe(JSON.stringify({ ...first.ir, trace: stripDurations(first.ir.trace) }));
  });

  it("renders the same scene identically after another scene ran first", () => {
    const engine = testEngine();
    const first = engine.renderScene(engineSpec());
    engine.renderScene(
      engineSpec({ meta: { ...engineSpec().meta, seed: 99 } }),
    );
    expect(engine.renderScene(engineSpec()).svg).toBe(first.svg);
  });

  it("changes the output when the identity changes", () => {
    const engine = testEngine();
    const first = engine.renderScene(engineSpec());
    const second = engine.renderScene(
      engineSpec({ meta: { ...engineSpec().meta, seed: 99 } }),
    );
    expect(second.svg).toBe(first.svg); // The stub renderer ignores the stream.
    expect(second.trace.seed).toBe(99);
    expect(second.trace.specHash).not.toBe(first.trace.specHash);
  });
});

describe("the seeded streams of the stages", () => {
  it("hands each stage its own stream of the render identity", () => {
    const requests: ObjectGeometryRequest[] = [];
    const rendered: { ir: RenderIR; rng: SeededRng }[] = [];
    const engine = testEngine(requests, rendered);
    const spec = engineSpec();
    engine.renderScene(spec);

    const identity = renderIdentityOf(spec);
    const root = sceneSeedKey(identity);
    expect(requests.map((request) => request.rng.seedKey)).toEqual([
      `${root}#stage:geometry`,
    ]);
    expect(rendered.map((entry) => entry.rng.seedKey)).toEqual([
      `${root}#stage:render`,
    ]);
  });

  it("passes the anchor of the plan to the object source", () => {
    const requests: ObjectGeometryRequest[] = [];
    testEngine(requests).renderScene(engineSpec());
    // The anchor is the normalized position on the canvas, rounded to
    // milli-units, so the path numbers of the scene stay short.
    expect(requests[0]?.anchor).toEqual({ x: 512, y: 537.6 });
    expect(requests[0]?.object.id).toBe("tree-1");
  });

  it("passes the placement transform the camera computed", () => {
    const requests: ObjectGeometryRequest[] = [];
    const base = engineSpec();
    const spec = engineSpec({
      camera: {
        ...base.camera,
        framing: "close",
        lens: "ultra-wide",
        tilt: 5,
      },
      composition: {
        ...base.composition,
        depthLayers: 4,
        focalPoints: ["tree-1"],
      },
      objects: base.objects.map((object) => ({
        ...object,
        role: "focal" as const,
      })),
    });
    testEngine(requests).renderScene(spec);
    // The spec scale of 1 under the close framing, on the focal plane of a
    // full ultra-wide stack, under the focal emphasis, with the camera roll.
    expect(requests[0]?.camera).toEqual({
      scale: 1.3 * (1 / (1 - 0.35)) * 1.25,
      rotation: 5,
    });
  });

  it("replays a stage from a fresh stream of the same identity", () => {
    const spec = engineSpec();
    const style = { ...validStyleSpec(), preset: PRESET_ID };
    const identity = renderIdentityOf(spec);
    const first = testEngine().renderScene(spec);

    // A scene without clouds draws nothing in planning, so fresh streams of
    // the same keys replay the plan and the geometry exactly.
    const plan = planScene(spec, style, createStageRng(identity, "planning"));
    const geometry = synthesizeSceneGeometry(
      plan,
      stubObjects(),
      createStageRng(identity, "geometry"),
    );
    const styled = applySceneStyle(
      plan,
      geometry,
      style,
      ZONE_FAMILIES,
      {},
      createStageRng(identity, "style"),
    );

    expect(styled.regions).toEqual(first.ir.regions);
    expect(styled.contours).toEqual(first.ir.contours);
    expect(styled.masks).toEqual(first.ir.masks);
    // The same style stream wobbled the identical contours twice, and a
    // different identity wobbles different ones.
    const other = applySceneStyle(
      plan,
      geometry,
      style,
      ZONE_FAMILIES,
      {},
      createStageRng({ ...identity, seed: 1234 }, "style"),
    );
    expect(other.contours).not.toEqual(styled.contours);
  });
});

/**
 * Two objects that overlap on the canvas: the hill draws behind, the house
 * in front of it. Both use the stub square of this file, so the masks and
 * the zIndex bands each zone receives are the whole story here.
 */
function occlusionSpec(): SceneSpec {
  const base = engineSpec();
  return {
    ...base,
    composition: { ...base.composition, focalPoints: [] },
    objects: [
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.4, y: 0.7 },
        scale: 1,
      },
      {
        id: "house-1",
        kind: "house",
        role: "midground",
        position: { x: 0.6, y: 0.7 },
        scale: 1,
      },
    ],
  };
}

describe("the occlusion masks of the style stage", () => {
  it("carves each object zone with the silhouettes of the objects in front", () => {
    const requests: ObjectGeometryRequest[] = [];
    const recorded: RegionCompositionInput[] = [];
    const engine = testEngine(requests, undefined, {
      tools: {
        composeRegion: (input) => {
          recorded.push(input);
          return [
            {
              id: input.id,
              ...(input.role === undefined ? {} : { role: input.role }),
              path: input.path,
              fillStyle: input.fillStyle,
              zIndex: input.zIndex,
            },
          ];
        },
      },
    });
    engine.renderScene(occlusionSpec());

    // The stub geometry of one object, rebuilt from the anchor the engine
    // passed, so the masks below can be named by object.
    const silhouetteOf = (id: string): Path =>
      stubGeometry(
        requests.find((request) => request.object.id === id)!.anchor,
      ).silhouette;
    const masksOf = (id: string): readonly Path[] =>
      recorded.find((input) => input.id === id)?.masks ?? [];

    // The scene regions draw under every object, so both silhouettes carve
    // them, in depth order.
    expect(masksOf("sky")).toEqual([
      silhouetteOf("hill-1"),
      silhouetteOf("house-1"),
    ]);
    expect(masksOf("ground")).toEqual([
      silhouetteOf("hill-1"),
      silhouetteOf("house-1"),
    ]);
    // The hill draws first, so the house alone stands in front of it: its
    // silhouette carves every hill zone, and the hill's own never does.
    expect(masksOf("hill-1:z0")).toEqual([silhouetteOf("house-1")]);
    expect(masksOf("hill-1:z1")).toEqual([silhouetteOf("house-1")]);
    // The house draws last: nothing stands in front of it, and its own
    // silhouette never carves its zones away.
    expect(masksOf("house-1:z0")).toEqual([]);
    expect(masksOf("house-1:z1")).toEqual([]);
  });

  it("carves each contour line with the silhouettes of the objects in front", () => {
    const requests: ObjectGeometryRequest[] = [];
    const recorded: { line: Path; masks: readonly Path[] }[] = [];
    const engine = testEngine(requests, undefined, {
      tools: {
        carveContour: (line, masks) => {
          recorded.push({ line, masks });
          // The first line splits into two visible pieces, so the test can
          // tell one stroke per piece from one stroke per line.
          return recorded.length === 1 ? [line, line] : [line];
        },
      },
    });
    const result = engine.renderScene(occlusionSpec());

    const silhouetteOf = (id: string): Path =>
      stubGeometry(
        requests.find((request) => request.object.id === id)!.anchor,
      ).silhouette;

    // The hill draws first with one contour and one internal boundary, so
    // exactly its two lines reach the carver, each under the silhouette of
    // the house alone. The house draws last, so its own lines never do.
    expect(recorded).toHaveLength(2);
    for (const call of recorded) {
      expect(call.masks).toEqual([silhouetteOf("house-1")]);
      // The carver receives the humanized line, which the wobble resampled.
      expect(call.line.commands.length).toBeGreaterThan(2);
    }
    // Every line became one stroke per piece, and each stroke names the
    // object it draws: three for the split hill line and the whole one, two
    // for the uncarved house lines.
    expect(result.ir.contours.map((stroke) => stroke.objectId)).toEqual([
      "hill-1",
      "hill-1",
      "hill-1",
      "house-1",
      "house-1",
    ]);
  });

  it("draws every contour line whole when no carver is wired", () => {
    const result = testEngine().renderScene(occlusionSpec());
    // One contour and one internal boundary per object, one stroke each.
    expect(result.ir.contours.map((stroke) => stroke.objectId)).toEqual([
      "hill-1",
      "hill-1",
      "house-1",
      "house-1",
    ]);
  });

  it("passes every zone through uncomposed when no composer is wired", () => {
    const engine = testEngine();
    const result = engine.renderScene(occlusionSpec());
    // The zones keep their authored layers - the first stub zone draws at
    // 20, the second at the default 10 - but each object paints them inside
    // its own band, so the stack groups the two objects in depth order even
    // though the authored 20 of the hill outranks the authored 10 of the
    // house that stands in front of it.
    expect(result.ir.regions.map((region) => region.id)).toEqual([
      "sky",
      "ground",
      "hill-1:z1",
      "hill-1:z0",
      "house-1:z1",
      "house-1:z0",
    ]);
    expect(result.ir.regions.map((region) => region.zIndex)).toEqual([
      0, 1, 10, 20, 110, 120,
    ]);
  });
});

describe("the zIndex bands of the object zones (T047)", () => {
  // The renderer stacks regions by zIndex alone, while the occlusion carve
  // of the style stage follows the depth order of the plan. The two agree
  // because every object paints its zones inside one band of its own, in
  // depth order: the object in front draws above the object behind it
  // whatever layer the two generators authored.
  it("paints the band of the object in front above the band behind it", () => {
    const result = testEngine().renderScene(occlusionSpec());
    // The hill draws behind on the authored 20 of its first zone; the house
    // draws in front on the authored 10 of the same stub. The stack must
    // follow the depth order, not the authored numbers.
    const zIndexes = new Map(
      result.ir.regions.map((region) => [region.id, region.zIndex]),
    );
    for (const behind of ["hill-1:z0", "hill-1:z1"]) {
      for (const front of ["house-1:z0", "house-1:z1"]) {
        expect(zIndexes.get(front)!).toBeGreaterThan(zIndexes.get(behind)!);
      }
    }
    // The authored layer keeps ordering the zones of one object: the default
    // 10 of the second stub zone draws under the authored 20 of the first.
    expect(zIndexes.get("hill-1:z0")!).toBeGreaterThan(zIndexes.get("hill-1:z1")!);
    expect(zIndexes.get("house-1:z0")!).toBeGreaterThan(
      zIndexes.get("house-1:z1")!,
    );
    // Every object zone paints above the two scene regions of the plan.
    for (const [id, zIndex] of zIndexes) {
      if (id.includes(":z")) {
        expect(zIndex).toBeGreaterThan(zIndexes.get("ground")!);
      }
    }
  });

  it("draws the rain one band above every object zone", () => {
    const spec = occlusionSpec();
    spec.environment = { type: "rural", atmosphere: { rain: 40 } };
    const result = testEngine().renderScene(spec);
    const rain = result.ir.regions.find(
      (region) => region.id === RAIN_REGION_ID,
    );
    expect(rain).toBeDefined();
    expect(rain!.zIndex).toBe(rainZoneZIndex(spec.objects.length));
    for (const region of result.ir.regions) {
      if (region.id !== RAIN_REGION_ID) {
        expect(region.zIndex).toBeLessThan(rain!.zIndex);
      }
    }
  });

  it("rejects a zone layer that falls outside the band of one object", () => {
    // A generator that authored a layer above the band width would paint its
    // zone into the band of a neighbour object, so the style stage states the
    // contract instead of drawing a stack that contradicts its own carving.
    const engine = testEngine(undefined, undefined, {
      objects: {
        generateObject: (request) => ({
          ...stubGeometry(request.anchor),
          styleZones: [
            {
              role: "foliage",
              path: { commands: [{ command: "move", to: request.anchor }] },
              zIndex: OBJECT_ZONE_BAND_STRIDE,
            },
          ],
        }),
      },
    });
    expect(() => engine.renderScene(occlusionSpec())).toThrow(
      /hill-1:z0 authored zIndex 100, which falls outside/,
    );
  });
});

describe("the style input", () => {
  it("accepts a preset source in place of the array", () => {
    const registry = new Map<string, StyleSpec>([
      [PRESET_ID, validStyleSpec()],
    ]);
    const engine = new HatchEngine({
      styles: {
        listPresets: () => [...registry.keys()],
        resolve: (presetId) => {
          const base = registry.get(presetId);
          if (base === undefined) {
            throw new Error(`unknown style preset '${presetId}'`);
          }
          return { ...structuredClone(base), preset: presetId };
        },
      },
      objects: stubObjects(),
      renderer: stubRenderer(),
      zoneFamilies: ZONE_FAMILIES,
    });
    expect(engine.listPresets()).toEqual([PRESET_ID]);
    expect(engine.renderScene(engineSpec()).ir.style.preset).toBe(PRESET_ID);
  });

  it("lists the registered presets and answers for unknown ids", () => {
    const engine = testEngine();
    expect(engine.listPresets()).toEqual([PRESET_ID]);
    expect(engine.hasPreset(PRESET_ID)).toBe(true);
    expect(engine.hasPreset("pastoral-v1")).toBe(false);
    expect(() =>
      engine.renderScene(
        engineSpec({
          meta: { ...engineSpec().meta, stylePreset: "unknown-v1" },
        }),
      ),
    ).toThrow(/unknown style preset 'unknown-v1'/);
  });

  it("rejects two presets with one id and an empty registry", () => {
    const style = validStyleSpec();
    expect(
      () =>
        new HatchEngine({
          styles: [
            { id: PRESET_ID, style },
            { id: PRESET_ID, style },
          ],
          objects: stubObjects(),
          renderer: stubRenderer(),
          zoneFamilies: ZONE_FAMILIES,
        }),
    ).toThrow(/two presets share the id/);
    expect(
      () =>
        new HatchEngine({
          styles: [],
          objects: stubObjects(),
          renderer: stubRenderer(),
          zoneFamilies: ZONE_FAMILIES,
        }),
    ).toThrow(/at least one style preset/);
    expect(
      () =>
        new HatchEngine({
          styles: "pastoral" as unknown as HatchEngineOptions["styles"],
          objects: stubObjects(),
          renderer: stubRenderer(),
          zoneFamilies: ZONE_FAMILIES,
        }),
    ).toThrow(/preset source or an array of named presets/);
  });

  it("merges the style overrides of the spec over the preset", () => {
    const engine = testEngine();
    const result = engine.renderScene(
      engineSpec({
        styleOverrides: {
          hatchFamilies: {
            ...validStyleSpec().hatchFamilies,
            sky: { ...validStyleSpec().hatchFamilies.sky, spacing: 11 },
          },
        },
      }),
    );
    expect(result.ir.style.hatchFamilies.sky.spacing).toBe(11);
    // The preset constant stays untouched for the next render.
    expect(engine.renderScene(engineSpec()).ir.style.hatchFamilies.sky.spacing).toBe(
      validStyleSpec().hatchFamilies.sky.spacing,
    );
  });

  it("rejects invalid style overrides before any stage runs", () => {
    const engine = testEngine();
    // The scene schema holds the overrides, so it names the failure first.
    expect(() =>
      engine.renderScene(
        engineSpec({
          styleOverrides: { hatchFamilies: "blue" } as unknown as StyleOverrides,
        }),
      ),
    ).toThrow(/invalid SceneSpec: styleOverrides/);
  });
});

describe("validation of the scene", () => {
  it("names a style zone role no family is registered for", () => {
    const engine = testEngine(undefined, undefined, {
      zoneFamilies: { sky: "sky", ground: "field" },
    });
    expect(() => engine.renderScene(engineSpec())).toThrow(
      /no hatch family is registered for the style zone role "foliage"; known roles: ground, sky/,
    );
  });

  it("carries the object errors of the geometry source", () => {
    const engine = new HatchEngine({
      styles: [{ id: PRESET_ID, style: validStyleSpec() }],
      objects: {
        generateObject: () => {
          throw new Error('unknown object kind "lighthouse"');
        },
      },
      renderer: stubRenderer(),
      zoneFamilies: ZONE_FAMILIES,
    });
    expect(() => engine.renderScene(engineSpec())).toThrow(
      /unknown object kind "lighthouse"/,
    );
  });

  it("carries the cloud count errors of the planner", () => {
    const engine = testEngine();
    expect(() =>
      engine.renderScene(
        engineSpec({
          environment: { type: "rural", sky: { cloudCount: -2 } },
        }),
      ),
    ).toThrow(/environment\.sky\.cloudCount must be an integer/);
  });

  it("places the cloud cutouts of the sky in the masks of the IR", () => {
    const engine = testEngine();
    const result = engine.renderScene(
      engineSpec({
        environment: { type: "rural", sky: { cloudCount: 2 } },
      }),
    );
    expect(result.ir.masks.map((mask) => mask.id)).toEqual([
      "cloud-1",
      "cloud-2",
    ]);
    for (const mask of result.ir.masks) {
      expect(mask.invert).toBe(true);
    }
    expect(result.trace.events[1]!.data).toMatchObject({ cloudCount: 2 });
  });

  it("renders a scene without objects as the two scene regions", () => {
    // A scene that carries no object cannot name one as a focal point, so
    // the composition block drops the reference the fixture holds.
    const result = testEngine().renderScene(
      engineSpec({
        objects: [],
        composition: { ...validSceneSpec().composition, focalPoints: [] },
      }),
    );
    expect(result.ir.regions.map((region) => region.id)).toEqual([
      "sky",
      "ground",
    ]);
    expect(result.ir.contours).toEqual([]);
    expect(result.trace.metrics?.regionCount).toBe(2);
  });

  it("scales the canvas with the aspect ratio of the spec", () => {
    const result = testEngine().renderScene(
      engineSpec({ meta: { ...engineSpec().meta, aspectRatio: "16:9" } }),
    );
    expect(result.ir.canvas).toEqual({ width: 1024, height: 576 });
    expect(result.trace.events[1]!.data).toMatchObject({
      canvasWidth: 1024,
      canvasHeight: 576,
    });
  });
});

describe("the edit entry of specification section 21", () => {
  /** What one stub edit run received: the spec, the operations, the context. */
  interface EditCall {
    spec: SceneSpec;
    operations: readonly unknown[];
    resolvedPreset: string;
  }

  /** One edit source that records its call and swaps one object kind. */
  function stubEdits(calls: EditCall[]): HatchEngineOptions["edits"] {
    return {
      applyEdits: (spec, operations, context) => {
        calls.push({
          spec,
          operations,
          resolvedPreset: context.resolveStyle(spec.meta.stylePreset).preset,
        });
        return {
          ...spec,
          objects: spec.objects.map((object) =>
            object.id === "tree-1"
              ? { ...object, kind: "quarter-pipe" }
              : object,
          ),
        };
      },
    };
  }

  it("hands the parsed spec and the operations to the edit source", () => {
    const calls: EditCall[] = [];
    const engine = testEngine([], [], { edits: stubEdits(calls) });
    const operations = [{ op: "replaceObject", id: "tree-1", with: { kind: "quarter-pipe" } }];
    const updated = engine.editScene(engineSpec(), operations);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec.meta.id).toBe("scene-0001");
    expect(calls[0]!.operations).toBe(operations);
    // The context the engine passes resolves the engine's own registry.
    expect(calls[0]!.resolvedPreset).toBe(PRESET_ID);
    expect(updated.objects[0]!.kind).toBe("quarter-pipe");
  });

  it("parses the input before any operation runs", () => {
    const calls: EditCall[] = [];
    const engine = testEngine([], [], { edits: stubEdits(calls) });
    expect(() => engine.editScene({ nope: true }, [])).toThrow(
      /invalid SceneSpec/,
    );
    expect(calls).toHaveLength(0);
  });

  it("parses the patched spec before it returns", () => {
    const engine = testEngine([], [], {
      edits: {
        applyEdits: (spec) => ({ ...spec, objects: [{ ...spec.objects[0]!, scale: -1 }] }),
      },
    });
    expect(() => engine.editScene(engineSpec(), [])).toThrow(
      /invalid SceneSpec: .*scale/,
    );
  });

  it("throws a wiring error when the engine carries no edit source", () => {
    expect(() => testEngine().editScene(engineSpec(), [])).toThrow(
      /accepts no scene edits/,
    );
  });
});

describe("the debug block of specification sections 5 and 9", () => {
  it("reaches the renderer inside the intermediate representation", () => {
    const rendered: { ir: RenderIR; rng: SeededRng }[] = [];
    const engine = testEngine([], rendered);
    engine.renderScene(
      engineSpec({ debug: { showRegions: true, showAnchors: true } }),
    );
    expect(rendered[0]!.ir.debug).toEqual({
      showRegions: true,
      showAnchors: true,
    });
  });

  it("leaves the block out of the intermediate representation when absent", () => {
    const rendered: { ir: RenderIR; rng: SeededRng }[] = [];
    testEngine([], rendered).renderScene(engineSpec());
    expect(rendered[0]!.ir.debug).toBeUndefined();
  });

  it("carries the anchors and the horizon the planner computed", () => {
    const result = testEngine().renderScene(engineSpec());
    expect(result.ir.anchors).toEqual([
      {
        objectId: "tree-1",
        kind: "tree",
        role: "midground",
        position: { x: 512, y: 537.6 },
        // The anchor sizes itself the way the object drew: the spec scale
        // under the wide framing (0.85) and the focal emphasis (1.25).
        scale: 1.0625,
        depth: 1,
        depthIndex: 0,
        positionClamped: false,
      },
    ]);
    expect(result.ir.horizonY).toBe(0.68 * 768);
    expect(result.ir.horizonTilt).toBeUndefined();
  });

  it("keeps one render identity whatever overlays the spec switches on", () => {
    // The overlays must not move a stroke of the artwork, so the four inputs
    // of section 10 ignore the debug block entirely.
    const plain = engineSpec();
    const withOverlays = engineSpec({
      debug: { showRegions: true, showContourOnly: true },
    });
    expect(renderIdentityOf(withOverlays)).toEqual(renderIdentityOf(plain));
    expect(sceneSpecHash(withOverlays)).toBe(sceneSpecHash(plain));
  });

  it("names the enabled overlays in the intent event", () => {
    const result = testEngine().renderScene(
      engineSpec({ debug: { showAnchors: true, showRegions: true } }),
    );
    expect(result.trace.events[0]!.data).toMatchObject({
      debugOverlays: ["showRegions", "showAnchors"],
    });
    expect(result.trace.events[0]!.data).toMatchObject({
      specHash: result.trace.specHash,
    });
  });

  it("lists no overlay for a spec that carries no debug block", () => {
    const result = testEngine().renderScene(engineSpec());
    expect(result.trace.events[0]!.data).toMatchObject({
      debugOverlays: [],
    });
  });
});

/**
 * One engine whose preset declares the family it draws, the way every
 * preset of @hatch/styles does. The fixture preset of the tests above
 * states none, which is the second documented case: a preset without a
 * family draws every environment.
 */
function familyEngine(
  presets: { id: string; family?: EnvironmentType }[] = [
    { id: PRESET_ID, family: "rural" },
  ],
): HatchEngine {
  return testEngine([], [], {
    styles: presets.map((preset) => ({
      id: preset.id,
      style:
        preset.family === undefined
          ? validStyleSpec()
          : { ...validStyleSpec(), environmentType: preset.family },
    })),
    zoneFamilies: ZONE_FAMILIES,
  });
}

describe("acceptance: the intent stage checks the environment family", () => {
  it("renders a spec whose type names the family of its preset", () => {
    const result = familyEngine().renderScene(engineSpec());
    expect(result.svg).toBe('<svg data-regions="4"></svg>');
  });

  it("rejects a spec whose type names another family", () => {
    // Two specs that differ in nothing but environment.type: one renders,
    // the other fails in the intent stage, before any stage runs.
    expect(() =>
      familyEngine().renderScene(engineSpec({ environment: { type: "coastal" } })),
    ).toThrow(
      'environment.type "coastal" does not match the style preset ' +
        `"${PRESET_ID}", which draws "rural" environments; ` +
        'no registered preset draws "coastal" environments yet. ' +
        'Set environment.type to "rural" to render this scene under ' +
        `"${PRESET_ID}", or to "custom" to keep the preset.`,
    );
  });

  it("names the registered presets that draw the asked family", () => {
    const engine = familyEngine([
      { id: PRESET_ID, family: "rural" },
      { id: "coastal-fixture", family: "coastal" },
    ]);
    expect(() =>
      engine.renderScene(engineSpec({ environment: { type: "coastal" } })),
    ).toThrow(/the presets that draw "coastal" are: coastal-fixture/);
  });

  it("reports a family no registered preset draws yet", () => {
    expect(() =>
      familyEngine().renderScene(engineSpec({ environment: { type: "interior" } })),
    ).toThrow(/no registered preset draws "interior" environments yet/);
  });

  it("renders the custom pairing and the preset without a family", () => {
    // custom names no family, so it pairs with every preset.
    expect(familyEngine().renderScene(engineSpec({ environment: { type: "custom" } })).svg)
      .toBe('<svg data-regions="4"></svg>');
    // A preset that states no family draws every environment.
    const free = familyEngine([{ id: PRESET_ID }]);
    expect(free.renderScene(engineSpec({ environment: { type: "urban" } })).svg)
      .toBe('<svg data-regions="4"></svg>');
  });

  it("records the pair in the intent event", () => {
    const result = familyEngine().renderScene(engineSpec());
    expect(result.trace.events[0]!.data).toMatchObject({
      environmentType: "rural",
      presetEnvironmentType: "rural",
    });
    const custom = familyEngine().renderScene(
      engineSpec({ environment: { type: "custom" } }),
    );
    expect(custom.trace.events[0]!.data).toMatchObject({
      environmentType: "custom",
      presetEnvironmentType: "rural",
    });
    // A preset that states no family says so in the trace.
    const free = familyEngine([{ id: PRESET_ID }]).renderScene(engineSpec());
    expect(free.trace.events[0]!.data).toMatchObject({
      presetEnvironmentType: "undeclared",
    });
  });

  it("answers the family of a registered preset", () => {
    const engine = familyEngine([
      { id: PRESET_ID, family: "rural" },
      { id: "coastal-fixture", family: "coastal" },
    ]);
    expect(engine.presetEnvironmentType(PRESET_ID)).toBe("rural");
    expect(engine.presetEnvironmentType("coastal-fixture")).toBe("coastal");
    expect(() => engine.presetEnvironmentType("no-such-preset")).toThrow(
      /unknown style preset/,
    );
  });
});
