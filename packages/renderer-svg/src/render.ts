/**
 * The SVG region renderer (specification sections 7, 11, and 12).
 *
 * One {@link RenderIR} enters, one SVG document leaves. The document is the
 * region stack of specification section 7, in draw order:
 *
 * 1. the embedded metadata block,
 * 2. the mask, clip, and symbol definitions,
 * 3. the paper background,
 * 4. the regions, stacked by `zIndex`, each filled with the strokes of the
 *    @hatch/hatching engine,
 * 5. the cloud cutout masks, wrapped around the whole region stack as
 *    negative space,
 * 6. the contour strokes on top,
 * 7. the symbol placements, each a `use` that resolves to a definition of
 *    the symbol library,
 * 8. the debug overlays of the spec's `debug` block, each flag one layer,
 *    outside every mask wrapper.
 *
 * Determinism (specification section 10): the renderer derives one seeded
 * stream from the render identity of the trace and hands it to the hatching
 * engine, which forks one stream per region. Nothing else in this module
 * draws a random number, so the same intermediate representation always
 * serializes to the same bytes.
 */

import type {
  ContourStroke,
  RenderIR,
  Region,
  SeededRng,
  SymbolPlacement,
  Texture,
} from "@hatch/core";
import {
  createStageRng,
  formatIssues,
  regionsInDrawOrder,
  RenderIRSchema,
} from "@hatch/core";
import { hatchRegions, type HatchSet } from "@hatch/hatching";

import { formatNumber } from "./format.js";
import { debugOverlayLayers } from "./debug.js";
import { IdAllocator } from "./ids.js";
import { clipPathElement, maskElement, urlReference } from "./masks.js";
import { metadataElement } from "./metadata.js";
import { pathData } from "./path-data.js";
import { hatchFitTolerance, hatchStrokeRuns } from "./strokes.js";
import { placedDefinitions, placedSymbolId, symbolElement } from "./symbols.js";
import { element, serializeXml, type XmlElement } from "./xml.js";

/** The SVG namespace of the root element. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** One allocated definition: its id and the element that carries it. */
interface Def {
  id: string;
  node: XmlElement;
}

/** One clip definition plus the region it clips. */
interface ClipDef extends Def {
  regionId: string;
}

/**
 * The render-stage stream of one render (specification sections 9 and 10).
 *
 * The stream derives from the identity the trace already carries, so two
 * renders that share version, seed, preset, and spec hash share their hatch
 * strokes. The engine pipeline passes its own stream when it owns one.
 */
export function createRenderRng(ir: RenderIR): SeededRng {
  return createStageRng(
    {
      compilerVersion: ir.trace.compilerVersion,
      seed: ir.trace.seed,
      stylePreset: ir.trace.preset,
      specHash: ir.trace.specHash,
    },
    "render",
  );
}

/** The stroke sets of one render, keyed by region id. */
function strokeSetsByRegion(
  ir: RenderIR,
  rng: SeededRng,
): Map<string, HatchSet> {
  const sets = hatchRegions(ir.regions, ir.style, rng);
  return new Map(sets.map((set) => [set.regionId, set]));
}

/** The clip-path definitions of every region that carries a clip extent. */
function clipDefs(regions: readonly Region[], allocator: IdAllocator): ClipDef[] {
  const clipped = regions.filter(
    (region): region is Region & { clip: NonNullable<Region["clip"]> } =>
      region.clip !== undefined,
  );
  return clipped.map((region) => {
    const id = allocator.take("clip", region.id);
    return {
      id,
      regionId: region.id,
      node: clipPathElement(id, region.clip),
    };
  });
}

/** The mask definitions of one render, in input order. */
function maskDefs(ir: RenderIR, allocator: IdAllocator): Def[] {
  return ir.masks.map((mask) => {
    const id = allocator.take("m", mask.id);
    return { id, node: maskElement(mask, id, ir.canvas) };
  });
}

/**
 * The symbol definitions one render places, and their raw ids.
 *
 * The raw `id` of a definition is the `symbolId` a placement names; the
 * allocated id is what the emitted `use` references, so a raw id that
 * sanitizes like another one still resolves to its own definition.
 */
function symbolDefs(
  ir: RenderIR,
  allocator: IdAllocator,
): { defs: Def[]; idsBySymbolId: Map<string, string> } {
  const defs: Def[] = [];
  const idsBySymbolId = new Map<string, string>();
  for (const definition of placedDefinitions(ir)) {
    const id = allocator.take("sym", definition.id);
    defs.push({ id, node: symbolElement(definition, id) });
    idsBySymbolId.set(definition.id, id);
  }
  return { defs, idsBySymbolId };
}

