/**
 * Tests for the scene edit operations (task T023, specification sections
 * 15 and 21).
 *
 * The unit tests pin the semantics of each operation: what it writes, what
 * it keeps, and the readable error it throws when an edit cannot apply.
 * The property tests apply every operation to seeded random scenes through
 * a real `HatchEngine` and render the result, which is the acceptance of
 * the task: each operation returns an updated spec that re-renders.
 *
 * The engine here runs on stub collaborators, the same pattern as the
 * @hatch/core engine tests: one square generator, one renderer that
 * reports a stroke count. That keeps this package free of a dependency on
 * the packages it does not own. The end-to-end edit tests over the real
 * collaborators live in @hatch/renderer-svg (test/edit-operations.test.ts).
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  createRng,
  formatIssues,
  HatchEngine,
  parseSceneSpec,
  ResolvedStyleSpecSchema,
  type Geometry,
  type HatchEngineOptions,
  type JsonValue,
  type Point,
  type RenderIR,
  type SceneEditContext,
  type SceneObject,
  type SceneSpec,
  type SeededRng,
  type StyleOverrides,
  type StyleSpec,
} from "@hatch/core";

import {
  applySceneEdit,
  applySceneEdits,
  parseSceneEditOperation,
  sceneEditSource,
  type ObjectPatch,
} from "../src/index.js";

/** The preset id the test engine registers. */
const PRESET_ID = "test-pastoral";

/** The ink of the fixture style. */
const INK = "#2f2a26";

