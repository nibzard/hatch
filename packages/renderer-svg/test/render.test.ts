/**
 * Acceptance tests for the SVG region renderer.
 *
 * The four acceptance criteria of task T014, as tests:
 * 1. the output is well-formed SVG;
 * 2. the draw order follows zIndex;
 * 3. a mask produces a visible cutout;
 * 4. the metadata block is present.
 *
 * The mask criterion is proven twice: structurally, from the mask element
 * and its wrapper group in the markup, and geometrically, from the strokes
 * the hatching engine emits under the same render stream. SVG masks work on
 * luminance: the white canvas keeps the hatching, the black cloud path
 * hides everything under it, and the paper rect below the wrapper shows
 * through. The geometric check proves there is ink under the cloud to hide
 * and ink outside it to keep, so the cutout is visible, not vacuous.
 *
 * Task T033 adds the default-sense regression: a mask that omits `invert`
 * must render as the schema default, which is the cutout sense above.
 *
 * Task T034 adds the symbol resolution criterion: every `use` of the symbol
 * layer must reference a mark definition the same document carries, and a
 * placement that names no definition is rejected, never silently dropped.
 */

import { describe, expect, it } from "vitest";

import { pointInPath, samplePathPoints, subpathsOf } from "@hatch/geometry";
import { hatchRegions, type HatchSet } from "@hatch/hatching";
import type { Point } from "@hatch/core";

import {
  createRenderRng,
  formatNumber,
  hatchFitTolerance,
  hatchStrokeData,
  pathData,
  renderSvg,
} from "../src/index.js";

import {
  birdSymbol,
  circlePath,
  cloudMask,
  cloudMaskInput,
  sceneIR,
  sceneRegions,
  stackedIR,
  traceOf,
} from "./fixtures.js";
import {
  assertWellFormedXml,
  elementMarkup,
  layerIndex,
  openChain,
  parseTags,
  pathDataValues,
  type TagToken,
} from "./xml-check.js";

/** The tags of one render, parsed once. */
function tagsOf(markup: string): TagToken[] {
  return parseTags(markup);
}

/** The region ids of one render, in document order. */
function regionOrder(markup: string): string[] {
  return tagsOf(markup)
    .filter(
      (token) => token.kind !== "close" && token.attributes["data-region-id"] !== undefined,
    )
    .map((token) => token.attributes["data-region-id"] ?? "");
}

/** The wrapper groups that carry a mask attribute. */
function maskWrappers(tokens: readonly TagToken[]): TagToken[] {
  return tokens.filter(
    (token) => token.kind === "open" && token.attributes["mask"] !== undefined,
  );
}

/** Every id the document defines, on any element. */
function definedIds(tokens: readonly TagToken[]): Set<string> {
  return new Set(
    tokens
      .map((token) => token.attributes["id"])
      .filter((id): id is string => id !== undefined),
  );
}

/** Every fragment reference of the document, leading `#` included. */
function hrefs(tokens: readonly TagToken[]): string[] {
  return tokens
    .map((token) => token.attributes["href"])
    .filter((href): href is string => href !== undefined);
}

/** Every sampled point of every stroke of one set. */
function setPoints(set: HatchSet, spacing = 2): Point[] {
  return set.strokes.flatMap((stroke) =>
    subpathsOf(stroke.path).flatMap((piece) => samplePathPoints(piece, spacing)),
  );
}

/** The stroke sets the renderer drew, recomputed through the public API. */
function drawnSets(ir: ReturnType<typeof sceneIR>): HatchSet[] {
  return hatchRegions(ir.regions, ir.style, createRenderRng(ir));
}

