/**
 * Symbol marks (specification sections 7, 11, and 22).
 *
 * A symbol placement is a reference, not a copy: the intermediate
 * representation carries the marks in its `symbolLibrary`, the placements
 * name them by `symbolId`, and the renderer resolves the two. Every
 * placement that survives validation therefore draws a defined mark, never
 * a `use` element that names nothing and renders nothing.
 *
 * Each definition becomes one `g` element inside `<defs>`, not an SVG
 * `symbol` element. A `use` that names a `symbol` instantiates a nested
 * viewport that defaults to 100 percent of the canvas, which clips and
 * stretches a mark authored in local units: a stroke at a negative local
 * coordinate disappears. A `g` definition carries no viewport, so the
 * mark's local units reach the page verbatim under the placement's
 * transform, whatever origin the mark was drawn around.
 */

import type { RenderIR, SymbolDefinition, SymbolPlacement } from "@hatch/core";

import { element, type XmlElement } from "./xml.js";
import { pathData } from "./path-data.js";

/**
 * Build the definition element of one mark: a `g` with the allocated id.
 *
 * The strokes stay plain line marks: no fill, round line caps, one ink and
 * one weight each, so a placed mark reads like the rest of the drawing.
 */
export function symbolElement(definition: SymbolDefinition, id: string): XmlElement {
  return element(
    "g",
    [
      { name: "id", value: id },
      { name: "fill", value: "none" },
      { name: "stroke-linecap", value: "round" },
    ],
    ...definition.strokes.map((stroke) =>
      element("path", [
        { name: "d", value: pathData(stroke.path) },
        { name: "stroke", value: stroke.color },
        { name: "stroke-width", value: stroke.weight },
      ]),
    ),
  );
}

/**
 * The library entries one render places, in library order.
 *
 * The library is the definition source, the placements decide what the
 * document carries: an entry no placement names adds no definition to the
 * output, so a scene without symbols stays free of symbol `defs`.
 */
export function placedDefinitions(ir: RenderIR): SymbolDefinition[] {
  const placed = new Set(ir.symbols.map((placement) => placement.symbolId));
  return ir.symbolLibrary.filter((definition) => placed.has(definition.id));
}

/**
 * The id a placement's `use` references for one definition id.
 *
 * The schema already rejects a placement without a definition, so this only
 * guards a caller that draws an unvalidated representation.
 */
export function placedSymbolId(
  placement: SymbolPlacement,
  ids: ReadonlyMap<string, string>,
): string {
  const id = ids.get(placement.symbolId);
  if (id === undefined) {
    throw new Error(
      `cannot place symbol "${placement.symbolId}": no definition owns the id`,
    );
  }
  return id;
}
