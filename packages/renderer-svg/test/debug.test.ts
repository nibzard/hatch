/**
 * Acceptance tests for the debug overlays (task T022, specification
 * sections 5 and 9).
 *
 * The two acceptance criteria of the task, as tests:
 *
 * 1. each debug flag adds one overlay layer to the SVG;
 * 2. with every flag off, the output is byte-identical to a render whose
 *    spec carries no debug object.
 *
 * Criterion 2 is proven at three levels, because "off" has three spellings:
 * no debug block, an empty block, and a block of explicit false flags. All
 * three must agree, and all three must match a plain render byte for byte.
 *
 * Criterion 1 is proven strictly: one flag on yields the plain document plus
 * exactly one `debug-*` layer, appended after every artwork layer and outside
 * every mask wrapper. The prefix check is the stronger form - every byte of
 * the plain render survives untouched in front of the overlay - which is what
 * lets an overlay explain a drawing rather than replace it.
 */

import { describe, expect, it } from "vitest";

import {
  DEBUG_FLAG_NAMES,
  type DebugFlags,
  regionsInDrawOrder,
} from "@hatch/core";

import { DEBUG_LAYER_NAMES, pathData, renderSvg } from "../src/index.js";

import { sceneAnchors, sceneIR } from "./fixtures.js";
import {
  assertWellFormedXml,
  elementMarkup,
  layerIndex,
  openChain,
  parseTags,
  pathDataValues,
  type TagToken,
} from "./xml-check.js";

/** One flag on, every other flag absent. */
function only(flag: DebugFlagKey): DebugFlags {
  return { [flag]: true };
}

/** The debug flag names, narrowed for the test helpers. */
type DebugFlagKey = (typeof DEBUG_FLAG_NAMES)[number];

/** The tokens of one render, parsed once. */
function tagsOf(markup: string): TagToken[] {
  return parseTags(markup);
}

/** The `data-layer` values of one document, in draw order. */
function layerNames(tokens: readonly TagToken[]): string[] {
  return tokens
    .filter((token) => token.attributes["data-layer"] !== undefined)
    .map((token) => token.attributes["data-layer"] ?? "");
}

/** The path elements of one layer, as attribute records. */
function layerPaths(markup: string, layer: string): Record<string, string>[] {
  const tokens = tagsOf(markup);
  return tagsOf(elementMarkup(markup, tokens, layerIndex(tokens, layer)))
    .filter((token) => token.name === "path")
    .map((token) => token.attributes);
}

/**
 * The markup of the artwork on its own: everything before the first overlay,
 * or before the closing tag of a document that carries none.
 */
function beforeOverlays(markup: string): string {
  const overlay = markup.indexOf('<g data-layer="debug-');
  const cut = overlay >= 0 ? overlay : markup.indexOf("</svg>");
  // The indent of the overlay's own line is layout, not artwork, so it drops.
  return markup.slice(0, cut).replace(/\s+$/, "");
}

/** The first `M x y` move of one path's `d` value. */
function firstMove(d: string): string {
  return d.match(/^M[^a-zA-Z]*/)?.[0] ?? d;
}

/** Every debug flag switched on at once. */
function allFlags(): DebugFlags {
  return Object.fromEntries(DEBUG_FLAG_NAMES.map((flag) => [flag, true]));
}

describe("acceptance: with every flag off, the bytes are the plain render's", () => {
  const plain = renderSvg(sceneIR());

  it("renders a spec with no debug object identically to the baseline", () => {
    expect(renderSvg(sceneIR({ debug: undefined }))).toBe(plain);
    expect(plain).not.toContain('data-layer="debug-');
  });

  it("renders an empty debug block identically to no debug object", () => {
    expect(renderSvg(sceneIR({ debug: {} }))).toBe(plain);
  });

  it("renders a block of explicit false flags identically to no debug object", () => {
    const everyFlagOff: DebugFlags = Object.fromEntries(
      DEBUG_FLAG_NAMES.map((flag) => [flag, false]),
    );
    expect(renderSvg(sceneIR({ debug: everyFlagOff }))).toBe(plain);
  });

  it("draws the artwork layers and nothing else", () => {
    expect(layerNames(tagsOf(plain))).toEqual([
      "paper",
      "regions",
      "contours",
      "symbols",
    ]);
  });
});