/** The paper background rectangle (specification sections 3A and 7). */
function paperRect(ir: RenderIR): XmlElement {
  return element("rect", [
    { name: "data-layer", value: "paper" },
    { name: "x", value: 0 },
    { name: "y", value: 0 },
    { name: "width", value: ir.canvas.width },
    { name: "height", value: ir.canvas.height },
    { name: "fill", value: ir.style.palette.paper },
  ]);
}

/** One hatch stroke as a path element. Strokes never fill. */
function strokePath(d: string, weight: number): XmlElement {
  return element("path", [
    { name: "d", value: d },
    { name: "stroke-width", value: weight },
  ]);
}

/**
 * One region group: the strokes of its fill, clipped to its extent.
 *
 * Every stroke of one fill draws in the same ink, so the group carries the
 * colour once, and the strokes that share a width share one path element. A
 * `none` fill region keeps its group with no children, so the stack shows
 * where the negative space sits.
 */
function regionGroup(
  region: Region,
  set: HatchSet,
  texture: Texture,
  clipId?: string,
): XmlElement {
  const tolerance = hatchFitTolerance(region.fillStyle, texture);
  const attributes = [
    { name: "data-region-id", value: region.id },
    ...(region.role === undefined
      ? []
      : [{ name: "data-role", value: region.role }]),
    { name: "data-zindex", value: region.zIndex },
    ...(clipId === undefined
      ? []
      : [{ name: "clip-path", value: urlReference(clipId) }]),
    { name: "fill", value: "none" },
    ...(set.strokes.length === 0
      ? []
      : [{ name: "stroke", value: set.strokes[0]!.color }]),
    { name: "stroke-linecap", value: "round" },
  ];
  return element(
    "g",
    attributes,
    ...hatchStrokeRuns(set, tolerance).map((run) =>
      strokePath(run.data, run.weight),
    ),
  );
}

/** The contour layer, on top of every hatch field (specification section 7). */
function contourLayer(contours: readonly ContourStroke[]): XmlElement {
  return element(
    "g",
    [
      { name: "data-layer", value: "contours" },
      { name: "fill", value: "none" },
      { name: "stroke-linecap", value: "round" },
      { name: "stroke-linejoin", value: "round" },
    ],
    ...contours.map((contour) =>
      element("path", [
        { name: "d", value: pathData(contour.path) },
        { name: "stroke", value: contour.color },
        { name: "stroke-width", value: contour.weight },
        ...(contour.role === undefined
          ? []
          : [{ name: "data-role", value: contour.role }]),
      ]),
    ),
  );
}

/**
 * One symbol placement as a `use` element.
 *
 * The reference points at the allocated id of the definition the placement
 * names, so every `use` in the document resolves to a defined mark.
 */
function symbolUse(
  symbol: SymbolPlacement,
  idsBySymbolId: ReadonlyMap<string, string>,
): XmlElement {
  const transform = [
    `translate(${symbol.position.x} ${symbol.position.y})`,
    ...(symbol.rotation === undefined ? [] : [`rotate(${symbol.rotation})`]),
    `scale(${symbol.scale})`,
  ].join(" ");
  return element("use", [
    { name: "href", value: `#${placedSymbolId(symbol, idsBySymbolId)}` },
    { name: "transform", value: transform },
  ]);
}

/**
 * Wrap one layer in one nested `mask` group per mask.
 *
 * Every mask applies to the whole region stack, which is how a cloud cutout
 * carves negative space out of the hatching beneath it. Nested masked groups
 * intersect, so several masks combine without one mask brightening another.
 */
function maskWrappers(layer: XmlElement, masks: readonly Def[]): XmlElement {
  let wrapped = layer;
  for (const mask of masks) {
    wrapped = element(
      "g",
      [{ name: "mask", value: urlReference(mask.id) }],
      wrapped,
    );
  }
  return wrapped;
}

/** An empty stroke set for a region the engine left no set for. */
function emptySet(region: Region): HatchSet {
  return {
    regionId: region.id,
    ...(region.role === undefined ? {} : { role: region.role }),
    kind: "none",
    zIndex: region.zIndex,
    strokes: [],
    droppedStrokeCount: 0,
    strokeLength: 0,
    fillArea: 0,
    density: 0,
  };
}

