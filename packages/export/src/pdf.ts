/**
 * SVG to vector PDF export (task T030, specification sections 11 and 12).
 *
 * SVG stays the canonical output (specification section 12). A PDF is a
 * derived print document: one translation of the same vector geometry, not
 * a second rendering path and never a raster of it. Every stroke of the
 * hatching arrives as a PDF path operator, so the lines stay crisp at any
 * print scale.
 *
 * The converter reads the grammar `@hatch/renderer-svg` writes and says no
 * to the rest with named errors:
 *
 * - the path commands of SVG, including arcs, which become cubic curves;
 * - rectangles and the basic shapes `line`, `polyline`, `polygon`,
 *   `circle`, and `ellipse`;
 * - groups with the inherited stroke properties the renderer sets;
 * - `clipPath` definitions, applied as PDF clipping paths;
 * - luminance `mask` definitions. The renderer paints every mask as one
 *   pure-white or pure-black base rectangle plus one pure path, and a
 *   mask of that shape hides or keeps exactly one region of the canvas,
 *   so an even-odd clip states the same result without transparency
 *   operators. A mask outside that grammar fails with a named error
 *   instead of approximating luminance;
 * - `use` placements of `g` definitions, under their transform.
 *
 * Determinism (specification section 10) has three rules here:
 *
 * 1. The converter writes no object that could vary by machine: no
 *    timestamp, no font, no compressed stream that a library version
 *    could change, no random object id.
 * 2. One SVG user unit becomes one PDF point by default; {@link PdfFit}
 *    names a page size and nothing else, and the other edge always
 *    follows the aspect ratio of the document.
 * 3. The same SVG bytes under the same options give the same PDF bytes,
 *    cross-reference offsets included, because every object reaches the
 *    file in one fixed order.
 *
 * A PDF page measures in points and counts y upward from the bottom, so
 * the page content opens with the one matrix that flips the document into
 * place; every coordinate after it is the SVG's own.
 *
 * A fit request the page could not honour - a width of zero, a mode no
 * {@link PdfFit} documents - is rejected with a named error, the way the
 * grammar above is: a caller that asked for a 612 point page must learn
 * that it did not get one.
 */

import { Buffer } from "node:buffer";

import type { PathCommand, Point } from "@hatch/core";

import {
  formatPdfNumber,
  parseColor,
  parsePathData,
  parseTransform,
  type Matrix,
  type SvgColor,
} from "./pdf-graphics.js";
import { buildPdfFile, PDF_INFO_BODY } from "./pdf-file.js";
import { parseXml, type XmlElement, type XmlNode } from "./xml.js";

/** How one export maps the user units of a document onto PDF points. */
export type PdfFit =
  /** One PDF point per user unit of the document's own size. */
  | { readonly mode: "original" }
  /**
   * A page width in points. The height follows the aspect ratio of the
   * document.
   */
  | { readonly mode: "width"; readonly value: number }
  /**
   * A page height in points. The width follows the aspect ratio of the
   * document.
   */
  | { readonly mode: "height"; readonly value: number }
  /** A scale factor against the document's own size, for example 0.5. */
  | { readonly mode: "zoom"; readonly value: number };

/** The options of one PDF export. Every other setting stays pinned. */
export interface SvgToPdfOptions {
  /**
   * The page size of the export, in PDF points. Defaults to `original`,
   * so a 1024 x 768 scene exports as a 1024 x 768 point page.
   */
  readonly fit?: PdfFit;
}

/** What one PDF export produced. */
export interface RenderedPdf {
  /** The PDF file bytes, ready to write to disk as they are. */
  readonly pdf: Uint8Array;
  /** The page width in points, as the MediaBox states it. */
  readonly width: number;
  /** The page height in points, as the MediaBox states it. */
  readonly height: number;
  /** How many path paintings stroked lines: the vector strokes of the file. */
  readonly strokeCount: number;
  /** How many path paintings filled areas, for example the paper. */
  readonly fillCount: number;
}

/** Black in the 0 to 1 channels of PDF. */
const BLACK: SvgColor = { kind: "rgb", rgb: [0, 0, 0] };

/** The inherited paint state one element hands to its children. */
interface PaintState {
  readonly fill: SvgColor;
  readonly stroke: SvgColor;
  readonly strokeWidth: number;
  readonly lineCap: 0 | 1 | 2;
  readonly lineJoin: 0 | 1 | 2;
  readonly dash: readonly number[] | undefined;
}

/** The paint state the root element starts from. */
const INITIAL_STATE: PaintState = {
  fill: BLACK,
  stroke: { kind: "none" },
  strokeWidth: 1,
  lineCap: 0,
  lineJoin: 0,
  dash: undefined,
};

/** One RGB triple as PDF writes it, `undefined` when no color is set. */
type Rgb = readonly [number, number, number] | undefined;

