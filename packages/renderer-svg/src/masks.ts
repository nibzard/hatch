/**
 * Masks and clip paths (specification sections 7 and 12).
 *
 * A cloud cutout is negative space: the strokes of the sky pass under the
 * cloud, and the mask hides exactly that part, so the paper background
 * shows through (specification sections 3C, 7, and 24). SVG masks work on
 * luminance, so the mask content is pure white and pure black, whatever the
 * palette of the scene:
 *
 * - `invert: true` (the default) paints the whole canvas white and the mask
 *   path black. Everything under the path disappears, which carves the
 *   path out of the hatching.
 * - `invert: false` paints the canvas black and the mask path white. Only
 *   what sits under the path survives.
 *
 * A region `clip` becomes an SVG `clipPath`. The hatching engine already
 * holds every stroke inside the clip extent, so the clip path is a second
 * lock on the same door: it keeps the drawn group honest even when later
 * stages add overlays inside it.
 */

import type { Canvas, Mask, Path } from "@hatch/core";

import { element, type XmlElement } from "./xml.js";
import { pathData } from "./path-data.js";

/** Luminance that leaves content visible. */
const REVEAL = "#ffffff";

/** Luminance that hides content. */
const HIDE = "#000000";

/** One full-canvas rectangle in mask luminance `fill`. */
function canvasRect(canvas: Canvas, fill: string): XmlElement {
  return element("rect", [
    { name: "x", value: 0 },
    { name: "y", value: 0 },
    { name: "width", value: canvas.width },
    { name: "height", value: canvas.height },
    { name: "fill", value: fill },
  ]);
}

/** One filled path in mask luminance `fill`. */
function luminancePath(path: Path, fill: string): XmlElement {
  return element("path", [
    { name: "d", value: pathData(path) },
    { name: "fill", value: fill },
  ]);
}

/**
 * Build the `<mask>` element of one mask.
 *
 * `maskUnits` is `userSpaceOnUse` and the mask region is the full canvas,
 * so a mask cannot shrink to the bounding box of its content and let the
 * hatching leak back in at the edges.
 */
export function maskElement(
  mask: Mask,
  id: string,
  canvas: Canvas,
): XmlElement {
  const inverted = mask.invert;
  return element(
    "mask",
    [
      { name: "id", value: id },
      { name: "maskUnits", value: "userSpaceOnUse" },
      { name: "x", value: 0 },
      { name: "y", value: 0 },
      { name: "width", value: canvas.width },
      { name: "height", value: canvas.height },
    ],
    canvasRect(canvas, inverted ? REVEAL : HIDE),
    luminancePath(mask.path, inverted ? HIDE : REVEAL),
  );
}

/** Build the `<clipPath>` element that holds one region clip extent. */
export function clipPathElement(id: string, path: Path): XmlElement {
  return element(
    "clipPath",
    [
      { name: "id", value: id },
      { name: "clipPathUnits", value: "userSpaceOnUse" },
    ],
    element("path", [{ name: "d", value: pathData(path) }]),
  );
}

/** The attribute value that references one defs element by id. */
export function urlReference(id: string): string {
  return `url(#${id})`;
}