describe("acceptance: the output is well-formed SVG", () => {
  it("renders the complete scene as parseable XML with one root", () => {
    const markup = renderSvg(sceneIR());
    expect(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    assertWellFormedXml(markup);
    const roots = tagsOf(markup).filter(
      (token) => token.name === "svg" && token.kind === "open",
    );
    expect(roots).toHaveLength(1);
  });

  it("renders a bare region stack without masks, contours, or symbols", () => {
    assertWellFormedXml(renderSvg(stackedIR()));
  });

  it("renders a scene whose every region is negative space", () => {
    const markup = renderSvg(
      sceneIR({
        regions: [
          {
            id: "quiet",
            role: "sky",
            path: circlePath(160, 120, 80),
            fillStyle: { type: "none" },
            zIndex: 0,
          },
        ],
        masks: [],
        contours: [],
        symbols: [],
      }),
    );
    assertWellFormedXml(markup);
    expect(markup).toContain('data-region-id="quiet"');
  });

  it("refuses an invalid intermediate representation with a readable error", () => {
    const broken = sceneIR();
    // A path that does not start with a move command fails the schema.
    broken.regions[0]!.path = {
      commands: [{ command: "line", to: { x: 1, y: 1 } }],
    };
    expect(() => renderSvg(broken)).toThrow(/renderSvg needs a valid RenderIR/);
  });
});

describe("acceptance: the draw order follows zIndex", () => {
  it("stacks regions by zIndex, whatever the input order", () => {
    const markup = renderSvg(stackedIR());
    // Input order: field(20), sky(0), tree-b(11), hill(10), tree-c(11).
    expect(regionOrder(markup)).toEqual(["sky", "hill", "tree-b", "tree-c", "field"]);
  });

  it("keeps the input order between regions of one zIndex", () => {
    const markup = renderSvg(stackedIR());
    expect(regionOrder(markup).slice(2, 4)).toEqual(["tree-b", "tree-c"]);
  });

  it("carries the zIndex of every region on its group", () => {
    const tokens = tagsOf(renderSvg(sceneIR()));
    const zIndices = tokens
      .filter((token) => token.attributes["data-region-id"] !== undefined)
      .map((token) => Number(token.attributes["data-zindex"]));
    expect(zIndices).toEqual([0, 10, 20]);
  });

  it("draws the paper below the regions and the contours and symbols above", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const paper = layerIndex(tokens, "paper");
    const regions = layerIndex(tokens, "regions");
    const contours = layerIndex(tokens, "contours");
    const symbols = layerIndex(tokens, "symbols");
    expect(paper).toBeLessThan(regions);
    expect(regions).toBeLessThan(contours);
    expect(contours).toBeLessThan(symbols);
    // The paper is a direct child of the root, never inside a mask wrapper.
    expect(openChain(tokens, paper)).toEqual(["svg"]);
  });

  it("renders one path per contour stroke with its ink and weight", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const contourMarkup = elementMarkup(markup, tokens, layerIndex(tokens, "contours"));
    expect(contourMarkup).toContain('stroke="#26221e"');
    expect(contourMarkup).toContain('stroke-width="1.1"');
    expect(contourMarkup).toContain('data-role="contour"');
    expect(contourMarkup.match(/<path /g)).toHaveLength(1);
  });
});