/** The value of one attribute, or `undefined` when absent. */
function attributeOf(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)
    ?.value;
}

/** True when an attribute never changes what the PDF draws. */
function isInformativeAttribute(name: string): boolean {
  return (
    name === "xmlns" ||
    name.startsWith("xmlns:") ||
    name === "id" ||
    name === "class" ||
    name.startsWith("data-")
  );
}

/**
 * Fail on every attribute this converter neither draws nor knowingly
 * ignores.
 *
 * A converter that quietly dropped `opacity`, `filter`, or `style` would
 * export a document that looks near enough while drawing something else,
 * which is the failure mode this package refuses (see {@link svgToPng}).
 */
function rejectUnhandledAttributes(element: XmlElement, handled: readonly string[]): void {
  for (const attribute of element.attributes) {
    if (handled.includes(attribute.name) || isInformativeAttribute(attribute.name)) {
      continue;
    }
    throw new Error(
      `svgToPdf cannot convert the <${element.name}> attribute ` +
        `"${attribute.name}"="${attribute.value}": it changes the drawing ` +
        "and this converter has no PDF translation for it",
    );
  }
}

/** Parse one attribute value that must be a plain decimal number. */
function strictNumber(name: string, value: string): number {
  const text = value.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    throw new Error(`the "${name}" value "${value}" is not a plain number`);
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`the "${name}" value "${value}" is not a plain number`);
  }
  return parsed;
}

/** Parse one finite number attribute. */
function numberAttributeOf(element: XmlElement, name: string): number {
  const value = attributeOf(element, name);
  if (value === undefined) {
    throw new Error(`the <${element.name}> element needs a "${name}" number`);
  }
  return strictNumber(name, value);
}

/** The intrinsic size of one document, from its `width` and `height`. */
interface DocumentSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Read the size of one document.
 *
 * The converter draws in the document's own user units, so the page keeps
 * the aspect ratio the scene asked for. A `viewBox` must restate the
 * `width` and `height` at origin zero, which is the one form the renderer
 * writes; a translated or differently sized viewBox is a document this
 * converter cannot map without a scaling policy of its own.
 */
function documentSizeOf(root: XmlElement): DocumentSize {
  rejectUnhandledAttributes(root, ["width", "height", "viewBox"]);
  const width = numberAttributeOf(root, "width");
  const height = numberAttributeOf(root, "height");
  if (width <= 0 || height <= 0) {
    throw new Error(
      `the document must have a positive size, got ${width} x ${height}`,
    );
  }
  const viewBox = attributeOf(root, "viewBox");
  if (viewBox !== undefined) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const [minX, minY, boxWidth, boxHeight] = parts;
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isFinite(part)) ||
      minX !== 0 ||
      minY !== 0 ||
      boxWidth !== width ||
      boxHeight !== height
    ) {
      throw new Error(
        `the viewBox "${viewBox}" must restate the size at origin zero: ` +
          `"0 0 ${width} ${height}"`,
      );
    }
  }
  return { width, height };
}

/**
 * Reject a fit mode outside the set {@link PdfFit} documents, by name.
 *
 * A TypeScript caller cannot write one, but a JavaScript caller or a JSON
 * options block can. The scale lookup below names every mode it knows and
 * reads the rest as `height`, so a typo would ask for a page one point
 * tall instead of failing; the mode is checked before any value is.
 */
function checkedMode(mode: unknown): void {
  switch (mode) {
    case "original":
    case "width":
    case "height":
    case "zoom":
      return;
    default:
      throw new Error(
        `a PDF fit mode must be one of "original", "width", "height", or ` +
          `"zoom", got "${mode}"`,
      );
  }
}

/** Reject a fit request that names no usable page size. */
function fitScale(fit: PdfFit, size: DocumentSize): number {
  checkedMode(fit.mode);
  if (fit.mode === "original") {
    return 1;
  }
  const { mode, value } = fit;
  if (!Number.isFinite(value)) {
    throw new Error(
      `a PDF fit of "${mode}" needs a finite ` +
        `${mode === "zoom" ? "scale factor" : "number of points"}, got ${value}`,
    );
  }
  if (mode === "zoom") {
    if (value <= 0) {
      throw new Error(
        `a PDF fit of "zoom" needs a positive scale factor, got ${value}`,
      );
    }
    return value;
  }
  if (value <= 0) {
    throw new Error(
      `a PDF fit of "${mode}" needs a positive number of points, got ${value}`,
    );
  }
  return mode === "width" ? value / size.width : value / size.height;
}

/**
 * The content stream writer.
 *
 * The writer tracks the graphics state the PDF already holds and emits an
 * operator only when the value changes, so a region of strokes names each
 * colour and weight once. `q` and `Q` bracket that shadow state the same
 * way they bracket the real one.
 */