/** One complete preset shaped like pastoral-v1 (specification section 8). */
function testStyleSpec(): StyleSpec {
  return {
    palette: {
      paper: "#f7f3e8",
      sky: "#a8c4d4",
      grass: "#7a9b5e",
      architecture: "#d8cfc0",
      water: "#9db8cc",
      accent: INK,
      mountain: "#8a8f98",
      trunk: "#6b4f3a",
    },
    hatchFamilies: {
      sky: { angle: 20, spacing: 6, stroke: INK, weight: 0.6, jitter: 0.4 },
      field: { angle: 5, spacing: 5, stroke: INK, weight: 0.5, jitter: 0.6 },
      foliage: {
        angleA: 45,
        angleB: 135,
        spacingA: 4,
        spacingB: 6,
        stroke: INK,
        weight: 0.5,
        jitter: 1.2,
      },
      mountain: { angle: 60, spacing: 5, stroke: INK, weight: 0.6, jitter: 0.5 },
      water: {
        angleA: 10,
        angleB: 100,
        spacingA: 5,
        spacingB: 7,
        stroke: INK,
        weight: 0.5,
        jitter: 0.3,
      },
      cliff: { angle: 80, spacing: 4, stroke: INK, weight: 0.7, jitter: 0.4 },
    },
    contours: { weight: 1.2, color: INK, wobble: 0.35, simplifyTolerance: 0.5 },
    objectGrammar: {
      abstractionLevel: 0.6,
      maxDetailPerObject: 12,
      edgeRoundnessBias: 0.5,
      keepNegativeSpace: true,
    },
    compositionGrammar: {
      minEmptyAreaRatio: 0.3,
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

/** The stub object: one square silhouette on the anchor, one style zone. */
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
    internalBoundaries: [],
    styleZones: [
      { role: "foliage", path: { commands: [{ command: "move", to: anchor }] } },
    ],
  };
}

/** One engine over the stub collaborators and the real edit operations. */
function testEngine(overrides: Partial<HatchEngineOptions> = {}): HatchEngine {
  return new HatchEngine({
    styles: [{ id: PRESET_ID, style: testStyleSpec() }],
    objects: { generateObject: (request) => stubGeometry(request.anchor) },
    renderer: {
      render: (ir: RenderIR) => ({
        svg: `<svg data-regions="${ir.regions.length}"></svg>`,
        strokeCount: ir.regions.length * 3,
        strokeLength: ir.regions.length * 3 * 10,
      }),
    },
    zoneFamilies: { sky: "sky", ground: "field", foliage: "foliage" },
    edits: sceneEditSource,
    ...overrides,
  });
}

/**
 * One edit context that resolves the way the engine does: the preset with
 * the whole-section overrides spread over it, then one validating parse.
 */
function editContext(): SceneEditContext {
  const preset = testStyleSpec();
  return {
    resolveStyle: (presetId: string, overrides?: StyleOverrides) => {
      const merged = {
        ...structuredClone(preset),
        ...(overrides ?? {}),
        preset: presetId,
      };
      const result = ResolvedStyleSpecSchema.safeParse(merged);
      if (!result.success) {
        throw new Error(formatIssues(result.error.issues));
      }
      return result.data;
    },
  };
}

/** A two-object scene: one tree-like object in front of one house-like block. */
function baseSpec(): SceneSpec {
  return parseSceneSpec({
    meta: {
      id: "scene-edit-0001",
      seed: 42,
      stylePreset: PRESET_ID,
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "wide", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["tree-1"],
      balance: "asymmetric",
      negativeSpace: 0.35,
      depthLayers: 3,
    },
    environment: { type: "rural", sky: { cloudCount: 3 } },
    objects: [
      {
        id: "tree-1",
        kind: "tree",
        role: "midground",
        position: { x: 0.55, y: 0.6 },
        scale: 1,
        params: { canopySize: 0.8 },
        styleRole: "foliage crosshatch",
      },
      {
        id: "house-1",
        kind: "house",
        role: "background",
        position: { x: 0.2, y: 0.72 },
        scale: 1.2,
      },
    ],
  });
}

/** One object of a spec by id. */
function objectOf(spec: SceneSpec, id: string): SceneObject {
  const object = spec.objects.find((entry) => entry.id === id);
  if (object === undefined) {
    throw new Error(`test expected an object "${id}"`);
  }
  return object;
}

describe("parseSceneEditOperation", () => {
  it("parses each operation of specification section 21", () => {
    const ops = [
      { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
      { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
      {
        op: "addObject",
        object: {
          id: "bench-1",
          kind: "bench",
          position: { x: 0.5, y: 0.9 },
          scale: 1,
        },
      },
      { op: "removeObject", id: "house-1" },
    ] as const;
    for (const op of ops) {
      expect(parseSceneEditOperation(op).op).toBe(op.op);
    }
  });

  it("rejects an unknown operation and names the failing field", () => {
    expect(() => parseSceneEditOperation({ op: "recolor", id: "tree-1" })).toThrow(
      /invalid edit operation/,
    );
    expect(() =>
      parseSceneEditOperation({ op: "moveObject", id: "tree-1" }),
    ).toThrow(/dx/);
  });
});

describe("moveObject", () => {
  it("shifts the position by the delta and changes nothing else", () => {
    const before = baseSpec();
    const after = applySceneEdit(
      before,
      { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0.05 },
      editContext(),
    );
    expect(objectOf(after, "tree-1").position.x).toBeCloseTo(0.45, 10);
    expect(objectOf(after, "tree-1").position.y).toBeCloseTo(0.65, 10);
    expect(objectOf(after, "house-1")).toEqual(objectOf(before, "house-1"));
    expect(after.objects).toHaveLength(2);
    expect(after.composition).toEqual(before.composition);
  });

  it("never mutates the spec it edits", () => {
    const before = baseSpec();
    const snapshot = canonicalJson(before);
    applySceneEdit(
      before,
      { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
      editContext(),
    );
    expect(canonicalJson(before)).toBe(snapshot);
  });

  it("names the object ids when the id is unknown", () => {
    expect(() =>
      applySceneEdit(
        baseSpec(),
        { op: "moveObject", id: "tree-9", dx: 0, dy: 0 },
        editContext(),
      ),
    ).toThrow(/moveObject: no object carries the id "tree-9".*house-1/);
  });
});

describe("setStyle", () => {
  it("writes the value and keeps every other value of the preset", () => {
    const after = applySceneEdit(
      baseSpec(),
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 3 },
      editContext(),
    );
    expect(after.styleOverrides?.hatchFamilies?.sky?.spacing).toBe(3);

    const resolved = editContext().resolveStyle(
      after.meta.stylePreset,
      after.styleOverrides,
    );
    expect(resolved.hatchFamilies.sky.spacing).toBe(3);
    // The families the edit never names keep the preset values.
    expect(resolved.hatchFamilies.sky.angle).toBe(20);
    expect(resolved.hatchFamilies.field).toEqual(testStyleSpec().hatchFamilies.field);
    expect(resolved.hatchFamilies.cliff).toEqual(testStyleSpec().hatchFamilies.cliff);
    expect(resolved.palette).toEqual(testStyleSpec().palette);
    expect(resolved.contours).toEqual(testStyleSpec().contours);
  });

  it("accepts the section paths and the array fields the grammar defines", () => {
    const tuple = applySceneEdit(
      baseSpec(),
      {
        op: "setStyle",
        path: "compositionGrammar.preferredHorizonBand",
        value: [0.5, 0.8],
      },
      editContext(),
    );
    expect(tuple.styleOverrides?.compositionGrammar?.preferredHorizonBand).toEqual([
      0.5, 0.8,
    ]);

    const section = applySceneEdit(
      baseSpec(),
      {
        op: "setStyle",
        path: "palette",
        value: { ...testStyleSpec().palette, paper: "#ffffff" },
      },
      editContext(),
    );
    expect(section.styleOverrides?.palette?.paper).toBe("#ffffff");
  });

  it("composes with a second setStyle on the same section", () => {
    const once = applySceneEdit(
      baseSpec(),
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 3 },
      editContext(),
    );
    const twice = applySceneEdit(
      once,
      { op: "setStyle", path: "hatchFamilies.sky.angle", value: 40 },
      editContext(),
    );
    const resolved = editContext().resolveStyle(
      twice.meta.stylePreset,
      twice.styleOverrides,
    );
    expect(resolved.hatchFamilies.sky.spacing).toBe(3);
    expect(resolved.hatchFamilies.sky.angle).toBe(40);
    expect(resolved.hatchFamilies.sky.stroke).toBe(INK);
  });

  it("rejects a path the style grammar does not define", () => {
    const rejects = (path: string): void => {
      expect(() =>
        applySceneEdit(baseSpec(), { op: "setStyle", path, value: 1 }, editContext()),
      ).toThrow();
    };
    rejects("hatchFamilies.sky.nothing");
    rejects("preset");
    rejects("");
    rejects("hatchFamilies..sky");
  });

  it("rejects a value the grammar refuses to keep", () => {
    expect(() =>
      applySceneEdit(
        baseSpec(),
        { op: "setStyle", path: "hatchFamilies.sky.spacing", value: "dense" },
        editContext(),
      ),
    ).toThrow(/setStyle: the patched style does not resolve/);
    expect(() =>
      applySceneEdit(
        baseSpec(),
        { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 0 },
        editContext(),
      ),
    ).toThrow(/setStyle: the patched style does not resolve/);
  });
});

describe("replaceObject", () => {
  it("swaps the kind and keeps the unstated placement", () => {
    const before = baseSpec();
    const after = applySceneEdit(
      before,
      { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
      editContext(),
    );
    const replacement = objectOf(after, "house-1");
    expect(replacement.kind).toBe("quarter-pipe");
    expect(replacement.position).toEqual(objectOf(before, "house-1").position);
    expect(replacement.scale).toBe(objectOf(before, "house-1").scale);
    expect(after.objects).toHaveLength(2);
  });

  it("applies the stated fields over the kept ones", () => {
    const after = applySceneEdit(
      baseSpec(),
      {
        op: "replaceObject",
        id: "house-1",
        with: { kind: "bench", scale: 2, position: { x: 0.9, y: 0.9 } },
      },
      editContext(),
    );
    const replacement = objectOf(after, "house-1");
    expect(replacement.kind).toBe("bench");
    expect(replacement.scale).toBe(2);
    expect(replacement.position).toEqual({ x: 0.9, y: 0.9 });
  });

  it("renames the object and its focal points when the patch carries an id", () => {
    const after = applySceneEdit(
      baseSpec(),
      { op: "replaceObject", id: "tree-1", with: { kind: "tree", id: "oak-1" } },
      editContext(),
    );
    expect(after.objects.map((object) => object.id)).toEqual(["oak-1", "house-1"]);
    expect(after.composition.focalPoints).toEqual(["oak-1"]);
  });

  it("refuses an id another object already uses", () => {
    expect(() =>
      applySceneEdit(
        baseSpec(),
        { op: "replaceObject", id: "tree-1", with: { kind: "bench", id: "house-1" } },
        editContext(),
      ),
    ).toThrow(/already names another object/);
  });

  it("refuses a patch that is not a valid object", () => {
    expect(() =>
      applySceneEdit(
        baseSpec(),
        { op: "replaceObject", id: "house-1", with: { kind: "bench", scale: -1 } },
        editContext(),
      ),
    ).toThrow(/replaceObject: .*scale/);
  });
});

describe("addObject and removeObject", () => {
  it("appends one object under a fresh id", () => {
    const before = baseSpec();
    const after = applySceneEdit(
      before,
      {
        op: "addObject",
        object: {
          id: "bench-1",
          kind: "bench",
          position: { x: 0.5, y: 0.9 },
          scale: 1,
        },
      },
      editContext(),
    );
    expect(after.objects).toHaveLength(3);
    expect(after.objects.map((object) => object.id)).toContain("bench-1");
    expect(after.objects.slice(0, 2)).toEqual(before.objects);
  });

  it("refuses an id the scene already uses", () => {
    expect(() =>
      applySceneEdit(
        baseSpec(),
        {
          op: "addObject",
          object: {
            id: "tree-1",
            kind: "bench",
            position: { x: 0.5, y: 0.9 },
            scale: 1,
          },
        },
        editContext(),
      ),
    ).toThrow(/already names an object/);
  });

  it("drops the object and prunes the focal points that name it", () => {
    const after = applySceneEdit(
      baseSpec(),
      { op: "removeObject", id: "tree-1" },
      editContext(),
    );
    expect(after.objects.map((object) => object.id)).toEqual(["house-1"]);
    expect(after.composition.focalPoints).toEqual([]);
  });

  it("names the object ids when a removal finds nothing", () => {
    expect(() =>
      applySceneEdit(baseSpec(), { op: "removeObject", id: "bench-9" }, editContext()),
    ).toThrow(/removeObject: no object carries the id "bench-9"/);
  });
});

describe("applySceneEdits", () => {
  it("applies the operations of specification section 21 in order", () => {
    const updated = applySceneEdits(
      baseSpec(),
      [
        { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
        { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
        { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
      ],
      editContext(),
    );
    expect(objectOf(updated, "tree-1").position.x).toBeCloseTo(0.45);
    expect(updated.styleOverrides?.hatchFamilies?.sky?.spacing).toBe(8);
    expect(objectOf(updated, "house-1").kind).toBe("quarter-pipe");
  });

  it("parses every operation before the first one applies", () => {
    const before = baseSpec();
    expect(() =>
      applySceneEdits(
        before,
        [
          { op: "removeObject", id: "tree-1" },
          { op: "recolor", id: "tree-1" },
        ],
        editContext(),
      ),
    ).toThrow(/edit operations\[1\]/);
    // The valid first operation never ran, because nothing left the fold.
    expect(before.objects).toHaveLength(2);
  });

  it("returns a spec that parses against the scene schema", () => {
    const updated = applySceneEdits(
      baseSpec(),
      [{ op: "moveObject", id: "tree-1", dx: 0, dy: 0 }],
      editContext(),
    );
    expect(() => parseSceneSpec(updated)).not.toThrow();
  });
});

describe("HatchEngine.editScene", () => {
  const engine = testEngine();

  it("applies the operations through the engine's own preset registry", () => {
    const updated = engine.editScene(baseSpec(), [
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 3 },
    ]);
    expect(updated.styleOverrides?.hatchFamilies?.sky?.spacing).toBe(3);
    expect(engine.renderScene(updated).ir.style.hatchFamilies.sky.spacing).toBe(3);
  });

  it("fails on an invalid input spec before any operation runs", () => {
    expect(() => engine.editScene({ nope: true }, [])).toThrow(/invalid SceneSpec/);
  });

  it("fails on an operation list that does not parse", () => {
    expect(() => engine.editScene(baseSpec(), [{ op: "shrink" }])).toThrow(
      /edit operations\[0\]/,
    );
  });

  it("throws a wiring error when the engine carries no edit source", () => {
    const plain = testEngine({ edits: undefined });
    expect(() => plain.editScene(baseSpec(), [])).toThrow(/accepts no scene edits/);
  });
});

/**
 * The property tests: seeded random operations over seeded random scenes.
 *
 * The generator draws from the deterministic RNG of @hatch/core, so a
 * failure repeats byte for byte. Every iteration applies one operation of
 * one kind, checks the invariant that operation promises, and renders the
 * result through the real engine pipeline: the edit patches the spec, the
 * engine re-renders it (specification section 15).
 */
describe("property: every operation returns a spec that re-renders", () => {
  const engine = testEngine();
  const rng = createRng("hatch-agent-edit-properties-v1");
  const ITERATIONS = 40;

  /** The style paths the generator writes, each with its value range. */
  const STYLE_PATHS: { path: string; draw: (stream: SeededRng) => JsonValue }[] = [
    { path: "hatchFamilies.sky.spacing", draw: (s) => s.int(2, 12) },
    { path: "hatchFamilies.sky.angle", draw: (s) => s.int(0, 89) },
    { path: "hatchFamilies.field.jitter", draw: (s) => s.float(0, 2) },
    { path: "hatchFamilies.foliage.spacingA", draw: (s) => s.int(2, 9) },
    { path: "contours.weight", draw: (s) => s.float(0.5, 2) },
    { path: "contours.simplifyTolerance", draw: (s) => s.float(0, 1.5) },
    { path: "texture.lineJitter", draw: (s) => s.float(0, 1) },
    { path: "texture.paperNoise", draw: (s) => s.float(0, 0.2) },
    { path: "objectGrammar.abstractionLevel", draw: (s) => s.float(0, 1) },
    {
      path: "palette.paper",
      draw: (s) => s.pick(["#ffffff", "#f6f1e7", "#f7f3e8"]),
    },
    {
      path: "compositionGrammar.preferredHorizonBand",
      draw: (s) => {
        const low = s.float(0.1, 0.5);
        return [Number(low.toFixed(3)), Number((low + s.float(0.1, 0.3)).toFixed(3))];
      },
    },
  ];

  /** The kinds the stub generator places, plus the round 2 vocabulary. */
  const KINDS = ["tree", "house", "bench", "quarter-pipe", "tram", "bowl"];

  /** One seeded random scene: one to four objects under fresh ids. */
  function randomSpec(stream: SeededRng): SceneSpec {
    const count = stream.int(1, 4);
    const objects: SceneObject[] = [];
    for (let index = 0; index < count; index += 1) {
      objects.push({
        id: `obj-${index}`,
        kind: stream.pick(KINDS),
        position: { x: stream.float(0.05, 0.95), y: stream.float(0.05, 0.95) },
        scale: stream.float(0.5, 2),
      });
    }
    return parseSceneSpec({
      meta: {
        id: "scene-property",
        seed: stream.int(1, 999999),
        stylePreset: PRESET_ID,
        aspectRatio: "4:3",
        version: "1.0.0",
      },
      camera: {
        framing: stream.pick(["wide", "medium", "close"] as const),
        lens: stream.pick(["normal", "wide", "ultra-wide"] as const),
        horizonY: stream.float(0.5, 0.8),
      },
      composition: {
        focalPoints: [objects[0]!.id],
        balance: stream.pick(["left", "center", "right", "asymmetric"] as const),
        negativeSpace: stream.float(0, 0.6),
        depthLayers: stream.int(1, 4),
      },
      environment: { type: "rural" },
      objects,
    });
  }

  /** Read one dotted path off a JSON tree, for the assertions. */
  function readPath(value: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((node, key) => {
      if (node === null || typeof node !== "object") {
        throw new Error(`test path "${path}" left the tree`);
      }
      return (node as Record<string, unknown>)[key];
    }, value);
  }

  /** The stages every render trace records, in order. */
  const STAGE_ORDER = ["intent", "planning", "geometry", "style", "render"];

  /** One render of the edited spec must succeed and hold a full trace. */
  function assertRenders(updated: SceneSpec, note: string): void {
    const rendered = engine.renderScene(updated);
    expect(rendered.svg, note).toMatch(/^<svg/);
    expect(rendered.trace.events.map((event) => event.stage), note).toEqual(
      STAGE_ORDER,
    );
    // The same edited spec renders the same bytes again (section 10).
    expect(engine.renderScene(updated).svg, note).toBe(rendered.svg);
  }

  it("applies a random moveObject and renders the result", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const target = rng.pick(spec.objects);
      const dx = rng.float(-0.3, 0.3);
      const dy = rng.float(-0.3, 0.3);
      const updated = engine.editScene(spec, [
        { op: "moveObject", id: target.id, dx, dy },
      ]);
      const moved = objectOf(updated, target.id);
      expect(moved.position.x).toBeCloseTo(target.position.x + dx, 10);
      expect(moved.position.y).toBeCloseTo(target.position.y + dy, 10);
      expect(updated.objects).toHaveLength(spec.objects.length);
      assertRenders(updated, `move iteration ${index}`);
    }
  });

  it("applies a random setStyle and renders the result", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const choice = rng.pick(STYLE_PATHS);
      const value = choice.draw(rng);
      const updated = engine.editScene(spec, [
        { op: "setStyle", path: choice.path, value },
      ]);
      const resolved = engine.renderScene(updated).ir.style;
      expect(readPath(resolved, choice.path)).toEqual(value);
      assertRenders(updated, `style iteration ${index}`);
    }
  });

  it("applies a random replaceObject and renders the result", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const target = rng.pick(spec.objects);
      const patch: ObjectPatch = { kind: rng.pick(KINDS) };
      if (rng.chance(0.5)) {
        patch.scale = rng.float(0.5, 2);
      }
      if (rng.chance(0.5)) {
        patch.position = { x: rng.float(0.05, 0.95), y: rng.float(0.05, 0.95) };
      }
      const updated = engine.editScene(spec, [
        { op: "replaceObject", id: target.id, with: patch },
      ]);
      const replacement = objectOf(updated, target.id);
      expect(replacement.kind).toBe(patch.kind);
      expect(replacement.scale).toBe(patch.scale ?? target.scale);
      expect(updated.objects).toHaveLength(spec.objects.length);
      assertRenders(updated, `replace iteration ${index}`);
    }
  });

  it("applies a random addObject and renders the result", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const added: SceneObject = {
        id: `added-${index}`,
        kind: rng.pick(KINDS),
        position: { x: rng.float(0.05, 0.95), y: rng.float(0.05, 0.95) },
        scale: rng.float(0.5, 2),
      };
      const updated = engine.editScene(spec, [{ op: "addObject", object: added }]);
      expect(updated.objects.map((object) => object.id)).toContain(added.id);
      expect(updated.objects).toHaveLength(spec.objects.length + 1);
      assertRenders(updated, `add iteration ${index}`);
    }
  });

  it("applies a random removeObject and renders the result", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const target = rng.pick(spec.objects);
      const updated = engine.editScene(spec, [{ op: "removeObject", id: target.id }]);
      expect(updated.objects.map((object) => object.id)).not.toContain(target.id);
      expect(updated.objects).toHaveLength(spec.objects.length - 1);
      expect(updated.composition.focalPoints).not.toContain(target.id);
      assertRenders(updated, `remove iteration ${index}`);
    }
  });

  it("leaves the input spec untouched in every iteration", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const snapshot = canonicalJson(spec);
      engine.editScene(spec, [
        { op: "moveObject", id: spec.objects[0]!.id, dx: 0.2, dy: 0.1 },
        { op: "setStyle", path: "contours.weight", value: 2 },
      ]);
      expect(canonicalJson(spec)).toBe(snapshot);
    }
  });
});