describe("acceptance: a mask produces a visible cutout", () => {
  const ir = sceneIR();
  const markup = renderSvg(ir);
  const tokens = tagsOf(markup);

  it("wraps the whole region stack in one masked group per mask", () => {
    const wrappers = maskWrappers(tokens);
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0]!.attributes["mask"]).toBe("url(#m-cloud-1)");
    // The regions layer sits inside the wrapper; the paper does not, and it
    // draws before it, so the cloud shows paper through the cutout. With one
    // mask, the chain of the regions layer is the root plus that one wrapper.
    const regions = layerIndex(tokens, "regions");
    expect(openChain(tokens, regions)).toEqual(["svg", "g"]);
    const paper = layerIndex(tokens, "paper");
    expect(openChain(tokens, paper)).toEqual(["svg"]);
    expect(paper).toBeLessThan(tokens.indexOf(wrappers[0]!));
  });

  it("defines the mask as a white canvas with the black cloud path", () => {
    const maskToken = tokens.find(
      (token) => token.name === "mask" && token.attributes["id"] === "m-cloud-1",
    );
    expect(maskToken).toBeDefined();
    const maskMarkup = elementMarkup(markup, tokens, tokens.indexOf(maskToken!));
    // Luminance masking: white keeps, black hides (specification section 7).
    expect(maskMarkup).toContain(
      '<rect x="0" y="0" width="320" height="240" fill="#ffffff" />',
    );
    expect(maskMarkup).toContain(
      `<path d="${pathData(cloudMask().path)}" fill="#000000" />`,
    );
    // The mask lives in the definitions, not in the drawn stack.
    expect(openChain(tokens, tokens.indexOf(maskToken!))).toEqual(["svg", "defs"]);
  });

  it("hides real ink: hatch strokes pass under the cloud and out of it", () => {
    const sets = drawnSets(ir);
    const sky = sets.find((set) => set.regionId === "sky");
    expect(sky).toBeDefined();
    expect(sky!.strokes.length).toBeGreaterThan(0);
    const points = setPoints(sky!);
    const inside = points.filter((point) => pointInPath(cloudMask().path, point));
    const outside = points.filter(
      (point) => !pointInPath(cloudMask().path, point),
    );
    // Ink exists under the cloud, so the cutout has something to reveal,
    // and ink survives around it, so the region still reads as hatched.
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
  });

  it("keeps the ink in the markup and hides it at composite time", () => {
    // Without the mask the same stream draws the identical strokes: the
    // mask removes no geometry, it covers it, which is what makes the
    // cutout reversible and the render inspectable (specification section 22).
    const unmasked = renderSvg(sceneIR({ masks: [] }));
    const maskedRegionData = pathDataValues(
      elementMarkup(markup, tokens, layerIndex(tokens, "regions")),
    );
    const unmaskedRegionData = pathDataValues(
      elementMarkup(unmasked, tagsOf(unmasked), layerIndex(tagsOf(unmasked), "regions")),
    );
    expect(maskedRegionData).toEqual(unmaskedRegionData);
    expect(maskWrappers(tagsOf(unmasked))).toHaveLength(0);
  });

  it("nests one wrapper per mask, so several cutouts combine", () => {
    const twoMasks = sceneIR({
      masks: [
        cloudMask(),
        { id: "cloud-1", path: circlePath(240, 60, 30), invert: true },
      ],
    });
    const tokens = tagsOf(renderSvg(twoMasks));
    const wrappers = maskWrappers(tokens);
    expect(wrappers).toHaveLength(2);
    // The raw ids collide after sanitizing, so the second one carries a
    // suffix and both references stay distinct.
    expect(new Set(wrappers.map((token) => token.attributes["mask"])).size).toBe(2);
    // The innermost wrapper still wraps the whole region stack.
    const regions = layerIndex(tokens, "regions");
    expect(openChain(tokens, regions)).toEqual(["svg", "g", "g"]);
  });
});

describe("acceptance: a mask that omits invert takes the schema default", () => {
  /** The markup of the `m-cloud-1` mask element of one render. */
  function cloudMaskMarkup(markup: string): string {
    const tokens = tagsOf(markup);
    const maskToken = tokens.find(
      (token) => token.name === "mask" && token.attributes["id"] === "m-cloud-1",
    );
    expect(maskToken).toBeDefined();
    return elementMarkup(markup, tokens, tokens.indexOf(maskToken!));
  }

  it("fills the absent field with true and carves the cutout", () => {
    const markup = renderSvg(sceneIR({ masks: [cloudMaskInput()] }));
    const maskMarkup = cloudMaskMarkup(markup);
    // Luminance masking under the default: the white canvas keeps the
    // hatching and the black cloud path hides what sits under it, so the
    // cloud reads as negative space (specification sections 7 and 24).
    expect(maskMarkup).toContain(
      '<rect x="0" y="0" width="320" height="240" fill="#ffffff" />',
    );
    expect(maskMarkup).toContain(
      `<path d="${pathData(cloudMask().path)}" fill="#000000" />`,
    );
    assertWellFormedXml(markup);
  });

  it("renders the omitted field byte-identically to an explicit true", () => {
    const omitted = renderSvg(sceneIR({ masks: [cloudMaskInput()] }));
    expect(omitted).toBe(renderSvg(sceneIR({ masks: [cloudMask()] })));
    // The default is a real default, not a second behavior: it must not
    // collapse into the explicit inverted sense.
    expect(omitted).not.toBe(
      renderSvg(sceneIR({ masks: [{ ...cloudMask(), invert: false }] })),
    );
  });

  it("still renders an explicit false as keep-only-inside", () => {
    const markup = renderSvg(
      sceneIR({ masks: [{ ...cloudMask(), invert: false }] }),
    );
    const maskMarkup = cloudMaskMarkup(markup);
    expect(maskMarkup).toContain(
      '<rect x="0" y="0" width="320" height="240" fill="#000000" />',
    );
    expect(maskMarkup).toContain(
      `<path d="${pathData(cloudMask().path)}" fill="#ffffff" />`,
    );
  });
});