describe("acceptance: each flag adds one overlay layer", () => {
  const plain = renderSvg(sceneIR());
  const plainLayers = layerNames(tagsOf(plain));

  for (const flag of DEBUG_FLAG_NAMES) {
    const layer = DEBUG_LAYER_NAMES[flag];

    describe(`flag ${flag}`, () => {
      const markup = renderSvg(sceneIR({ debug: only(flag) }));
      const tokens = tagsOf(markup);

      it(`adds exactly the layer ${layer}`, () => {
        assertWellFormedXml(markup);
        expect(layerNames(tokens)).toEqual([...plainLayers, layer]);
      });

      it("leaves every byte of the plain render in front of it", () => {
        expect(beforeOverlays(markup)).toBe(beforeOverlays(plain));
      });

      it("draws above every artwork layer and outside every mask wrapper", () => {
        const index = layerIndex(tokens, layer);
        for (const artwork of plainLayers) {
          expect(index).toBeGreaterThan(layerIndex(tokens, artwork));
        }
        expect(openChain(tokens, index)).toEqual(["svg"]);
      });

      it("keeps the stroke paths of the artwork untouched", () => {
        expect(
          pathDataValues(elementMarkup(markup, tokens, layerIndex(tokens, "regions"))),
        ).toEqual(
          pathDataValues(
            elementMarkup(plain, tagsOf(plain), layerIndex(tagsOf(plain), "regions")),
          ),
        );
      });
    });
  }

  it("draws every layer at once, in the canonical overlay order", () => {
    const markup = renderSvg(sceneIR({ debug: allFlags() }));
    expect(layerNames(tagsOf(markup))).toEqual([
      ...plainLayers,
      ...DEBUG_FLAG_NAMES.map((flag) => DEBUG_LAYER_NAMES[flag]),
    ]);
  });

  it("renders the same overlay bytes twice", () => {
    const withOverlays = sceneIR({ debug: { showRegions: true, showAnchors: true } });
    expect(renderSvg(withOverlays)).toBe(renderSvg(withOverlays));
  });

  it("keeps the overlay outside the mask wrappers of the cloud cutout", () => {
    const markup = renderSvg(sceneIR({ debug: only("showRegions") }));
    const tokens = tagsOf(markup);
    const wrappers = tokens.filter(
      (token) => token.kind === "open" && token.attributes["mask"] !== undefined,
    );
    expect(wrappers).toHaveLength(1);
    // The overlay draws after the wrapper, never inside it.
    expect(layerIndex(tokens, "debug-regions")).toBeGreaterThan(
      tokens.indexOf(wrappers[0]!),
    );
  });
});

describe("the region map", () => {
  const ir = sceneIR({ debug: only("showRegions") });
  const markup = renderSvg(ir);
  const paths = layerPaths(markup, "debug-regions");

  it("carries one entry per region, in draw order", () => {
    expect(paths.map((path) => path["data-region-id"])).toEqual([
      "sky",
      "hill",
      "field",
    ]);
  });

  it("names the role and the zIndex of each region", () => {
    expect(paths[0]).toMatchObject({
      "data-region-id": "sky",
      "data-role": "sky",
      "data-zindex": "0",
    });
    expect(paths[1]).toMatchObject({
      "data-region-id": "hill",
      "data-role": "mountain",
      "data-zindex": "10",
    });
  });

  it("tints and dashes every region, so the map reads over the ink", () => {
    expect(paths).toHaveLength(ir.regions.length);
    expect(paths.every((path) => path["fill-opacity"] === "0.12")).toBe(true);
    expect(paths.every((path) => path["stroke-dasharray"] === "7 5")).toBe(true);
    // One hue per region, so neighboring regions stay apart.
    expect(new Set(paths.map((path) => path["stroke"])).size).toBe(
      ir.regions.length,
    );
  });

  it("outlines the exact geometry of each region", () => {
    const expected = regionsInDrawOrder(ir.regions).map((region) =>
      pathData(region.path),
    );
    expect(
      pathDataValues(
        elementMarkup(markup, tagsOf(markup), layerIndex(tagsOf(markup), "debug-regions")),
      ),
    ).toEqual(expected);
  });
});