class ContentStream {
  private readonly lines: string[] = [];
  private readonly saved: Array<{
    readonly strokeRgb: Rgb;
    readonly fillRgb: Rgb;
    readonly width: number;
    readonly cap: 0 | 1 | 2;
    readonly join: 0 | 1 | 2;
    readonly dash: readonly number[] | undefined;
  }> = [];
  private strokeRgb: Rgb = undefined;
  private fillRgb: Rgb = [0, 0, 0];
  private width = 1;
  private cap: 0 | 1 | 2 = 0;
  private join: 0 | 1 | 2 = 0;
  private dash: readonly number[] | undefined;
  /** How many paintings stroked lines. */
  strokeCount = 0;
  /** How many paintings filled areas. */
  fillCount = 0;

  /** Open one nested graphics state. */
  save(): void {
    this.lines.push("q");
    this.saved.push({
      strokeRgb: this.strokeRgb,
      fillRgb: this.fillRgb,
      width: this.width,
      cap: this.cap,
      join: this.join,
      dash: this.dash,
    });
  }

  /** Close one nested graphics state the shadow still mirrors. */
  restore(): void {
    this.lines.push("Q");
    const restored = this.saved.pop();
    if (restored) {
      this.strokeRgb = restored.strokeRgb;
      this.fillRgb = restored.fillRgb;
      this.width = restored.width;
      this.cap = restored.cap;
      this.join = restored.join;
      this.dash = restored.dash;
    }
  }

  /** Concatenate one matrix onto the current transformation. */
  transform(matrix: Matrix): void {
    this.lines.push(`${matrix.map(formatPdfNumber).join(" ")} cm`);
  }

  /** Name the stroke colour, `0.1 0.2 0.3 RG`. */
  setStroke(rgb: Rgb): void {
    if (rgb === undefined || sameRgb(rgb, this.strokeRgb)) {
      return;
    }
    this.lines.push(`${rgb.map(formatPdfNumber).join(" ")} RG`);
    this.strokeRgb = rgb;
  }

  /** Name the fill colour, `0.1 0.2 0.3 rg`. */
  setFill(rgb: Rgb): void {
    if (rgb === undefined || sameRgb(rgb, this.fillRgb)) {
      return;
    }
    this.lines.push(`${rgb.map(formatPdfNumber).join(" ")} rg`);
    this.fillRgb = rgb;
  }

  /** Name the line width. */
  setWidth(value: number): void {
    if (value === this.width) {
      return;
    }
    this.lines.push(`${formatPdfNumber(value)} w`);
    this.width = value;
  }

  /** Name the line cap. */
  setCap(value: 0 | 1 | 2): void {
    if (value === this.cap) {
      return;
    }
    this.lines.push(`${value} J`);
    this.cap = value;
  }

  /** Name the line join. */
  setJoin(value: 0 | 1 | 2): void {
    if (value === this.join) {
      return;
    }
    this.lines.push(`${value} j`);
    this.join = value;
  }

  /** Name the dash pattern; an absent or all-zero list means solid. */
  setDash(values: readonly number[] | undefined): void {
    const solid =
      values === undefined ||
      values.length === 0 ||
      values.every((value) => value === 0);
    if (solid) {
      if (this.dash !== undefined) {
        this.lines.push("[] 0 d");
        this.dash = undefined;
      }
      return;
    }
    if (values !== undefined && this.dash !== undefined && sameNumbers(values, this.dash)) {
      return;
    }
    this.lines.push(`[${values?.map(formatPdfNumber).join(" ")}] 0 d`);
    this.dash = values;
  }

  /** Write the path construction operators of one command list. */
  private pathOf(commands: readonly PathCommand[]): void {
    for (const command of commands) {
      switch (command.command) {
        case "move":
        case "line":
          this.lines.push(
            `${formatPdfNumber(command.to.x)} ${formatPdfNumber(command.to.y)} ` +
              `${command.command === "move" ? "m" : "l"}`,
          );
          break;
        case "curve":
          this.lines.push(
            [
              formatPdfNumber(command.control1.x),
              formatPdfNumber(command.control1.y),
              formatPdfNumber(command.control2.x),
              formatPdfNumber(command.control2.y),
              formatPdfNumber(command.to.x),
              formatPdfNumber(command.to.y),
              "c",
            ].join(" "),
          );
          break;
        case "close":
          this.lines.push("h");
          break;
      }
    }
  }

