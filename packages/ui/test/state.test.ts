/**
 * The unit suite of the editor model (task T026).
 *
 * The page panels only dispatch actions; every rule that turns an action
 * into a spec lives in the state model, so this suite covers the model
 * with the real V1 engine and needs no browser:
 *
 * - every edit operation of specification section 21 reaches the spec
 *   through `engine.editScene`;
 * - the controls with no section 21 operation patch their spec block;
 * - a rejected write keeps the spec untouched and names the reason;
 * - the starter scenes of the page parse and render.
 */

import { describe, expect, it } from "vitest";

import { parseSceneSpec, type SceneSpec } from "@hatch/core";
import { createV1Engine } from "@hatch/renderer-svg";

import {
  createEditorReducer,
  editorStateOf,
  importSpec,
  type EditorState,
} from "../src/editor/state.js";
import { STARTER_SCENES } from "../src/editor/starters.js";
import { packageName, packageRole } from "../src/index.js";

/** The engine the editor binds. */
const engine = createV1Engine();

/** The reducer under test. */
const reduce = createEditorReducer(engine);

/** One scene small enough to read, with two objects to edit. */
function baseSpec(): SceneSpec {
  return parseSceneSpec({
    meta: {
      id: "editor-test",
      seed: 7,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "wide", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "center",
      negativeSpace: 0.35,
      depthLayers: 2,
    },
    environment: { type: "rural", sky: { cloudCount: 1 } },
    objects: [
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.5, y: 0.85 },
        scale: 1.5,
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "foreground",
        position: { x: 0.8, y: 0.9 },
        scale: 2,
      },
    ],
  });
}

/** One fresh editor state over the base scene. */
function baseState(): EditorState {
  return editorStateOf(baseSpec());
}

describe("@hatch/ui package identity", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/ui");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

describe("the starter scenes of the page", () => {
  it("parses and renders every starter", () => {
    for (const starter of STARTER_SCENES) {
      const { spec, error } = importSpec(starter.spec);
      expect(error, starter.id).toBeNull();
      expect(spec, starter.id).not.toBeNull();
      const result = engine.renderScene(spec);
      expect(result.svg, starter.id).toContain("<svg");
    }
  });
});

describe("edit operations of specification section 21", () => {
  it("moves the selected object through moveObject", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [{ op: "moveObject", id: "tree-1", dx: -0.1, dy: 0.05 }],
    });
    const tree = state.spec.objects.find((object) => object.id === "tree-1");
    // The delta lands as authored float arithmetic: 0.8 - 0.1 is
    // 0.7000000000000001, and the spec keeps the number it computed.
    expect(tree?.position.x).toBeCloseTo(0.7);
    expect(tree?.position.y).toBeCloseTo(0.95);
    expect(state.error).toBeNull();
  });

  it("writes one style value through setStyle", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 9 },
      ],
    });
    expect(state.spec.styleOverrides?.hatchFamilies?.sky).toMatchObject({
      spacing: 9,
    });
    expect(state.error).toBeNull();
  });

  it("swaps an object kind through replaceObject and keeps the placement", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        { op: "replaceObject", id: "tree-1", with: { kind: "bench" } },
      ],
    });
    const replaced = state.spec.objects.find((object) => object.id === "tree-1");
    expect(replaced).toMatchObject({
      id: "tree-1",
      kind: "bench",
      role: "foreground",
      position: { x: 0.8, y: 0.9 },
      scale: 2,
    });
  });

  it("appends one object through addObject under a fresh id", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        {
          op: "addObject",
          object: {
            id: "bench-1",
            kind: "bench",
            position: { x: 0.3, y: 0.88 },
            scale: 1,
          },
        },
      ],
    });
    expect(state.spec.objects.map((object) => object.id)).toContain("bench-1");
  });

  it("drops an object and its focal point through removeObject", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [{ op: "removeObject", id: "cottage-1" }],
    });
    expect(state.spec.objects.map((object) => object.id)).toEqual(["tree-1"]);
    expect(state.spec.composition.focalPoints).toEqual([]);
  });

  it("applies a list of operations in order", () => {
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        { op: "moveObject", id: "cottage-1", dx: 0.1, dy: 0 },
        { op: "setStyle", path: "hatchFamilies.field.weight", value: 0.75 },
      ],
    });
    expect(
      state.spec.objects.find((object) => object.id === "cottage-1")?.position.x,
    ).toBeCloseTo(0.6);
    expect(state.spec.styleOverrides?.hatchFamilies?.field).toMatchObject({
      weight: 0.75,
    });
  });

  it("renders the spec every operation returns", () => {
    // The acceptance of the page: an edit produces a spec that re-renders.
    const state = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        { op: "addObject", object: { id: "fence-1", kind: "fence", position: { x: 0.2, y: 0.86 }, scale: 1 } },
      ],
    });
    const result = engine.renderScene(state.spec);
    expect(result.sceneSpec.objects).toHaveLength(3);
  });
});