describe("the depth layer overlay", () => {
  const markup = renderSvg(sceneIR({ debug: only("showDepthMap") }));
  const paths = layerPaths(markup, "debug-depth");

  it("gives every region one rank per distinct zIndex", () => {
    expect(paths.map((path) => path["data-region-id"])).toEqual([
      "sky",
      "hill",
      "field",
    ]);
    expect(paths.map((path) => path["data-depth-rank"])).toEqual(["0", "1", "2"]);
  });

  it("darkens the tint as the depth rank grows", () => {
    const opacities = paths.map((path) => Number(path["fill-opacity"]));
    expect(opacities).toEqual([...opacities].sort((left, right) => left - right));
    expect(opacities[0]).toBeLessThan(opacities[opacities.length - 1]!);
  });

  it("gives regions of one zIndex one shared rank", () => {
    const template = sceneIR().regions[0]!;
    const tied = sceneIR({
      debug: only("showDepthMap"),
      regions: [
        { ...template, id: "a", zIndex: 5 },
        { ...template, id: "b", zIndex: 5 },
        { ...template, id: "c", zIndex: 9 },
      ],
    });
    expect(
      layerPaths(renderSvg(tied), "debug-depth").map(
        (path) => path["data-depth-rank"],
      ),
    ).toEqual(["0", "0", "1"]);
  });

  it("draws every rank in one shade", () => {
    expect(new Set(paths.map((path) => path["fill"])).size).toBe(1);
  });
});

describe("the hatch direction map", () => {
  const markup = renderSvg(sceneIR({ debug: only("showHatchDirections") }));
  const arrows = layerPaths(markup, "debug-hatch-directions");

  it("draws one arrow per line system, and none for negative space", () => {
    // sky: one hatch family; hill: none; field: one hatch family.
    expect(arrows.map((arrow) => arrow["data-region-id"])).toEqual([
      "sky",
      "field",
    ]);
  });

  it("reports the angle and the spacing of the fill style", () => {
    expect(arrows[0]).toMatchObject({
      "data-region-id": "sky",
      "data-family": "a",
      "data-angle": "15",
      "data-spacing": "8",
    });
    expect(arrows[1]).toMatchObject({
      "data-region-id": "field",
      "data-family": "a",
      "data-angle": "0",
      "data-spacing": "7",
    });
  });

  it("draws both families of a crosshatch, family A first", () => {
    const crossed = sceneIR({ debug: only("showHatchDirections") });
    crossed.regions = crossed.regions.map((region) =>
      region.id === "sky"
        ? {
            ...region,
            fillStyle: {
              type: "crosshatch",
              angleA: 45,
              angleB: 135,
              spacingA: 8,
              spacingB: 10,
              stroke: "#3a342e",
              weight: 0.5,
              jitter: 0.3,
            },
          }
        : region,
    );
    expect(
      layerPaths(renderSvg(crossed), "debug-hatch-directions").filter(
        (arrow) => arrow["data-region-id"] === "sky",
      ),
    ).toEqual([
      expect.objectContaining({ "data-family": "a", "data-angle": "45" }),
      expect.objectContaining({ "data-family": "b", "data-angle": "135" }),
    ]);
  });

  it("points the arrow along the angle the strokes run", () => {
    // The field hatch runs at 0 degrees, so the shaft is horizontal and the
    // tip sits right of the tail.
    const values = pathDataValues(
      elementMarkup(
        markup,
        tagsOf(markup),
        layerIndex(tagsOf(markup), "debug-hatch-directions"),
      ),
    );
    // The shaft opens the path, so its relative end must run flat and
    // right of the tail it leaves.
    const [tailX, , shaftDx, shaftDy] = values[1]!
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    expect(shaftDy).toBe(0);
    expect(tailX! + shaftDx!).toBeGreaterThan(tailX!);
  });
});

describe("the negative-space map", () => {
  const ir = sceneIR({ debug: only("showNegativeSpace") });
  const markup = renderSvg(ir);
  const paths = layerPaths(markup, "debug-negative-space");

  it("covers every mask and every region of pure negative space", () => {
    expect(
      paths.map((path) => path["data-mask-id"] ?? path["data-region-id"]),
    ).toEqual(["cloud-1", "hill"]);
  });

  it("marks the sense of each mask and the emptiness of each region", () => {
    expect(paths[0]).toMatchObject({
      "data-mask-id": "cloud-1",
      "data-invert": "true",
    });
    expect(paths[1]).toMatchObject({
      "data-region-id": "hill",
      "data-unfilled": "true",
    });
  });

  it("tints the emptiness, so it reads as a shape and not an edge", () => {
    expect(paths.every((path) => path["fill-opacity"] === "0.18")).toBe(true);
    expect(paths.every((path) => path["stroke-dasharray"] === "4 3")).toBe(true);
  });
});