describe("acceptance: every symbol placement resolves to a defined mark", () => {
  /** The markup of the symbol definition element with the given id. */
  function symbolMarkup(markup: string, id: string): string {
    const tokens = tagsOf(markup);
    const symbolToken = tokens.find(
      (token) => token.name === "g" && token.attributes["id"] === id,
    );
    expect(symbolToken).toBeDefined();
    return elementMarkup(markup, tokens, tokens.indexOf(symbolToken!));
  }

  it("defines one mark per placed definition, inside the defs", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const symbolToken = tokens.find(
      (token) => token.name === "g" && token.attributes["id"] === "sym-bird-v1",
    );
    expect(symbolToken).toBeDefined();
    expect(openChain(tokens, tokens.indexOf(symbolToken!))).toEqual(["svg", "defs"]);
  });

  it("draws the mark's strokes as unfilled paths with their ink and weight", () => {
    const markup = symbolMarkup(renderSvg(sceneIR()), "sym-bird-v1");
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('stroke-linecap="round"');
    for (const stroke of birdSymbol().strokes) {
      expect(markup).toContain(`<path d="${pathData(stroke.path)}"`);
    }
    expect(markup).toContain('stroke="#3a342e"');
    expect(markup).toContain('stroke-width="0.9"');
  });

  it("points every use at the allocated definition, not at the raw symbolId", () => {
    const markup = renderSvg(sceneIR());
    const symbols = elementMarkup(
      markup,
      tagsOf(markup),
      layerIndex(tagsOf(markup), "symbols"),
    );
    expect(symbols).toContain('<use href="#sym-bird-v1"');
    expect(symbols).toContain('transform="translate(60 40) rotate(12) scale(1)"');
    // The raw id never reaches the document as a reference.
    expect(symbols).not.toContain('href="#bird-v1"');
  });

  it("leaves no dangling reference: every href resolves to a defined id", () => {
    const tokens = tagsOf(renderSvg(sceneIR()));
    const ids = definedIds(tokens);
    expect(ids.size).toBeGreaterThan(0);
    for (const href of hrefs(tokens)) {
      expect(ids.has(href.slice(1))).toBe(true);
    }
  });

  it("rejects a placement that names no definition, never silently dropping it", () => {
    const ir = sceneIR({ symbolLibrary: [] });
    expect(() => renderSvg(ir)).toThrow(
      /renderSvg needs a valid RenderIR: symbols\.0\.symbolId: no symbol definition owns the id "bird-v1"/,
    );
  });

  it("rejects two library entries that share one id", () => {
    const ir = sceneIR({ symbolLibrary: [birdSymbol(), birdSymbol()] });
    expect(() => renderSvg(ir)).toThrow(
      /symbolLibrary\.1\.id: two symbol definitions share the id "bird-v1"/,
    );
  });

  it("keeps both references distinct when two ids sanitize alike", () => {
    // `bird v1` and `bird/v1` both sanitize to `bird-v1`, so the allocator
    // must hand out two distinct definition ids, one per placement.
    const ir = sceneIR({
      symbols: [
        { symbolId: "bird v1", position: { x: 60, y: 40 }, scale: 1 },
        { symbolId: "bird/v1", position: { x: 200, y: 40 }, scale: 1 },
      ],
      symbolLibrary: [birdSymbol("bird v1"), birdSymbol("bird/v1")],
    });
    const markup = renderSvg(ir);
    const tokens = tagsOf(markup);
    const symbolIds = tokens
      .filter(
        (token) => token.kind === "open" && (token.attributes["id"] ?? "").startsWith("sym-"),
      )
      .map((token) => token.attributes["id"] ?? "");
    expect(new Set(symbolIds).size).toBe(2);
    const ids = definedIds(tokens);
    for (const href of hrefs(tokens)) {
      expect(ids.has(href.slice(1))).toBe(true);
    }
  });

  it("adds no symbol definitions for a library that nothing places", () => {
    const markup = renderSvg(sceneIR({ symbols: [] }));
    expect(markup).not.toContain('id="sym-');
    expect(markup).not.toContain('data-layer="symbols"');
  });
});

