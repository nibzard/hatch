/**
 * Tests for the scene diffing of task T027 (specification sections 9, 15,
 * and 24 V3).
 *
 * The acceptance has two halves, both tested here:
 *
 * 1. a diff between two specs lists the semantic changes - one describe
 *    per section of the scene, each pinning the path, the kind, the values,
 *    and the sentence a reader gets;
 * 2. the diff pairs with the edit operations: every edit of specification
 *    section 21 shows up as the semantic change it made, which is the
 *    round-trip an agent or an editor relies on after patching a spec.
 */

import { describe, expect, it } from "vitest";

import { parseSceneSpec, type SceneSpec } from "@hatch/core";

import {
  applySceneEdits,
  diffSceneSpecs,
  formatSceneDiff,
  SceneDiffSchema,
} from "../src/index.js";

/** The preset id the fixture scene names. The diff never resolves it. */
const PRESET_ID = "test-pastoral";

/**
 * The base scene of the diff tests: two objects, one focal point, an
 * environment with a sky, and one style override, so every section carries
 * something a change can touch.
 */
function baseSpec(): SceneSpec {
  return parseSceneSpec({
    meta: {
      id: "scene-diff-0001",
      seed: 42,
      stylePreset: PRESET_ID,
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "wide", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "asymmetric",
      negativeSpace: 0.35,
      depthLayers: 3,
    },
    environment: { type: "rural", sky: { cloudCount: 3 } },
    objects: [
      {
        id: "cottage-1",
        kind: "house",
        role: "midground",
        position: { x: 0.3, y: 0.72 },
        scale: 1.2,
        params: { storeys: 2 },
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "background",
        position: { x: 0.62, y: 0.7 },
        scale: 1,
      },
    ],
    styleOverrides: {
      contours: { weight: 1.4, color: "#2f2a26", wobble: 0.4, simplifyTolerance: 0.5 },
    },
  });
}

/** One scene like the base, with one subtree replaced. */
function specWith(patch: (spec: SceneSpec) => Partial<SceneSpec>): SceneSpec {
  const base = baseSpec();
  return parseSceneSpec({ ...base, ...patch(base) });
}

/** The change at one path, or a failure that names the path. */
function changeAt(path: string, ...diffs: ReturnType<typeof diffSceneSpecs>[]) {
  for (const diff of diffs) {
    const found = diff.changes.find((change) => change.path === path);
    if (found !== undefined) {
      return found;
    }
  }
  const listed = diffs
    .flatMap((diff) => diff.changes.map((change) => change.path))
    .join(", ");
  throw new Error(`no diff change sits at "${path}"; listed: ${listed || "(none)"}`);
}

/** True when no change sits at one path. */
function noChangeAt(path: string, diff: ReturnType<typeof diffSceneSpecs>): boolean {
  return diff.changes.every((change) => change.path !== path);
}