describe("rejected writes", () => {
  it("keeps the spec when an edit operation cannot apply", () => {
    const before = baseSpec();
    const state = reduce(editorStateOf(before), {
      type: "applyEdits",
      operations: [{ op: "moveObject", id: "no-such-object", dx: 1, dy: 1 }],
    });
    expect(state.error).toContain("moveObject");
    expect(state.spec).toEqual(before);
  });

  it("keeps the spec when a setStyle path does not resolve", () => {
    const before = baseSpec();
    const state = reduce(editorStateOf(before), {
      type: "applyEdits",
      operations: [
        { op: "setStyle", path: "hatchFamilies.sky.notAField", value: 1 },
      ],
    });
    expect(state.error).toContain("setStyle");
    expect(state.spec).toEqual(before);
  });

  it("keeps the spec when a camera patch leaves the schema", () => {
    const before = baseSpec();
    const state = reduce(editorStateOf(before), {
      type: "patchCamera",
      patch: { horizonY: 2 },
    });
    expect(state.error).toContain("horizonY");
    expect(state.spec).toEqual(before);
  });

  it("reports an imported spec that does not parse", () => {
    const state = reduce(baseState(), { type: "loadSpec", input: { objects: [] } });
    expect(state.error).toContain("invalid SceneSpec");
    expect(state.spec.meta.id).toBe("editor-test");
  });

  it("reports panel failures without touching the spec", () => {
    const state = reduce(baseState(), {
      type: "reportError",
      message: "params hold no valid JSON",
    });
    expect(state.error).toBe("params hold no valid JSON");
    expect(state.spec.objects).toHaveLength(2);
  });
});

describe("the controls without a section 21 operation", () => {
  it("writes the seed field", () => {
    const state = reduce(baseState(), { type: "setSeed", seed: 424242 });
    expect(state.spec.meta.seed).toBe(424242);
  });

  it("rejects a non-integer seed and keeps the spec", () => {
    const before = baseSpec();
    const state = reduce(editorStateOf(before), { type: "setSeed", seed: 0.5 });
    expect(state.error).toContain("seed");
    expect(state.spec).toEqual(before);
  });

  it("switches the preset and clears the style overrides", () => {
    const styled = reduce(baseState(), {
      type: "applyEdits",
      operations: [
        { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 9 },
      ],
    });
    expect(styled.spec.styleOverrides).toBeDefined();
    const state = reduce(styled, { type: "setPreset", presetId: "urban-v1" });
    expect(state.spec.meta.stylePreset).toBe("urban-v1");
    expect(state.spec.styleOverrides).toBeUndefined();
  });

  it("moves the environment type with the preset it pairs with", () => {
    // The intent stage checks the family the preset draws against the
    // type the spec names, so a picker that moved one without the other
    // would leave the page holding a spec that no longer renders.
    const state = reduce(baseState(), { type: "setPreset", presetId: "coastal-v1" });
    expect(state.spec.environment.type).toBe("coastal");
    // The rest of the environment block stays: the clouds the scene drew
    // before the switch still draw after it.
    expect(state.spec.environment.sky).toEqual({ cloudCount: 1 });
    expect(engine.renderScene(state.spec).svg).toContain("<svg");

    // A spec that says custom keeps its word: the author picked the pair.
    const custom = reduce(
      { ...baseState(), spec: { ...baseState().spec, environment: { type: "custom" } } },
      { type: "setPreset", presetId: "coastal-v1" },
    );
    expect(custom.spec.environment.type).toBe("custom");
    expect(custom.error).toBeNull();
  });

  it("rejects a preset the registry does not hold", () => {
    const state = reduce(baseState(), {
      type: "setPreset",
      presetId: "no-such-preset",
    });
    expect(state.error).toContain("no-such-preset");
    expect(state.spec.meta.stylePreset).toBe("pastoral-v1");
  });

  it("patches the camera and the composition blocks", () => {
    const state = reduce(baseState(), { type: "patchCamera", patch: { framing: "close", tilt: 6 } });
    expect(state.spec.camera.framing).toBe("close");
    expect(state.spec.camera.tilt).toBe(6);
    const next = reduce(state, {
      type: "patchComposition",
      patch: { balance: "left", depthLayers: 3 },
    });
    expect(next.spec.composition.balance).toBe("left");
    expect(next.spec.composition.depthLayers).toBe(3);
  });

  it("switches one debug flag on and off", () => {
    const on = reduce(baseState(), {
      type: "setDebugFlag",
      flag: "showRegions",
      on: true,
    });
    expect(on.spec.debug).toEqual({ showRegions: true });
    const off = reduce(on, {
      type: "setDebugFlag",
      flag: "showRegions",
      on: false,
    });
    // "Every overlay off" carries no debug block, so the plain render
    // stays byte-identical (specification section 9).
    expect(off.spec.debug).toBeUndefined();
  });
});

describe("the selection", () => {
  it("follows the object it names and clears when the object leaves", () => {
    const selected = reduce(baseState(), { type: "selectObject", id: "tree-1" });
    expect(selected.selectedId).toBe("tree-1");
    const removed = reduce(selected, {
      type: "applyEdits",
      operations: [{ op: "removeObject", id: "tree-1" }],
    });
    expect(removed.selectedId).toBeNull();
  });

  it("ignores an id no object carries", () => {
    const state = reduce(baseState(), { type: "selectObject", id: "ghost" });
    expect(state.selectedId).toBeNull();
  });

  it("resets the selection when a new spec loads", () => {
    const selected = reduce(baseState(), { type: "selectObject", id: "tree-1" });
    const state = reduce(selected, { type: "loadSpec", input: baseSpec() });
    expect(state.selectedId).toBeNull();
  });
});