describe("acceptance: the metadata block is present", () => {
  it("embeds version, seed, and preset beside the drawing", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const metadata = tokens.find((token) => token.name === "metadata");
    expect(metadata).toBeDefined();
    expect(metadata!.text).toContain('"version":"0.1.0"');
    expect(metadata!.text).toContain('"seed":42');
    expect(metadata!.text).toContain('"preset":"pastoral-v1"');
  });
});

describe("region fills and clip extents", () => {
  it("draws exactly the strokes of the hatching engine, in draw order", () => {
    const ir = sceneIR();
    const markup = renderSvg(ir);
    const tokens = tagsOf(markup);
    const regionMarkup = elementMarkup(
      markup,
      tokens,
      layerIndex(tokens, "regions"),
    );
    // The document groups strokes that share a width into one path, so the
    // expected values rebuild those runs the way task T036 documents them:
    // fitted inside the tolerance of the region's fill style, written as
    // relative path data, and joined per width in placement order.
    const expected = drawnSets(ir).flatMap((set) => {
      const styleOf = new Map(ir.regions.map((region) => [region.id, region]));
      const region = styleOf.get(set.regionId);
      const tolerance = hatchFitTolerance(
        region?.fillStyle ?? { type: "none" },
        ir.style.texture,
      );
      const order: string[] = [];
      const runs = new Map<string, string[]>();
      for (const stroke of set.strokes) {
        const key = formatNumber(
          Math.round(stroke.weight * 100) / 100,
        );
        if (!runs.has(key)) {
          runs.set(key, []);
          order.push(key);
        }
        runs.get(key)!.push(hatchStrokeData(stroke, tolerance));
      }
      return order.map((key) => (runs.get(key) ?? []).join(""));
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(pathDataValues(regionMarkup)).toEqual(expected);
  });

  it("emits an empty group for a region of pure negative space", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const hill = tokens.findIndex(
      (token) => token.attributes["data-region-id"] === "hill",
    );
    expect(hill).toBeGreaterThanOrEqual(0);
    expect(elementMarkup(markup, tokens, hill)).not.toContain("<path");
  });

  it("clips a region that carries an extent, in the defs and on its group", () => {
    const markup = renderSvg(sceneIR());
    const tokens = tagsOf(markup);
    const clip = tokens.find(
      (token) => token.name === "clipPath" && token.attributes["id"] === "clip-sky",
    );
    expect(clip).toBeDefined();
    const sky = tokens.find(
      (token) => token.attributes["data-region-id"] === "sky",
    );
    expect(sky!.attributes["clip-path"]).toBe("url(#clip-sky)");
    // The clip extent holds the strokes the engine drew for the region.
    const skySet = drawnSets(sceneIR()).find((set) => set.regionId === "sky")!;
    const clipRect = sceneRegions()[1]!.clip!;
    for (const point of setPoints(skySet)) {
      expect(pointInPath(clipRect, point)).toBe(true);
    }
  });
});

describe("determinism of the rendered bytes", () => {
  it("renders one intermediate representation byte-identically twice", () => {
    expect(renderSvg(sceneIR())).toBe(renderSvg(sceneIR()));
  });

  it("renders one scene identically before and after another scene", () => {
    const first = renderSvg(sceneIR());
    renderSvg(stackedIR());
    expect(renderSvg(sceneIR())).toBe(first);
  });

  it("changes the output when the render identity changes", () => {
    const seed42 = renderSvg(sceneIR({ trace: traceOf({ seed: 42 }) }));
    const seed43 = renderSvg(sceneIR({ trace: traceOf({ seed: 43 }) }));
    expect(seed42).not.toBe(seed43);
  });

  it("accepts an explicit stream and renders it identically", () => {
    const ir = sceneIR();
    expect(renderSvg(ir, createRenderRng(ir))).toBe(renderSvg(ir));
  });
});