describe("acceptance: a diff between two specs lists the semantic changes", () => {
  it("lists one change per changed field, with values and sentences", () => {
    const before = baseSpec();
    const after = specWith((spec) => ({
      meta: { ...spec.meta, seed: 99 },
      camera: { ...spec.camera, framing: "close", horizonY: 0.5, tilt: 0.2 },
      composition: {
        ...spec.composition,
        negativeSpace: 0.5,
        focalPoints: ["cottage-1", "tree-1"],
      },
      environment: { ...spec.environment, sky: { cloudCount: 6 } },
      objects: [
        spec.objects[0]!,
        { ...spec.objects[1]!, position: { x: 0.66, y: 0.7 }, scale: 1.1 },
        {
          id: "pond-1",
          kind: "water",
          position: { x: 0.8, y: 0.85 },
          scale: 0.6,
        },
      ],
      styleOverrides: {
        ...spec.styleOverrides,
        // The full section again with one field moved, the way a setStyle
        // edit writes an override (StyleOverridesSchema takes whole sections).
        contours: { weight: 2, color: "#2f2a26", wobble: 0.4, simplifyTolerance: 0.5 },
      },
    }));

    const diff = diffSceneSpecs(before, after);
    expect(diff.equal).toBe(false);

    expect(changeAt("meta.seed", diff)).toMatchObject({
      section: "meta",
      kind: "changed",
      before: 42,
      after: 99,
      description: "seed 42 → 99",
    });
    expect(changeAt("camera.framing", diff)).toMatchObject({
      section: "camera",
      kind: "changed",
      before: "wide",
      after: "close",
    });
    expect(changeAt("camera.tilt", diff)).toMatchObject({
      kind: "added",
      after: 0.2,
    });
    expect(changeAt("camera.horizonY", diff)).toMatchObject({
      kind: "changed",
      before: 0.68,
      after: 0.5,
    });
    expect(changeAt("composition.negativeSpace", diff)).toMatchObject({
      section: "composition",
      kind: "changed",
      before: 0.35,
      after: 0.5,
    });
    expect(changeAt("composition.focalPoints.tree-1", diff)).toMatchObject({
      kind: "added",
      description: 'focal point "tree-1" added',
    });
    expect(changeAt("environment.sky.cloudCount", diff)).toMatchObject({
      section: "environment",
      kind: "changed",
      before: 3,
      after: 6,
      description: "cloudCount 3 → 6",
    });
    expect(changeAt("objects.tree-1.position", diff)).toMatchObject({
      section: "objects",
      kind: "changed",
      description: "moved from (0.62, 0.7) to (0.66, 0.7)",
      before: { x: 0.62, y: 0.7 },
      after: { x: 0.66, y: 0.7 },
    });
    expect(changeAt("objects.tree-1.scale", diff)).toMatchObject({
      kind: "changed",
      before: 1,
      after: 1.1,
    });
    expect(changeAt("objects.pond-1", diff)).toMatchObject({
      kind: "added",
      description: 'object "pond-1" added: "water" at (0.8, 0.85), scale 0.6',
    });
    expect(changeAt("styleOverrides.contours.weight", diff)).toMatchObject({
      section: "style",
      kind: "changed",
      before: 1.4,
      after: 2,
    });

    // Nothing else moved: the untouched object reports no change.
    expect(noChangeAt("objects.cottage-1.kind", diff)).toBe(true);
    expect(noChangeAt("composition.balance", diff)).toBe(true);
    expect(diff.summary).toContain("semantic change(s)");
  });

  it("reports the changes of every section in a stable order", () => {
    const after = specWith((spec) => ({
      meta: { ...spec.meta, id: "scene-diff-0002" },
      camera: { ...spec.camera, lens: "wide" },
      composition: { ...spec.composition, balance: "center" },
      environment: { ...spec.environment, type: "coastal" },
      objects: spec.objects.filter((object) => object.id !== "tree-1"),
      styleOverrides: undefined,
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    const sections = [...new Set(diff.changes.map((change) => change.section))];
    expect(sections).toEqual([
      "meta",
      "camera",
      "composition",
      "environment",
      "objects",
      "style",
    ]);
  });

  it("is deterministic: the same pair diffs the same way twice", () => {
    const after = specWith((spec) => ({
      meta: { ...spec.meta, seed: 7 },
    }));
    expect(diffSceneSpecs(baseSpec(), after)).toEqual(
      diffSceneSpecs(baseSpec(), after),
    );
  });
});

describe("equal scenes", () => {
  it("reports no changes for one spec against itself", () => {
    const spec = baseSpec();
    const diff = diffSceneSpecs(spec, spec);
    expect(diff.changes).toEqual([]);
    expect(diff.equal).toBe(true);
    expect(diff.beforeHash).toBe(diff.afterHash);
    expect(diff.summary).toContain("no semantic changes");
  });

  it("ignores key order, absent optional fields, and the debug block", () => {
    // The debug block is a view switch, not scene content: the spec hash
    // leaves it out, and so does the semantic diff.
    const reordered = parseSceneSpec({
      objects: [...baseSpec().objects].reverse(),
      composition: baseSpec().composition,
      camera: baseSpec().camera,
      environment: baseSpec().environment,
      meta: baseSpec().meta,
      debug: { showRegions: true, showAnchors: true },
      styleOverrides: baseSpec().styleOverrides,
    });
    const diff = diffSceneSpecs(baseSpec(), reordered);
    // The object list order flipped, which is a reorder of the same two
    // objects: the diff reports the order change and nothing else.
    expect(diff.changes.map((change) => change.path)).toEqual(["objects"]);
    expect(diff.changes[0]?.description).toContain("cottage-1, tree-1");
    expect(diff.changes[0]?.description).toContain("tree-1, cottage-1");

    const withFlags = parseSceneSpec({
      ...baseSpec(),
      debug: { showRegions: true, showAnchors: true },
    });
    expect(diffSceneSpecs(baseSpec(), withFlags).equal).toBe(true);
  });
});

describe("the object list", () => {
  it("reports a removed object with its placement", () => {
    const after = specWith((spec) => ({
      objects: spec.objects.filter((object) => object.id !== "cottage-1"),
      // The scene drops the focal point that named the object, the same
      // pruning removeObject does, so both halves of the removal appear.
      composition: {
        ...spec.composition,
        focalPoints: spec.composition.focalPoints.filter(
          (id) => id !== "cottage-1",
        ),
      },
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    expect(changeAt("objects.cottage-1", diff)).toMatchObject({
      kind: "removed",
      description:
        'object "cottage-1" removed: "house" at (0.3, 0.72), scale 1.2, ' +
        "role \"midground\"",
    });
    // The focal point that named the dropped object is its own change.
    expect(changeAt("composition.focalPoints.cottage-1", diff)).toMatchObject({
      kind: "removed",
    });
  });

  it("reports a kind swap, a parameter change, and a style role change", () => {
    const after = specWith((spec) => ({
      objects: spec.objects.map((object) =>
        object.id === "cottage-1"
          ? {
              ...object,
              kind: "tram",
              params: { storeys: 3, stripes: 2 },
              styleRole: "sky hatch",
            }
          : object,
      ),
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    expect(changeAt("objects.cottage-1.kind", diff)).toMatchObject({
      kind: "changed",
      before: "house",
      after: "tram",
    });
    expect(changeAt("objects.cottage-1.params.storeys", diff)).toMatchObject({
      kind: "changed",
      before: 2,
      after: 3,
    });
    expect(changeAt("objects.cottage-1.params.stripes", diff)).toMatchObject({
      kind: "added",
      after: 2,
    });
    expect(changeAt("objects.cottage-1.styleRole", diff)).toMatchObject({
      kind: "added",
      after: "sky hatch",
    });
  });

  it("reports a dropped optional field as removed, not as a value change", () => {
    const before = specWith((spec) => ({
      objects: spec.objects.map((object) =>
        object.id === "tree-1" ? { ...object, rotation: 0.4, styleRole: "sky hatch" } : object,
      ),
    }));
    const diff = diffSceneSpecs(before, baseSpec());
    expect(changeAt("objects.tree-1.rotation", diff)).toMatchObject({
      kind: "removed",
      before: 0.4,
    });
    expect(changeAt("objects.tree-1.styleRole", diff)).toMatchObject({
      kind: "removed",
      before: "sky hatch",
    });
  });

  it("reports a reorder of the same objects as one order change", () => {
    const after = specWith((spec) => ({
      objects: [...spec.objects].reverse(),
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      section: "objects",
      kind: "changed",
      path: "objects",
      before: ["cottage-1", "tree-1"],
      after: ["tree-1", "cottage-1"],
    });
  });

  it("reports a whole environment block that appears or disappears", () => {
    const withGround = specWith((spec) => ({
      environment: { ...spec.environment, ground: { material: "grass", wetness: 0.1 } },
    }));
    const added = diffSceneSpecs(baseSpec(), withGround);
    expect(changeAt("environment.ground", added)).toMatchObject({
      kind: "added",
      after: { material: "grass", wetness: 0.1 },
    });

    const nested = specWith((spec) => ({
      environment: {
        ...spec.environment,
        ground: { material: "grass", wetness: 0.1 },
      },
    }));
    const changed = diffSceneSpecs(
      nested,
      specWith((spec) => ({
        environment: { ...spec.environment, ground: { material: "gravel" } },
      })),
    );
    expect(changeAt("environment.ground.material", changed)).toMatchObject({
      kind: "changed",
      before: "grass",
      after: "gravel",
    });
    expect(changeAt("environment.ground.wetness", changed)).toMatchObject({
      kind: "removed",
      before: 0.1,
    });
  });

  it("cuts long values short in the description, not in the data", () => {
    const longText = "x".repeat(200);
    const after = specWith((spec) => ({
      environment: { ...spec.environment, atmosphere: { note: longText } },
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    const change = changeAt("environment.atmosphere", diff);
    expect(change.after).toEqual({ note: longText });
    expect(change.description.length).toBeLessThan(90);
    expect(change.description).toContain("…");
  });
});

describe("the diff and the edit operations (specification section 15)", () => {
  /** One edit context that resolves nothing: the diff never resolves styles. */
  const context = {
    resolveStyle: () => {
      throw new Error("the diff tests resolve no style");
    },
  };

  it("lists the semantic changes each edit made", () => {
    const before = baseSpec();
    const after = applySceneEdits(
      before,
      [
        { op: "moveObject", id: "tree-1", dx: 0.05, dy: 0 },
        { op: "addObject", object: { id: "bench-1", kind: "bench", position: { x: 0.5, y: 0.9 }, scale: 0.5 } },
        { op: "removeObject", id: "cottage-1" },
      ],
      context,
    );
    const diff = diffSceneSpecs(before, after);
    expect(diff.equal).toBe(false);
    expect(changeAt("objects.tree-1.position", diff).kind).toBe("changed");
    expect(changeAt("objects.bench-1", diff).kind).toBe("added");
    expect(changeAt("objects.cottage-1", diff).kind).toBe("removed");
    expect(changeAt("composition.focalPoints.cottage-1", diff).kind).toBe("removed");
  });

  it("reports no changes for an edit run that changes nothing", () => {
    const before = baseSpec();
    const after = applySceneEdits(before, [{ op: "moveObject", id: "tree-1", dx: 0, dy: 0 }], context);
    expect(diffSceneSpecs(before, after).equal).toBe(true);
  });
});

describe("validation and rendering", () => {
  it("fails with one readable error when a spec does not parse", () => {
    expect(() => diffSceneSpecs({ nope: true }, baseSpec())).toThrow(
      /invalid SceneSpec/,
    );
    expect(() => diffSceneSpecs(baseSpec(), { nope: true })).toThrow(
      /invalid SceneSpec/,
    );
  });

  it("produces a diff that parses against its schema and survives JSON", () => {
    const after = specWith((spec) => ({ meta: { ...spec.meta, seed: 7 } }));
    const diff = diffSceneSpecs(baseSpec(), after);
    expect(SceneDiffSchema.parse(diff)).toEqual(diff);
    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff);
    expect(diff.beforeHash).toMatch(/^sha256:/);
    expect(diff.afterHash).toMatch(/^sha256:/);
    expect(diff.beforeHash).not.toBe(diff.afterHash);
  });

  it("formats the diff as one line per change", () => {
    const after = specWith((spec) => ({
      meta: { ...spec.meta, seed: 99 },
      objects: spec.objects.filter((object) => object.id !== "tree-1"),
    }));
    const diff = diffSceneSpecs(baseSpec(), after);
    const text = formatSceneDiff(diff);
    const lines = text.split("\n");
    expect(lines[0]).toContain("semantic change(s)");
    expect(lines).toHaveLength(diff.changes.length + 1);
    for (const change of diff.changes) {
      expect(text).toContain(`[${change.section}] ${change.path}`);
      expect(text).toContain(change.description);
    }
    expect(formatSceneDiff(diffSceneSpecs(baseSpec(), baseSpec()))).toBe(
      "scene diff: no semantic changes",
    );
  });
});