  /**
   * Construct one path and paint it.
   *
   * `S` strokes, `f` fills, and `B` does both; the starred forms fill
   * with the even-odd rule. A path with nothing to paint writes nothing,
   * because a painting operator is what makes a path visible.
   */
  paintPath(
    commands: readonly PathCommand[],
    paint: { fill: boolean; stroke: boolean; evenOdd: boolean },
  ): void {
    if (commands.length === 0 || (!paint.fill && !paint.stroke)) {
      return;
    }
    this.pathOf(commands);
    const star = paint.evenOdd ? "*" : "";
    if (paint.fill && paint.stroke) {
      this.lines.push(`B${star}`);
      this.fillCount += 1;
      this.strokeCount += 1;
    } else if (paint.stroke) {
      this.lines.push("S");
      this.strokeCount += 1;
    } else {
      this.lines.push(`f${star}`);
      this.fillCount += 1;
    }
  }

  /**
   * Construct one path and clip everything after it to the filled area.
   *
   * PDF asks a clipping path to end in a painting decision, and `n`
   * paints nothing, which is exactly "clip only".
   */
  clipPath(commands: readonly PathCommand[], evenOdd: boolean): void {
    if (commands.length === 0) {
      return;
    }
    this.pathOf(commands);
    this.lines.push(evenOdd ? "W* n" : "W n");
  }

  /** The stream text, one operator per line. */
  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

/** Compare two colour triples at the precision PDF writes them. */
function sameRgb(left: Rgb, right: Rgb): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    sameNumbers(left, right)
  );
}

/** Compare two number lists element by element. */
function sameNumbers(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): boolean {
  if (left === undefined || right === undefined || left.length !== right.length) {
    return left === right;
  }
  return left.every((value, index) => value === right[index]);
}

/** The definitions of one document, by the id a reference names. */
interface Definitions {
  readonly clips: ReadonlyMap<string, XmlElement>;
  readonly masks: ReadonlyMap<string, XmlElement>;
  readonly symbols: ReadonlyMap<string, XmlElement>;
}

/** Collect every definition of the document, wherever it sits. */
function collectDefinitions(node: XmlNode, into: {
  clips: Map<string, XmlElement>;
  masks: Map<string, XmlElement>;
  symbols: Map<string, XmlElement>;
}): void {
  if (node.kind === "text") {
    return;
  }
  const id = attributeOf(node, "id");
  if (id !== undefined) {
    if (node.name === "clipPath") {
      into.clips.set(id, node);
    } else if (node.name === "mask") {
      into.masks.set(id, node);
    } else if (node.name === "g") {
      into.symbols.set(id, node);
    }
  }
  for (const child of node.children) {
    collectDefinitions(child, into);
  }
}

