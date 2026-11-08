import { describe, expect, it } from "vitest";

import {
  DEBUG_FLAG_NAMES,
  enabledDebugFlags,
  parseSceneSpec,
  SceneSpecSchema,
  type DebugFlags,
} from "../src/index.js";

import { validSceneSpec } from "./fixtures.js";

/** The meta fields that task T010 requires on every scene spec. */
const REQUIRED_META_FIELDS = [
  "id",
  "seed",
  "stylePreset",
  "aspectRatio",
  "version",
] as const;

/** A copy of the fixture with one meta field removed. */
function specWithoutMetaField(field: (typeof REQUIRED_META_FIELDS)[number]) {
  const spec = validSceneSpec();
  const meta: Record<string, unknown> = { ...spec.meta };
  delete meta[field];
  return { ...spec, meta };
}

describe("SceneSpecSchema", () => {
  it("parses a valid scene spec", () => {
    const result = SceneSpecSchema.safeParse(validSceneSpec());
    expect(result.success).toBe(true);
  });

  it("parses a scene with no objects, overrides, or debug block", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({ ...spec, objects: [] });
    expect(result.success).toBe(true);
  });

  it("keeps every meta field through the parse", () => {
    const parsed = SceneSpecSchema.parse(validSceneSpec());
    expect(parsed.meta).toEqual(validSceneSpec().meta);
  });

  it("parses styleOverrides and debug when they are present", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({
      ...spec,
      styleOverrides: {
        contours: { weight: 2, color: "#111111", wobble: 0.1, simplifyTolerance: 0.4 },
      },
      debug: { showRegions: true, showHatchDirections: true },
    });
    expect(result.success).toBe(true);
  });

  for (const field of REQUIRED_META_FIELDS) {
    it(`rejects a spec without meta.${field}`, () => {
      const result = SceneSpecSchema.safeParse(specWithoutMetaField(field));
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join("."));
        expect(paths).toContain(`meta.${field}`);
      }
    });
  }

  it("rejects a non-integer seed with a readable message", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({ ...spec, meta: { ...spec.meta, seed: 1.5 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/integer/);
    }
  });

  it("rejects an aspect ratio that is not width:height", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({
      ...spec,
      meta: { ...spec.meta, aspectRatio: "landscape" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/aspectRatio/);
    }
  });

  it("rejects a horizon above the canvas", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({
      ...spec,
      camera: { ...spec.camera, horizonY: 1.4 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("camera.horizonY");
    }
  });

  it("rejects a negative space ratio above 1", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({
      ...spec,
      composition: { ...spec.composition, negativeSpace: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown environment type", () => {
    const spec = validSceneSpec();
    const result = SceneSpecSchema.safeParse({
      ...spec,
      environment: { ...spec.environment, type: "mars" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate object ids and names the duplicate", () => {
    const spec = validSceneSpec();
    const clone = { ...spec.objects[0]! };
    const result = SceneSpecSchema.safeParse({
      ...spec,
      objects: [...spec.objects, clone],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("tree-1");
    }
  });

  it("rejects an object without a position", () => {
    const spec = validSceneSpec();
    const object: Record<string, unknown> = { ...spec.objects[0] };
    delete object.position;
    const result = SceneSpecSchema.safeParse({ ...spec, objects: [object] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("objects.0.position");
    }
  });
});

describe("parseSceneSpec", () => {
  it("returns the parsed spec for valid input", () => {
    const spec = parseSceneSpec(validSceneSpec());
    expect(spec.meta.seed).toBe(42);
  });

  it("throws one readable error for a malformed spec", () => {
    const spec = validSceneSpec();
    const malformed = {
      ...spec,
      camera: { framing: "wide", lens: "wide", horizonY: 9 },
      objects: [
        { id: "tree-1", kind: "tree", position: { x: 0.5, y: 0.5 }, scale: 0 },
      ],
    };
    expect(() => parseSceneSpec(malformed)).toThrowError(
      /invalid SceneSpec: .*camera\.horizonY.*objects\.0\.scale/s,
    );
  });

  it("names the missing required meta field in the message", () => {
    expect(() => parseSceneSpec(specWithoutMetaField("seed"))).toThrowError(
      /meta\.seed/,
    );
  });
});

describe("the debug block of specification sections 5 and 9", () => {
  it("parses the seven overlay flags as optional booleans", () => {
    const result = SceneSpecSchema.safeParse({
      ...validSceneSpec(),
      debug: { showRegions: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.debug).toEqual({ showRegions: true });
    }
  });

  it("names every flag exactly once, in overlay draw order", () => {
    expect(DEBUG_FLAG_NAMES).toEqual([
      "showContourOnly",
      "showRegions",
      "showDepthMap",
      "showHatchDirections",
      "showNegativeSpace",
      "showAnchors",
      "showConstructionLines",
    ]);
    expect(new Set(DEBUG_FLAG_NAMES).size).toBe(DEBUG_FLAG_NAMES.length);
  });

  it("switches no overlay on without a block", () => {
    expect(enabledDebugFlags(undefined)).toEqual([]);
  });

  it("switches no overlay on for an empty block or a block of false flags", () => {
    expect(enabledDebugFlags({})).toEqual([]);
    expect(
      enabledDebugFlags({ showRegions: false, showAnchors: false }),
    ).toEqual([]);
  });

  it("lists the flags a block switches on, in draw order", () => {
    const debug: DebugFlags = {
      showAnchors: true,
      showRegions: true,
      showDepthMap: false,
    };
    expect(enabledDebugFlags(debug)).toEqual(["showRegions", "showAnchors"]);
  });
});
