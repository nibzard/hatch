/**
 * End-to-end tests for the scene edit operations (task T023,
 * specification sections 15 and 21).
 *
 * `createV1Engine` wires the edit operations of `@hatch/agent` into the
 * engine, so `engine.editScene` works over the real collaborators: the
 * presets of `@hatch/styles`, the object generators of `@hatch/objects`,
 * the geometry tools of `@hatch/geometry`, and this package's renderer.
 *
 * The first block applies the three operations specification section 21
 * shows, over a real scene, and renders each result as a real SVG
 * document. The second block is the property-based acceptance: seeded
 * random operations over seeded random scenes, every one applied and
 * rendered through the whole compiler.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  createRng,
  type JsonValue,
  type SceneObject,
  type SceneSpec,
  type SeededRng,
} from "@hatch/core";
import { environmentTypeOfPreset, getStylePreset } from "@hatch/styles";

import { createV1Engine } from "../src/index.js";

import { assertWellFormedXml } from "./xml-check.js";

/**
 * The cottage scene of the edit example: one tree, one house, one hill,
 * under the pastoral preset.
 */
function cottageSpec(): SceneSpec {
  return {
    meta: {
      id: "scene-edit-cottage",
      seed: 42,
      stylePreset: "pastoral-v1",
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
      },
      {
        id: "house-1",
        kind: "house",
        role: "midground",
        position: { x: 0.22, y: 0.72 },
        scale: 1.1,
        params: { width: 240, wallHeight: 180, roofPitch: 0.6 },
      },
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.8, y: 0.7 },
        scale: 1.6,
        params: { width: 500, height: 120 },
      },
    ],
  } as SceneSpec;
}

/** One object of a spec by id, or one readable test error. */
function objectOf(spec: SceneSpec, id: string): SceneObject {
  const object = spec.objects.find((entry) => entry.id === id);
  if (object === undefined) {
    throw new Error(`test expected an object "${id}"`);
  }
  return object;
}

/** Assert one render result is a real SVG document with a full trace. */
function assertRenderedSvg(svg: string): void {
  expect(svg.startsWith("<?xml")).toBe(true);
  expect(svg).toContain("<svg");
  assertWellFormedXml(svg);
}