/** The `#name` part of one `url(#name)` reference. */
function referenceTarget(
  element: XmlElement,
  attribute: string,
  value: string | undefined,
): string {
  if (value === undefined) {
    throw new Error(
      `the <${element.name}> element carries an empty "${attribute}"`,
    );
  }
  const match = /^url\(#([^)]+)\)$/.exec(value);
  if (!match || (match[1] ?? "").length === 0) {
    throw new Error(
      `the "${attribute}" of <${element.name}> must name one definition, ` +
        `for example url(#clip-sky), got "${value}"`,
    );
  }
  return match[1] ?? "";
}

/** One resolved reference, or a named error for the dangling kind. */
function resolveDefinition(
  element: XmlElement,
  attribute: string,
  value: string | undefined,
  table: ReadonlyMap<string, XmlElement>,
  kind: string,
): XmlElement {
  const target = referenceTarget(element, attribute, value);
  const found = table.get(target);
  if (found === undefined) {
    throw new Error(
      `the "${attribute}" of <${element.name}> names "${target}", but no ` +
        `${kind} definition carries that id`,
    );
  }
  return found;
}

/** The path commands of one `clipPath` definition. */
function clipCommandsOf(clip: XmlElement): readonly PathCommand[] {
  const units = attributeOf(clip, "clipPathUnits");
  if (units !== undefined && units !== "userSpaceOnUse") {
    throw new Error(
      `clipPathUnits "${units}" is outside the grammar: the renderer ` +
        "writes userSpaceOnUse",
    );
  }
  const commands: PathCommand[] = [];
  for (const child of clip.children) {
    if (child.kind === "text") {
      if (child.content.trim().length > 0) {
        throw new Error("a clipPath holds shapes, not text");
      }
      continue;
    }
    if (child.name === "path") {
      commands.push(...pathCommandsOf(child));
    } else if (child.name === "rect") {
      commands.push(...rectCommandsOf(child));
    } else {
      throw new Error(
        `a <${child.name}> inside a clipPath is outside the grammar: ` +
          "the renderer writes path and rect shapes",
      );
    }
  }
  if (commands.length === 0) {
    throw new Error("a clipPath needs at least one shape to clip with");
  }
  return commands;
}

/**
 * Apply one luminance mask as a clipping path.
 *
 * The mask grammar of `@hatch/renderer-svg` is one base rectangle in pure
 * white or pure black plus one pure path on top. With no other luminance
 * in between, the mask keeps exactly one region of the canvas:
 *
 * - a white base hides the area under the path: everything else shows;
 * - a black base keeps only the area under the path.
 *
 * An even-odd clip over both shapes states the first case exactly, and
 * the path alone states the second, with no transparency operator and no
 * soft-mask form XObject in the file. A mask outside that grammar fails
 * with a named error rather than approximating luminance.
 */
function applyMask(
  stream: ContentStream,
  mask: XmlElement,
  docSize: DocumentSize,
): void {
  const units = attributeOf(mask, "maskUnits");
  if (units !== undefined && units !== "userSpaceOnUse") {
    throw new Error(
      `maskUnits "${units}" is outside the grammar: the renderer writes ` +
        "userSpaceOnUse",
    );
  }
  const region = ["x", "y", "width", "height"].map(
    (name) => attributeOf(mask, name) ?? "",
  );
  if (region.some((value) => value !== "")) {
    const numbers = region.map((value, index) =>
      value === ""
        ? index < 2
          ? 0
          : index === 2
            ? docSize.width
            : docSize.height
        : strictNumber(`mask ${["x", "y", "width", "height"][index] ?? ""}`, value),
    );
    if (
      numbers[0] !== 0 ||
      numbers[1] !== 0 ||
      numbers[2] !== docSize.width ||
      numbers[3] !== docSize.height
    ) {
      throw new Error(
        `the mask "${attributeOf(mask, "id") ?? "?"}" clips its luminance to ` +
          `a region other than the full canvas, which an even-odd clip ` +
          "cannot state: the renderer writes the full canvas",
      );
    }
  }
  const shapes = mask.children.filter(
    (child): child is XmlElement => child.kind === "element",
  );
  const base = shapes[0];
  const carve = shapes[1];
  if (
    shapes.length !== 2 ||
    base === undefined ||
    base.name !== "rect" ||
    carve === undefined ||
    (carve.name !== "path" && carve.name !== "rect")
  ) {
    throw new Error(
      `the mask "${attributeOf(mask, "id") ?? "?"}" is outside the grammar: ` +
        "the renderer writes one base rectangle and one carve path",
    );
  }
  const baseFill = parseColor(attributeOf(base, "fill") ?? "black");
  const carveFill = parseColor(attributeOf(carve, "fill") ?? "black");
  if (baseFill.kind !== "rgb" || carveFill.kind !== "rgb") {
    throw new Error(
      `the mask "${attributeOf(mask, "id") ?? "?"}" paints a shape with ` +
        "no color: mask luminance needs pure white and pure black",
    );
  }
  rejectUnhandledAttributes(base, ["x", "y", "width", "height", "fill"]);
  rejectUnhandledAttributes(carve, ["d", "fill"]);

  const baseIsWhite = baseFill.rgb[0] === 1;
  const carveCommands = pathCommandsOf(carve);
  if (baseIsWhite && carveFill.rgb[0] === 0) {
    // Inverted mask: hide under the carve, show the rest of the base.
    stream.clipPath(
      [...rectCommandsOf(base), ...carveCommands],
      true,
    );
  } else if (!baseIsWhite && carveFill.rgb[0] === 1) {
    // Keeping mask: show under the carve only.
    stream.clipPath(carveCommands, true);
  } else {
    throw new Error(
      `the mask "${attributeOf(mask, "id") ?? "?"}" paints luminance this ` +
        "converter cannot state as a clip: write one pure-white or pure-black " +
        "base and one carve path in the other colour",
    );
  }
}

/** The path commands of one `<path>` element. */
function pathCommandsOf(path: XmlElement): readonly PathCommand[] {
  const d = attributeOf(path, "d");
  if (d === undefined) {
    throw new Error("a <path> element needs a \"d\" attribute");
  }
  return parsePathData(d);
}

/** The path commands of one `<rect>` element, corners in order. */
function rectCommandsOf(rect: XmlElement): readonly PathCommand[] {
  const rawX = attributeOf(rect, "x") === undefined ? 0 : numberAttributeOf(rect, "x");
  const rawY = attributeOf(rect, "y") === undefined ? 0 : numberAttributeOf(rect, "y");
  const rawWidth = numberAttributeOf(rect, "width");
  const rawHeight = numberAttributeOf(rect, "height");
  if (attributeOf(rect, "rx") !== undefined || attributeOf(rect, "ry") !== undefined) {
    throw new Error(
      "rounded rectangle corners are outside the grammar: the renderer " +
        "writes square paper and shapes",
    );
  }
  const x = rawWidth < 0 ? rawX + rawWidth : rawX;
  const y = rawHeight < 0 ? rawY + rawHeight : rawY;
  const width = Math.abs(rawWidth);
  const height = Math.abs(rawHeight);
  const corner = (dx: number, dy: number): Point => ({ x: x + dx, y: y + dy });
  return [
    { command: "move", to: corner(0, 0) },
    { command: "line", to: corner(width, 0) },
    { command: "line", to: corner(width, height) },
    { command: "line", to: corner(0, height) },
    { command: "close" },
  ];
}

/** The path commands of one `<circle>` or `<ellipse>` element. */
function ellipseCommandsOf(
  shape: XmlElement,
  radiusX: number,
  radiusY: number,
): readonly PathCommand[] {
  // Four cubic arcs at the kappa of a quarter circle trace one full turn.
  const kappa = 0.5522847498307936;
  const cx = attributeOf(shape, "cx") === undefined ? 0 : numberAttributeOf(shape, "cx");
  const cy = attributeOf(shape, "cy") === undefined ? 0 : numberAttributeOf(shape, "cy");
  const east: Point = { x: cx + radiusX, y: cy };
  const north: Point = { x: cx, y: cy + radiusY };
  const west: Point = { x: cx - radiusX, y: cy };
  const south: Point = { x: cx, y: cy - radiusY };
  const bulge = (from: Point, to: Point, dx: number, dy: number) => ({
    command: "curve" as const,
    control1: { x: from.x + dx * radiusX, y: from.y + dy * radiusY },
    control2: { x: to.x - dy * radiusX, y: to.y - dx * radiusY },
    to,
  });
  return [
    { command: "move", to: east },
    bulge(east, north, 0, kappa),
    bulge(north, west, -kappa, 0),
    bulge(west, south, 0, -kappa),
    bulge(south, east, kappa, 0),
    { command: "close" },
  ];
}

/** The line cap number of one `stroke-linecap` value. */
function lineCapOf(value: string): 0 | 1 | 2 {
  switch (value) {
    case "butt":
      return 0;
    case "round":
      return 1;
    case "square":
      return 2;
    default:
      throw new Error(`the stroke-linecap "${value}" is outside the grammar`);
  }
}

/** The line join number of one `stroke-linejoin` value. */
function lineJoinOf(value: string): 0 | 1 | 2 {
  switch (value) {
    case "miter":
      return 0;
    case "round":
      return 1;
    case "bevel":
      return 2;
    default:
      throw new Error(`the stroke-linejoin "${value}" is outside the grammar`);
  }
}

/** Read one dash list; an odd count doubles per the SVG rule. */
function dashListOf(value: string): readonly number[] | undefined {
  if (value.trim() === "none") {
    return undefined;
  }
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(
      `the stroke-dasharray "${value}" must list non-negative lengths`,
    );
  }
  return numbers.length % 2 === 0 ? numbers : [...numbers, ...numbers];
}

