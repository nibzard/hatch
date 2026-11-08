import { describe, expect, it } from "vitest";

import {
  MaskSchema,
  RenderIRSchema,
  SymbolDefinitionSchema,
} from "../src/index.js";

import { birdSymbol, rectPath, validRenderIR } from "./fixtures.js";

describe("RenderIRSchema", () => {
  it("parses a valid intermediate representation", () => {
    const result = RenderIRSchema.safeParse(validRenderIR());
    expect(result.success).toBe(true);
  });

  it("round-trips the identity of every stage output", () => {
    const ir = RenderIRSchema.parse(validRenderIR());
    expect(ir.regions).toHaveLength(3);
    expect(ir.contours[0]?.role).toBe("contour");
    expect(ir.symbols[0]?.symbolId).toBe("bird-v1");
    expect(ir.symbolLibrary[0]?.id).toBe("bird-v1");
    expect(ir.style.preset).toBe("pastoral-v1");
    expect(ir.trace.preset).toBe("pastoral-v1");
  });

  it("defaults the symbol library to empty when a scene omits it", () => {
    const { symbolLibrary: _library, ...withoutLibrary } = validRenderIR();
    const ir = RenderIRSchema.parse({
      ...withoutLibrary,
      symbols: [],
    });
    expect(ir.symbolLibrary).toEqual([]);
  });

  it("rejects an IR without a trace", () => {
    const ir = validRenderIR() as unknown as Record<string, unknown>;
    delete ir.trace;
    const result = RenderIRSchema.safeParse(ir);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("trace");
    }
  });

  it("rejects an IR whose style is unresolved", () => {
    const ir = validRenderIR();
    const { preset: _preset, ...unresolved } = ir.style;
    const result = RenderIRSchema.safeParse({ ...ir, style: unresolved });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("style.preset");
    }
  });

  it("rejects a zero-size canvas", () => {
    const ir = validRenderIR();
    const result = RenderIRSchema.safeParse({
      ...ir,
      canvas: { width: 0, height: 768 },
    });
    expect(result.success).toBe(false);
  });

  it("defaults the anchors to empty when a scene omits them", () => {
    const { anchors: _anchors, ...withoutAnchors } = validRenderIR();
    const ir = RenderIRSchema.parse(withoutAnchors);
    expect(ir.anchors).toEqual([]);
  });

  it("carries the horizon and the debug block when the plan set them", () => {
    const ir = RenderIRSchema.parse({
      ...validRenderIR(),
      horizonY: 522,
      debug: { showRegions: true },
    });
    expect(ir.horizonY).toBe(522);
    expect(ir.debug).toEqual({ showRegions: true });
  });

  it("leaves the horizon and the debug block absent when nothing set them", () => {
    const ir = RenderIRSchema.parse(validRenderIR());
    expect(ir.horizonY).toBeUndefined();
    expect(ir.debug).toBeUndefined();
  });
});

describe("ObjectAnchorSchema", () => {
  it("parses the anchor of one placed object", () => {
    const result = RenderIRSchema.safeParse(validRenderIR());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anchors[0]).toMatchObject({
        objectId: "obj-tree-1",
        kind: "tree",
        role: "midground",
        scale: 1,
        depth: 1,
        depthIndex: 0,
        positionClamped: false,
      });
    }
  });

  it("rejects an anchor whose scale is not positive", () => {
    const ir = validRenderIR();
    const result = RenderIRSchema.safeParse({
      ...ir,
      anchors: [{ ...ir.anchors[0]!, scale: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("symbol references", () => {
  it("rejects a placement that names no definition, with a readable error", () => {
    const result = RenderIRSchema.safeParse(validRenderIR());
    expect(result.success).toBe(true);
    const dangling = RenderIRSchema.safeParse({
      ...validRenderIR(),
      symbolLibrary: [],
    });
    expect(dangling.success).toBe(false);
    if (!dangling.success) {
      const issue = dangling.error.issues.find((entry) =>
        entry.path.join(".").startsWith("symbols.0.symbolId"),
      );
      expect(issue?.message).toContain('no symbol definition owns the id "bird-v1"');
    }
  });

  it("rejects a placement against a default-empty library", () => {
    const { symbolLibrary: _library, ...withoutLibrary } = validRenderIR();
    const result = RenderIRSchema.safeParse(withoutLibrary);
    expect(result.success).toBe(false);
  });

  it("rejects two definitions that share one id", () => {
    const result = RenderIRSchema.safeParse({
      ...validRenderIR(),
      symbolLibrary: [birdSymbol(), birdSymbol()],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) =>
        entry.path.join(".").startsWith("symbolLibrary.1.id"),
      );
      expect(issue?.message).toContain('two symbol definitions share the id "bird-v1"');
    }
  });

  it("keeps two placements of one definition valid", () => {
    const ir = validRenderIR();
    const result = RenderIRSchema.safeParse({
      ...ir,
      symbols: [
        ...ir.symbols,
        { symbolId: "bird-v1", position: { x: 500, y: 90 }, scale: 0.6 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("SymbolDefinitionSchema", () => {
  it("parses a mark of several strokes with its id", () => {
    const definition = SymbolDefinitionSchema.parse(birdSymbol());
    expect(definition.id).toBe("bird-v1");
    expect(definition.strokes).toHaveLength(2);
    expect(definition.strokes[0]?.weight).toBeGreaterThan(0);
  });

  it("rejects a mark without strokes, which would render nothing", () => {
    const result = SymbolDefinitionSchema.safeParse({ id: "empty", strokes: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a mark without an id", () => {
    const result = SymbolDefinitionSchema.safeParse({
      id: "",
      strokes: birdSymbol().strokes,
    });
    expect(result.success).toBe(false);
  });
});

describe("MaskSchema", () => {
  it("defaults to an inverted mask, which carves negative space", () => {
    const mask = MaskSchema.parse({ id: "cloud-mask-1", path: rectPath(0, 0, 10, 10) });
    expect(mask.invert).toBe(true);
  });

  it("accepts an explicit non-inverted mask", () => {
    const mask = MaskSchema.parse({
      id: "clip-mask-1",
      path: rectPath(0, 0, 10, 10),
      invert: false,
    });
    expect(mask.invert).toBe(false);
  });
});