describe("acceptance: the edit API of specification section 21", () => {
  const engine = createV1Engine();

  it("moves an object, and the updated spec re-renders", () => {
    const before = cottageSpec();
    const updated = engine.editScene(before, [
      { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
    ]);
    expect(objectOf(updated, "tree-1").position.x).toBeCloseTo(0.45, 10);
    // The edit patched the spec, never the pixels: the input stands.
    expect(objectOf(before, "tree-1").position).toEqual({ x: 0.55, y: 0.6 });

    const rendered = engine.renderScene(updated);
    assertRenderedSvg(rendered.svg);
    // The moved spec is a different render identity than the original.
    expect(rendered.svg).not.toBe(engine.renderScene(before).svg);
  });

  it("sets a style value, and every other preset value survives", () => {
    const updated = engine.editScene(cottageSpec(), [
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
    ]);
    const preset = getStylePreset("pastoral-v1");
    const rendered = engine.renderScene(updated);
    expect(rendered.ir.style.hatchFamilies.sky.spacing).toBe(8);
    expect(rendered.ir.style.hatchFamilies.sky.angle).toBe(
      preset.hatchFamilies.sky.angle,
    );
    expect(rendered.ir.style.hatchFamilies.field).toEqual(preset.hatchFamilies.field);
    expect(rendered.ir.style.palette).toEqual(preset.palette);
    assertRenderedSvg(rendered.svg);
  });

  it("replaces an object with another kind and keeps its placement", () => {
    const before = cottageSpec();
    const updated = engine.editScene(before, [
      { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
    ]);
    const replacement = objectOf(updated, "house-1");
    expect(replacement.kind).toBe("quarter-pipe");
    expect(replacement.position).toEqual(objectOf(before, "house-1").position);

    const rendered = engine.renderScene(updated);
    assertRenderedSvg(rendered.svg);
    // The quarter pipe emitted its concrete zone, not the house's.
    expect(rendered.trace.events).toHaveLength(5);
  });

  it("adds an object and removes one, and both results re-render", () => {
    const withBench = engine.editScene(cottageSpec(), [
      {
        op: "addObject",
        object: {
          id: "bench-1",
          kind: "bench",
          role: "foreground",
          position: { x: 0.4, y: 0.9 },
          scale: 1,
        },
      },
    ]);
    expect(withBench.objects).toHaveLength(4);
    assertRenderedSvg(engine.renderScene(withBench).svg);

    const withoutTree = engine.editScene(withBench, [
      { op: "removeObject", id: "tree-1" },
    ]);
    expect(withoutTree.objects.map((object) => object.id)).toEqual([
      "house-1",
      "hill-1",
      "bench-1",
    ]);
    expect(withoutTree.composition.focalPoints).toEqual([]);
    assertRenderedSvg(engine.renderScene(withoutTree).svg);
  });

  it("applies the operation list of specification section 21 as one edit", () => {
    const updated = engine.editScene(cottageSpec(), [
      { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
      { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
      { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
    ]);
    expect(objectOf(updated, "tree-1").position.x).toBeCloseTo(0.45, 10);
    expect(updated.styleOverrides?.hatchFamilies?.sky?.spacing).toBe(8);
    expect(objectOf(updated, "house-1").kind).toBe("quarter-pipe");

    const first = engine.renderScene(updated);
    assertRenderedSvg(first.svg);
    // The re-render of one edited spec is byte-identical (section 10).
    expect(engine.renderScene(updated).svg).toBe(first.svg);
  });
});

/**
 * The property-based acceptance: seeded random operations over seeded
 * random scenes, applied through the engine and rendered through the real
 * compiler.
 *
 * The generator draws from the deterministic RNG of @hatch/core, so a
 * failure repeats byte for byte. Each iteration checks the invariant its
 * operation promises and that the edited spec renders as well-formed SVG.
 * One render over the real geometry and hatch engine costs a few hundred
 * milliseconds, so every test states its timeout and each suite renders
 * once per iteration; the byte identity of a re-render is asserted on the
 * last iteration and in the fixed-scene block above.
 */
describe("property: each operation renders over the real compiler", () => {
  const engine = createV1Engine();
  const rng = createRng("hatch-renderer-edit-properties-v1");
  const ITERATIONS = 16;
  /** One render over the real compiler costs a few hundred milliseconds. */
  const TEST_TIMEOUT_MS = 120_000;

  /** Every kind the round 2 library ships. */
  const KINDS = [
    "tree",
    "house",
    "hill",
    "mountain",
    "water",
    "bowl",
    "quarter-pipe",
    "handrail",
    "skater",
    "fence",
    "bench",
    "tram",
    "building-block",
    "streetlight",
    "car",
    "road",
    "lamp-post",
  ];

  /** The style paths the generator writes, each with its value range. */
  const STYLE_PATHS: { path: string; draw: (stream: SeededRng) => JsonValue }[] = [
    { path: "hatchFamilies.sky.spacing", draw: (s) => s.int(2, 12) },
    { path: "hatchFamilies.sky.angle", draw: (s) => s.int(0, 89) },
    { path: "hatchFamilies.field.spacing", draw: (s) => s.int(2, 12) },
    { path: "hatchFamilies.foliage.spacingB", draw: (s) => s.int(2, 12) },
    { path: "contours.weight", draw: (s) => s.float(0.5, 2) },
    { path: "texture.lineJitter", draw: (s) => s.float(0, 1) },
    { path: "palette.paper", draw: (s) => s.pick(["#ffffff", "#f6f1e7"]) },
    {
      path: "compositionGrammar.preferredHorizonBand",
      draw: (s) => {
        const low = s.float(0.1, 0.5);
        return [Number(low.toFixed(3)), Number((low + s.float(0.1, 0.3)).toFixed(3))];
      },
    },
  ];

  /** One seeded random scene under one seeded random preset. */
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
    // The preset comes first because the environment follows it: the
    // intent stage checks the family of the one against the type of the
    // other, so a random scene names the family its preset draws.
    const preset = stream.pick([
      "pastoral-v1",
      "coastal-v1",
      "urban-v1",
      "skatepark-v1",
    ]);
    return {
      meta: {
        id: "scene-edit-property",
        seed: stream.int(1, 999999),
        stylePreset: preset,
        aspectRatio: stream.pick(["4:3", "16:9"]),
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
      environment: { type: environmentTypeOfPreset(preset) ?? "custom" },
      objects,
    } as SceneSpec;
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

  /** One edited spec renders well-formed SVG, once. */
  function assertRenders(updated: SceneSpec, note: string): void {
    const rendered = engine.renderScene(updated);
    assertWellFormedXml(rendered.svg);
    expect(rendered.svg.startsWith("<?xml"), note).toBe(true);
  }

  /** Like {@link assertRenders}, and the bytes repeat on a second render. */
  function assertRendersIdentically(updated: SceneSpec, note: string): void {
    const first = engine.renderScene(updated);
    assertWellFormedXml(first.svg);
    expect(first.svg.startsWith("<?xml"), note).toBe(true);
    expect(engine.renderScene(updated).svg, note).toBe(first.svg);
  }

  it(
    "moveObject: a random move re-renders and moves only its target",
    () => {
      for (let index = 0; index < ITERATIONS; index += 1) {
        const spec = randomSpec(rng);
        const target = rng.pick(spec.objects);
        const dx = rng.float(-0.2, 0.2);
        const dy = rng.float(-0.2, 0.2);
        const updated = engine.editScene(spec, [{ op: "moveObject", id: target.id, dx, dy }]);
        expect(objectOf(updated, target.id).position.x).toBeCloseTo(
          target.position.x + dx,
          10,
        );
        const others = updated.objects.filter((object) => object.id !== target.id);
        expect(others).toEqual(spec.objects.filter((object) => object.id !== target.id));
        assertRenders(updated, `move iteration ${index}`);
      }
      assertRendersIdentically(randomSpec(rng), "move byte identity");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "setStyle: a random value lands in the resolved style and re-renders",
    () => {
      for (let index = 0; index < ITERATIONS; index += 1) {
        const spec = randomSpec(rng);
        const choice = rng.pick(STYLE_PATHS);
        const value = choice.draw(rng);
        const updated = engine.editScene(spec, [
          { op: "setStyle", path: choice.path, value },
        ]);
        const rendered = engine.renderScene(updated);
        expect(readPath(rendered.ir.style, choice.path)).toEqual(value);
        assertRenders(updated, `style iteration ${index}`);
      }
      assertRendersIdentically(randomSpec(rng), "style byte identity");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "replaceObject: a random kind swap keeps the placement and re-renders",
    () => {
      for (let index = 0; index < ITERATIONS; index += 1) {
        const spec = randomSpec(rng);
        const target = rng.pick(spec.objects);
        const kind = rng.pick(KINDS);
        const updated = engine.editScene(spec, [
          { op: "replaceObject", id: target.id, with: { kind } },
        ]);
        const replacement = objectOf(updated, target.id);
        expect(replacement.kind).toBe(kind);
        expect(replacement.position).toEqual(target.position);
        expect(updated.objects).toHaveLength(spec.objects.length);
        assertRenders(updated, `replace iteration ${index}`);
      }
      assertRendersIdentically(randomSpec(rng), "replace byte identity");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "addObject: a random object joins the scene and re-renders",
    () => {
      for (let index = 0; index < ITERATIONS; index += 1) {
        const spec = randomSpec(rng);
        const added: SceneObject = {
          id: `added-${index}`,
          kind: rng.pick(KINDS),
          position: { x: rng.float(0.05, 0.95), y: rng.float(0.05, 0.95) },
          scale: rng.float(0.5, 2),
        };
        const updated = engine.editScene(spec, [{ op: "addObject", object: added }]);
        expect(updated.objects).toHaveLength(spec.objects.length + 1);
        expect(objectOf(updated, added.id).kind).toBe(added.kind);
        assertRenders(updated, `add iteration ${index}`);
      }
      assertRendersIdentically(randomSpec(rng), "add byte identity");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removeObject: a random drop leaves the scene and re-renders",
    () => {
      for (let index = 0; index < ITERATIONS; index += 1) {
        const spec = randomSpec(rng);
        const target = rng.pick(spec.objects);
        const updated = engine.editScene(spec, [{ op: "removeObject", id: target.id }]);
        expect(updated.objects).toHaveLength(spec.objects.length - 1);
        expect(updated.composition.focalPoints).not.toContain(target.id);
        assertRenders(updated, `remove iteration ${index}`);
      }
      assertRendersIdentically(randomSpec(rng), "remove byte identity");
    },
    TEST_TIMEOUT_MS,
  );

  it("every operation leaves the input spec untouched", () => {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const spec = randomSpec(rng);
      const snapshot = canonicalJson(spec);
      const target = rng.pick(spec.objects);
      engine.editScene(spec, [
        { op: "moveObject", id: target.id, dx: 0.15, dy: -0.05 },
        { op: "setStyle", path: "contours.weight", value: 1.75 },
        { op: "replaceObject", id: target.id, with: { kind: rng.pick(KINDS) } },
        {
          op: "addObject",
          object: {
            id: `added-${index}`,
            kind: rng.pick(KINDS),
            position: { x: 0.5, y: 0.5 },
            scale: 1,
          },
        },
      ]);
      expect(canonicalJson(spec), `purity iteration ${index}`).toBe(snapshot);
    }
  });
});