/** The paint state one element hands down to its children. */
function inheritedState(element: XmlElement, parent: PaintState): PaintState {
  const fill = attributeOf(element, "fill");
  const stroke = attributeOf(element, "stroke");
  const strokeWidth = attributeOf(element, "stroke-width");
  const lineCap = attributeOf(element, "stroke-linecap");
  const lineJoin = attributeOf(element, "stroke-linejoin");
  const dash = attributeOf(element, "stroke-dasharray");
  return {
    fill: fill === undefined ? parent.fill : parseColor(fill),
    stroke: stroke === undefined ? parent.stroke : parseColor(stroke),
    strokeWidth:
      strokeWidth === undefined
        ? parent.strokeWidth
        : numberValue("stroke-width", strokeWidth),
    lineCap: lineCap === undefined ? parent.lineCap : lineCapOf(lineCap),
    lineJoin: lineJoin === undefined ? parent.lineJoin : lineJoinOf(lineJoin),
    dash: dash === undefined ? parent.dash : dashListOf(dash),
  };
}

/** Parse one presentation attribute that must be a plain number. */
function numberValue(name: string, value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`the "${name}" value "${value}" is not a number`);
  }
  return parsed;
}

/** Everything one element compile needs around it. */
interface Context {
  readonly stream: ContentStream;
  readonly definitions: Definitions;
  readonly state: PaintState;
  readonly docSize: DocumentSize;
}