describe("the object anchors", () => {
  const markup = renderSvg(sceneIR({ debug: only("showAnchors") }));
  const markers = layerPaths(markup, "debug-anchors");

  it("marks every anchor of the intermediate representation", () => {
    expect(markers.map((marker) => marker["data-object-id"])).toEqual(
      sceneAnchors().map((anchor) => anchor.objectId),
    );
  });

  it("carries the kind, the role, and the depth of each object", () => {
    expect(markers[0]).toMatchObject({
      "data-kind": "tree",
      "data-role": "midground",
      "data-depth": "1",
      "data-depth-index": "0",
    });
  });

  it("names the objects the planner had to clamp onto the canvas", () => {
    expect(
      markers
        .filter((marker) => marker["data-position-clamped"] === "true")
        .map((marker) => marker["data-object-id"]),
    ).toEqual(["cottage-1"]);
  });

  it("opens each marker at the anchor, on a ring sized by the scale", () => {
    // The ring of a marker opens at the rightmost point of its circle, so the
    // first move names both where the anchor sits and how wide the ring is.
    const [tree, cottage] = markers.map(
      (marker) => marker["d"] ?? "",
    );
    expect(firstMove(tree!)).toBe("M 105 168");
    expect(firstMove(cottage!)).toBe("M 237.5 150");
  });
});

describe("the construction lines", () => {
  const markup = renderSvg(
    sceneIR({ horizonY: 140, debug: only("showConstructionLines") }),
  );
  const tokens = tagsOf(markup);
  const guides = layerPaths(markup, "debug-construction");

  it("frames the canvas", () => {
    const frame = tagsOf(
      elementMarkup(markup, tokens, layerIndex(tokens, "debug-construction")),
    ).find((token) => token.name === "rect");
    expect(frame?.attributes).toMatchObject({
      "data-guide": "canvas",
      width: "320",
      height: "240",
      fill: "none",
    });
  });

  it("draws the horizon across the whole canvas width", () => {
    const horizon = guides.find((guide) => guide["data-guide"] === "horizon");
    expect(horizon?.["d"]).toBe("M 0 140l 320 0");
  });

  it("outlines every region clip extent it names", () => {
    expect(
      guides
        .filter((guide) => guide["data-guide"] === "clip-extent")
        .map((guide) => guide["data-region-id"]),
    ).toEqual(["sky"]);
  });

  it("runs one horizontal and one vertical axis through each anchor", () => {
    expect(
      guides
        .filter((guide) => guide["data-guide"] === "anchor-axis")
        .map((guide) => guide["data-object-id"]),
    ).toEqual(["tree-1", "tree-1", "cottage-1", "cottage-1"]);
  });

  it("leaves the horizon out when the plan carried none", () => {
    const withoutHorizon = renderSvg(
      sceneIR({ debug: only("showConstructionLines") }),
    );
    expect(guidesOf(withoutHorizon).some((guide) => guide["data-guide"] === "horizon")).toBe(
      false,
    );
  });

  /** The guide paths of one construction layer. */
  function guidesOf(markup2: string): Record<string, string>[] {
    return layerPaths(markup2, "debug-construction");
  }
});

describe("the contour-only preview", () => {
  const ir = sceneIR({ debug: only("showContourOnly") });
  const markup = renderSvg(ir);
  const tokens = tagsOf(markup);
  const layer = elementMarkup(
    markup,
    tokens,
    layerIndex(tokens, "debug-contour-only"),
  );

  it("washes the canvas in the paper color before it draws", () => {
    const first = tagsOf(layer).find((token) => token.name === "rect");
    expect(first).toBeDefined();
    expect(first?.attributes).toMatchObject({
      "data-wash": "paper",
      width: "320",
      height: "240",
      fill: ir.style.palette.paper,
    });
  });

  it("redraws every contour stroke on top of the wash", () => {
    expect(pathDataValues(layer)).toEqual(
      ir.contours.map((contour) => pathData(contour.path)),
    );
    expect(layer).toContain(`stroke="${ir.contours[0]!.color}"`);
    expect(layer).toContain(`stroke-width="${ir.contours[0]!.weight}"`);
  });

  it("hides the artwork without removing it from the document", () => {
    // The region stack, its masks, and the symbol placements all stay, and
    // the wash covers them at composite time - the same rule a cloud cutout
    // follows (specification section 7).
    for (const layerName of ["regions", "contours", "symbols"]) {
      expect(markup).toContain(`data-layer="${layerName}"`);
    }
    expect(beforeOverlays(markup)).toBe(beforeOverlays(renderSvg(sceneIR())));
  });
});