/** The root element of one render, beside the strokes it draws. */
function svgDocument(
  ir: RenderIR,
  rng: SeededRng,
): { root: XmlElement; strokeCount: number; strokeLength: number } {
  const allocator = new IdAllocator();
  const clips = clipDefs(ir.regions, allocator);
  const masks = maskDefs(ir, allocator);
  const symbols = symbolDefs(ir, allocator);
  const defs: Def[] = [...clips, ...masks, ...symbols.defs];
  const clipIds = new Map(clips.map((clip) => [clip.regionId, clip.id]));
  const sets = strokeSetsByRegion(ir, rng);
  const strokeCount = sets.size
    ? [...sets.values()].reduce((total, set) => total + set.strokes.length, 0)
    : 0;
  const strokeLength = sets.size
    ? [...sets.values()].reduce((total, set) => total + set.strokeLength, 0)
    : 0;

  const regionsLayer = element(
    "g",
    [{ name: "data-layer", value: "regions" }],
    ...regionsInDrawOrder(ir.regions).map((region) =>
      regionGroup(
        region,
        sets.get(region.id) ?? emptySet(region),
        ir.style.texture,
        clipIds.get(region.id),
      ),
    ),
  );

  const root = element(
    "svg",
    [
      { name: "xmlns", value: SVG_NS },
      { name: "width", value: ir.canvas.width },
      { name: "height", value: ir.canvas.height },
      {
        name: "viewBox",
        value: `0 0 ${formatNumber(ir.canvas.width)} ${formatNumber(ir.canvas.height)}`,
      },
    ],
    metadataElement(ir.trace),
    ...(defs.length === 0
      ? []
      : [element("defs", [], ...defs.map((def) => def.node))]),
    paperRect(ir),
    maskWrappers(regionsLayer, masks),
    ...(ir.contours.length === 0 ? [] : [contourLayer(ir.contours)]),
    ...(ir.symbols.length === 0
      ? []
      : [
          element(
            "g",
            [{ name: "data-layer", value: "symbols" }],
            ...ir.symbols.map((placement) =>
              symbolUse(placement, symbols.idsBySymbolId),
            ),
          ),
        ]),
    // The debug overlays draw last and outside every mask wrapper, so they
    // stay visible over the artwork they explain (specification section 9).
    ...debugOverlayLayers(ir),
  );
  return { root, strokeCount, strokeLength };
}

/**
 * What one render produced: the document and its ink facts.
 *
 * The stroke count is the number of hatch strokes the document draws, one
 * per region fill line, and the stroke length is their total length in user
 * units, which the trace divides by the canvas area for the visual density
 * score (specification section 9E). Contour strokes and symbol marks sit in
 * their own layers, so they stay out of both numbers.
 */
export interface RenderedSvg {
  /** The SVG document, XML declaration included. */
  readonly svg: string;
  /** How many hatch strokes the document draws. */
  readonly strokeCount: number;
  /** Total length of the hatch strokes, in user units. */
  readonly strokeLength: number;
}

/**
 * Render one intermediate representation and report its output metrics.
 *
 * The engine pipeline calls this entry, because it needs the stroke count
 * and the stroke length for the render trace (specification section 9E)
 * without walking the markup. The document is the one {@link renderSvg}
 * writes, byte for byte.
 */
export function renderSvgDocument(
  ir: RenderIR,
  rng: SeededRng = createRenderRng(ir),
): RenderedSvg {
  const parsed = RenderIRSchema.safeParse(ir);
  if (!parsed.success) {
    throw new Error(
      `renderSvg needs a valid RenderIR: ${formatIssues(parsed.error.issues)}`,
    );
  }
  const { root, strokeCount, strokeLength } = svgDocument(parsed.data, rng);
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXml(root)}`,
    strokeCount,
    strokeLength,
  };
}

/**
 * Render one intermediate representation as an SVG document.
 *
 * The document starts with an XML declaration, so it survives being written
 * to a `.svg` file and read back by an exporter (specification section 12).
 * The region ids must be unique, because they name the hatch stream and the
 * clip path of their region; the hatching engine enforces that.
 *
 * Only the validated value is drawn. Parsing is where the schema fills its
 * defaults, so a mask that omits `invert` reaches the mask builder as the
 * documented default `true`, never as `undefined`. Drawing the raw input
 * instead would read that absent field as `false` and invert the mask.
 * Parsing is also where the schema rejects a symbol placement that names no
 * definition of the symbol library, so the renderer never emits a dangling
 * `use` reference.
 */
export function renderSvg(
  ir: RenderIR,
  rng: SeededRng = createRenderRng(ir),
): string {
  return renderSvgDocument(ir, rng).svg;
}