/** Compile one node into the content stream. */
function compileNode(node: XmlNode, context: Context): void {
  if (node.kind === "text") {
    if (node.content.trim().length > 0) {
      throw new Error(
        "svgToPdf draws no text: put labels into the document as paths, " +
          "or export a PNG for the raster text of a viewer",
      );
    }
    return;
  }
  const { stream, definitions } = context;

  switch (node.name) {
    case "defs":
    case "metadata":
    case "title":
    case "desc":
    case "clipPath":
    case "mask":
      // Definitions and bookkeeping draw nothing by themselves. Their
      // grammar is validated when a reference resolves them.
      rejectUnhandledAttributes(
        node,
        ["id", "clipPathUnits", "maskUnits", "clip-rule", "x", "y", "width", "height"],
      );
      return;
    case "svg":
      throw new Error(
        "a nested <svg> viewport is outside the grammar: the renderer " +
          "writes one root element",
      );
    case "g": {
      const state = inheritedState(node, context.state);
      rejectUnhandledAttributes(node, [
        "fill",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "transform",
        "clip-path",
        "mask",
      ]);
      stream.save();
      applyPlacement(node, context);
      for (const child of node.children) {
        compileNode(child, { ...context, state });
      }
      stream.restore();
      return;
    }
    case "path":
    case "rect":
    case "line":
    case "polyline":
    case "polygon":
    case "circle":
    case "ellipse": {
      const state = inheritedState(node, context.state);
      const handled = [
        "fill",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "transform",
        "clip-path",
        "mask",
      ];
      const shapeCommands: readonly PathCommand[] =
        node.name === "path"
          ? pathCommandsOf(node)
          : node.name === "rect"
            ? rectCommandsOf(node)
            : node.name === "line"
              ? lineCommandsOf(node)
              : node.name === "polyline" || node.name === "polygon"
                ? polylineCommandsOf(node, node.name === "polygon")
                : ellipseCommandsOf(
                    node,
                    node.name === "circle"
                      ? radiusOf(node, "r")
                      : radiusOf(node, "rx"),
                    node.name === "circle"
                      ? radiusOf(node, "r")
                      : radiusOf(node, "ry"),
                  );
      if (node.name === "line") {
        handled.push("x1", "y1", "x2", "y2");
      }
      if (node.name === "polyline" || node.name === "polygon") {
        handled.push("points");
      }
      if (node.name === "circle") {
        handled.push("cx", "cy", "r");
      }
      if (node.name === "ellipse") {
        handled.push("cx", "cy", "rx", "ry");
      }
      if (node.name === "rect") {
        handled.push("x", "y", "width", "height");
      }
      if (node.name === "path") {
        handled.push("d");
      }
      rejectUnhandledAttributes(node, handled);

      stream.save();
      applyPlacement(node, context);
      paintShape(stream, shapeCommands, state, node);
      stream.restore();
      return;
    }
    case "use": {
      const href = attributeOf(node, "href") ?? attributeOf(node, "xlink:href");
      rejectUnhandledAttributes(node, ["href", "xlink:href", "transform"]);
      const target = resolveDefinition(
        node,
        "href",
        href === undefined
          ? undefined
          : `url(#${href.startsWith("#") ? href.slice(1) : href})`,
        definitions.symbols,
        "symbol",
      );
      stream.save();
      applyPlacement(node, context);
      compileNode(target, { ...context, state: context.state });
      stream.restore();
      return;
    }
    case "image":
      throw new Error(
        "svgToPdf exports vector strokes, not raster output: an <image> " +
          "element has no place in a hatch document",
      );
    case "text":
    case "tspan":
      throw new Error(
        "svgToPdf draws no text: a hatch document carries no glyphs, and " +
          "the renderer writes none",
      );
    default:
      throw new Error(
        `svgToPdf has no translation for the <${node.name}> element`,
      );
  }
}

/** Read one radius attribute, which must be a plain non-negative number. */
function radiusOf(shape: XmlElement, name: string): number {
  const value = attributeOf(shape, name);
  if (value === undefined) {
    throw new Error(`the <${shape.name}> element needs an "${name}" radius`);
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `the "${name}" of <${shape.name}> must be a non-negative number, ` +
        `got "${value}"`,
    );
  }
  return parsed;
}

/** The commands of one `<line>` element. */
function lineCommandsOf(line: XmlElement): readonly PathCommand[] {
  return [
    {
      command: "move",
      to: {
        x: numberAttributeOf(line, "x1"),
        y: numberAttributeOf(line, "y1"),
      },
    },
    {
      command: "line",
      to: {
        x: numberAttributeOf(line, "x2"),
        y: numberAttributeOf(line, "y2"),
      },
    },
  ];
}

/** The commands of one `<polyline>` or `<polygon>` element. */
function polylineCommandsOf(
  shape: XmlElement,
  closed: boolean,
): readonly PathCommand[] {
  const points = attributeOf(shape, "points");
  if (points === undefined) {
    throw new Error(`the <${shape.name}> element needs a "points" list`);
  }
  const numbers = points
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  if (numbers.length < 4 || numbers.length % 2 !== 0 || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(
      `the "points" of <${shape.name}> must list whole x y pairs, ` +
        `got "${points}"`,
    );
  }
  const commands: PathCommand[] = [];
  for (let index = 0; index < numbers.length; index += 2) {
    commands.push({
      command: index === 0 ? "move" : "line",
      to: { x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 },
    });
  }
  if (closed) {
    commands.push({ command: "close" });
  }
  return commands;
}

/**
 * Apply the placement of one element: its transform, then its mask, then
 * its clip path.
 *
 * The three nest in that order because SVG applies the clip in the
 * coordinate system the transform set up, and the mask to the element as
 * a whole.
 */
function applyPlacement(element: XmlElement, context: Context): void {
  const transform = attributeOf(element, "transform");
  if (transform !== undefined) {
    context.stream.transform(parseTransform(transform));
  }
  const maskReference = attributeOf(element, "mask");
  if (maskReference !== undefined) {
    const mask = resolveDefinition(
      element,
      "mask",
      maskReference,
      context.definitions.masks,
      "mask",
    );
    applyMask(context.stream, mask, context.docSize);
  }
  const clipReference = attributeOf(element, "clip-path");
  if (clipReference !== undefined) {
    const clip = resolveDefinition(
      element,
      "clip-path",
      clipReference,
      context.definitions.clips,
      "clipPath",
    );
    const rule = attributeOf(clip, "clip-rule") ?? "nonzero";
    context.stream.clipPath(
      clipCommandsOf(clip),
      rule === "evenodd",
    );
  }
}

/** Paint one shape with the paint state its element resolved. */
function paintShape(
  stream: ContentStream,
  commands: readonly PathCommand[],
  state: PaintState,
  element: XmlElement,
): void {
  const fillRule = attributeOf(element, "fill-rule") ?? "nonzero";
  if (fillRule !== "nonzero" && fillRule !== "evenodd") {
    throw new Error(`the fill-rule "${fillRule}" is outside the grammar`);
  }
  const fill = state.fill.kind === "rgb";
  const stroke =
    state.stroke.kind === "rgb" && state.strokeWidth > 0;
  if (fill) {
    stream.setFill(state.fill.rgb);
  }
  if (stroke) {
    stream.setStroke(state.stroke.rgb);
    stream.setWidth(state.strokeWidth);
    stream.setCap(state.lineCap);
    stream.setJoin(state.lineJoin);
    stream.setDash(state.dash);
  }
  stream.paintPath(commands, {
    fill,
    stroke,
    evenOdd: fillRule === "evenodd",
  });
}

/**
 * Convert one SVG document to vector PDF bytes.
 *
 * The document is the one `renderSvg` of `@hatch/renderer-svg` writes, and
 * any other SVG string inside the documented grammar converts too: the
 * converter reads the size out of the document, so it never needs the
 * scene or the style that produced it.
 *
 * ```ts
 * const { svg } = engine.renderScene(spec);
 * const { pdf, width, height } = svgToPdf(svg, {
 *   fit: { mode: "width", value: 612 },
 * });
 * ```
 *
 * Every stroke becomes a PDF path operator, never a raster: the page
 * carries the same lines at print scale. Two calls with the same SVG
 * string and the same options return identical bytes. Read the page size
 * back with {@link pdfPageSize} when the PDF travels through a file.
 */
export function svgToPdf(svg: string, options: SvgToPdfOptions = {}): RenderedPdf {
  if (typeof svg !== "string" || svg.length === 0) {
    throw new Error("svgToPdf needs the SVG document as a non-empty string");
  }
  const root = parseXml(svg);
  if (root.name !== "svg") {
    throw new Error(
      `svgToPdf needs an <svg> root element, got <${root.name}>`,
    );
  }
  const size = documentSizeOf(root);
  const fit = options.fit ?? { mode: "original" as const };
  const scale = fitScale(fit, size);

  const stream = new ContentStream();
  const tables = { clips: new Map(), masks: new Map(), symbols: new Map() };
  collectDefinitions(root, tables);
  const definitions: Definitions = tables;

  // One point per user unit by default. The flip is the only place the
  // document's top-left origin meets the page's bottom-left one.
  const pageHeight = size.height * scale;
  stream.save();
  stream.transform([scale, 0, 0, -scale, 0, pageHeight]);
  const state: PaintState = INITIAL_STATE;
  for (const child of root.children) {
    compileNode(child, { stream, definitions, state, docSize: size });
  }
  stream.restore();
  const contents = stream.toString();

  const width = size.width * scale;
  const pageBody =
    `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${formatPdfNumber(width)} ` +
    `${formatPdfNumber(pageHeight)} ] ` +
    `/Resources << /ProcSet [ /PDF ] >> /Contents 4 0 R >>`;
  const contentsBody =
    `<< /Length ${Buffer.byteLength(contents, "latin1") } >>\nstream\n` +
    `${contents}endstream`;
  const pdf = buildPdfFile([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>",
    pageBody,
    contentsBody,
    PDF_INFO_BODY,
  ]);
  return {
    pdf,
    width,
    height: pageHeight,
    strokeCount: stream.strokeCount,
    fillCount: stream.fillCount,
  };
}
