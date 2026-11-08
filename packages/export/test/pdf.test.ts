/**
 * PDF export tests (task T030, specification sections 11, 12, and 24).
 *
 * The three acceptance criteria, as tests:
 *
 * 1. a test exports a PDF with vector strokes, not raster output: the
 *    content stream of an exported scene carries path construction and
 *    stroke painting operators, and the file holds no image XObject of
 *    any kind;
 * 2. the file starts with a valid PDF header: the `%PDF-1.4` signature
 *    with its binary marker line, and the `%%EOF` trailer behind it;
 * 3. the page size matches the aspect ratio: a 4:3 scene exports as a
 *    1024 x 768 point page, a 16:9 scene as a 1024 x 576 point one, and
 *    every fit mode keeps the ratio.
 *
 * The size assertions read the MediaBox back out of the PDF bytes, never
 * the option that was asked for, so a converter that ignored the request
 * would fail the test instead of passing it. The cross-reference
 * assertions walk every offset in the table, so a file whose table lies
 * about its objects fails too.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createV1Engine } from "@hatch/renderer-svg";

import {
  hasPdfTrailer,
  isPdf,
  pdfPageSize,
  svgToPdf,
  type PdfFit,
} from "../src/index.js";
import {
  formatPdfNumber,
  parseColor,
  parsePathData,
  parseTransform,
} from "../src/pdf-graphics.js";
import { buildPdfFile, PDF_INFO_BODY, PDF_VERSION } from "../src/pdf-file.js";

import {
  exampleSceneInput,
  EXAMPLE_SEED,
  HATCH_SVG,
  HATCH_SVG_WITHOUT_MASKS,
  SYMBOLS_SVG,
} from "./fixtures.js";

/** One PDF as the Latin-1 text it is written in. */
function textOf(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString("latin1");
}

/** The content stream of the page, without its stream framing. */
function contentStreamOf(pdf: Uint8Array): string {
  const text = textOf(pdf);
  const start = text.indexOf("stream\n");
  const end = text.indexOf("\nendstream");
  if (start === -1 || end === -1) {
    throw new Error("the PDF carries no content stream to read");
  }
  return text.slice(start + "stream\n".length, end);
}

/** Compare two byte arrays as the PDF bytes they are. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

/**
 * Walk the cross-reference table of one export.
 *
 * Returns the object offsets the table states, after checking that
 * `startxref` points at the `xref` keyword and that every stated offset
 * lands on the `N 0 obj` header of its object. A file whose table lies
 * fails here, not at the print shop.
 */
function checkedXrefOffsets(pdf: Uint8Array): number[] {
  const text = textOf(pdf);
  const startxref = /startxref\n(\d+)\n%%EOF\s*$/.exec(text);
  if (!startxref) {
    throw new Error("the PDF carries no startxref before %%EOF");
  }
  const tableAt = Number(startxref[1]);
  if (text.slice(tableAt, tableAt + 4) !== "xref") {
    throw new Error("startxref does not point at the xref table");
  }
  // The table reads "xref", then "0 N", then N entries: the free entry
  // first, one line per object after it.
  const lines = text.slice(tableAt).split("\n");
  const header = /^0 (\d+)$/.exec(lines[1] ?? "");
  if (!header) {
    throw new Error("the xref table states no object count");
  }
  const count = Number(header[1]);
  // Entry 0 of the table is the free head, so the objects start at the
  // fourth line and run to the stated count minus one.
  const entries = lines.slice(3, 2 + count);
  const offsets: number[] = [];
  entries.forEach((line, index) => {
    const offset = Number(line.slice(0, 10));
    const generation = line.slice(11, 16);
    const kind = line.slice(17, 18);
    if (
      !Number.isInteger(offset) ||
      generation !== "00000" ||
      kind !== "n"
    ) {
      throw new Error(`the xref entry for object ${index + 1} is malformed`);
    }
    const expected = `${index + 1} 0 obj`;
    if (text.slice(offset, offset + expected.length) !== expected) {
      throw new Error(
        `the xref entry for object ${index + 1} points at ` +
          `"${text.slice(offset, offset + expected.length + 4)}"`,
      );
    }
    offsets.push(offset);
  });
  return offsets;
}

/** How many elements carry one attribute, for example `stroke="#`. */
function countAttribute(svg: string, marker: string): number {
  return svg.split(marker).length - 1;
}

describe("the PDF file assembler", () => {
  it("writes the versioned header, the binary marker, and the trailer", () => {
    const file = buildPdfFile(["<< /Type /Catalog >>", PDF_INFO_BODY]);
    const text = textOf(file);
    expect(text.startsWith(`%PDF-${PDF_VERSION}\n%âãÏÓ\n`)).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("states a cross-reference offset that lands on the table", () => {
    const file = buildPdfFile([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>",
      "<< /Type /Page >>",
      PDF_INFO_BODY,
    ]);
    expect(checkedXrefOffsets(file)).toHaveLength(4);
  });

  it("orders the objects it was given without renumbering them", () => {
    const file = textOf(
      buildPdfFile(["<< /A 1 >>", "<< /B 2 >>", "<< /C 3 >>", PDF_INFO_BODY]),
    );
    expect(file).toContain("1 0 obj\n<< /A 1 >>");
    expect(file).toContain("2 0 obj\n<< /B 2 >>");
    expect(file).toContain("3 0 obj\n<< /C 3 >>");
    expect(file).toContain("/Info 4 0 R");
  });
});

describe("vector graphics primitives", () => {
  it("formats numbers the way the SVG writer does", () => {
    expect(formatPdfNumber(1024)).toBe("1024");
    expect(formatPdfNumber(0.55)).toBe("0.55");
    expect(formatPdfNumber(-0.0001)).toBe("0");
    expect(formatPdfNumber(-0)).toBe("0");
    expect(() => formatPdfNumber(Number.NaN)).toThrow(/finite/);
  });

  it("reads the colours of the renderer grammar and rejects the rest", () => {
    expect(parseColor("#fff")).toEqual({ kind: "rgb", rgb: [1, 1, 1] });
    expect(parseColor("#3a342e")).toEqual({
      kind: "rgb",
      rgb: [0.22745098039215686, 0.20392156862745098, 0.1803921568627451],
    });
    expect(parseColor("rgb(246 241 231)")).toEqual({
      kind: "rgb",
      rgb: [246 / 255, 241 / 255, 231 / 255],
    });
    expect(parseColor("black")).toEqual({ kind: "rgb", rgb: [0, 0, 0] });
    expect(parseColor("none").kind).toBe("none");
    expect(() => parseColor("hsl(0 0 0)")).toThrow(/outside the grammar/);
  });

  it("reads the four commands the renderer writes", () => {
    expect(parsePathData("M 1 2 L 3 4 C 5 6 7 8 9 10 Z")).toEqual([
      { command: "move", to: { x: 1, y: 2 } },
      { command: "line", to: { x: 3, y: 4 } },
      {
        command: "curve",
        control1: { x: 5, y: 6 },
        control2: { x: 7, y: 8 },
        to: { x: 9, y: 10 },
      },
      { command: "close" },
    ]);
  });

  it("resolves relative commands against the current point", () => {
    expect(parsePathData("M 10 10 l 5 5 h 5 v 5 m -20 0 l 1 1")).toEqual([
      { command: "move", to: { x: 10, y: 10 } },
      { command: "line", to: { x: 15, y: 15 } },
      { command: "line", to: { x: 20, y: 15 } },
      { command: "line", to: { x: 20, y: 20 } },
      { command: "move", to: { x: 0, y: 20 } },
      { command: "line", to: { x: 1, y: 21 } },
    ]);
  });

  it("reflects the previous control point in the S and T shorthands", () => {
    expect(
      parsePathData("M 0 0 C 0 0 10 10 20 20 S 30 30 40 40"),
    ).toEqual([
      { command: "move", to: { x: 0, y: 0 } },
      {
        command: "curve",
        control1: { x: 0, y: 0 },
        control2: { x: 10, y: 10 },
        to: { x: 20, y: 20 },
      },
      {
        command: "curve",
        control1: { x: 30, y: 30 },
        control2: { x: 30, y: 30 },
        to: { x: 40, y: 40 },
      },
    ]);
    // T reflects the quadratic control of the Q before it, and both
    // quadratics carry the standard 2/3 weights of their cubic form.
    expect(parsePathData("M 0 0 Q 30 0 60 0 T 120 0")).toEqual([
      { command: "move", to: { x: 0, y: 0 } },
      {
        command: "curve",
        control1: { x: 20, y: 0 },
        control2: { x: 40, y: 0 },
        to: { x: 60, y: 0 },
      },
      {
        command: "curve",
        control1: { x: 80, y: 0 },
        control2: { x: 100, y: 0 },
        to: { x: 120, y: 0 },
      },
    ]);
  });

  it("turns elliptical arcs into cubic curves that land on the endpoint", () => {
    const commands = parsePathData("M 0 0 A 50 50 0 0 1 100 0");
    const curves = commands.filter(
      (command): command is Extract<typeof command, { command: "curve" }> =>
        command.command === "curve",
    );
    expect(commands[0]).toEqual({ command: "move", to: { x: 0, y: 0 } });
    expect(curves.length).toBeGreaterThanOrEqual(2);
    expect(curves.at(-1)?.to).toEqual({ x: 100, y: 0 });
    // A half turn through a 50 unit radius bulges 50 units to the side.
    const mid = curves[0]?.to ?? { x: 0, y: 0 };
    expect(Math.abs(mid.x - 50)).toBeLessThan(0.5);
    expect(Math.abs(Math.abs(mid.y) - 50)).toBeLessThan(0.5);

    const circle = parsePathData(
      "M 0 -50 A 50 50 0 1 1 0 50 A 50 50 0 1 1 0 -50 Z",
    );
    expect(circle.at(-1)).toEqual({ command: "close" });
    expect(
      circle.filter((command) => command.command === "curve").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("returns to the subpath start after a close", () => {
    expect(parsePathData("M 1 1 L 2 2 Z l 1 1")).toEqual([
      { command: "move", to: { x: 1, y: 1 } },
      { command: "line", to: { x: 2, y: 2 } },
      { command: "close" },
      { command: "line", to: { x: 2, y: 2 } },
    ]);
  });

  it("rejects path data outside the grammar with named errors", () => {
    expect(() => parsePathData("R 1 2")).toThrow(/outside the grammar/);
    expect(() => parsePathData("1 2")).toThrow(/no command letter/);
    expect(() => parsePathData("L 10 10 L 3")).toThrow(/number\(s\) per step/);
    expect(() => parsePathData("M 1 2 Z 3 3")).toThrow(
      /cannot follow the close/,
    );
    expect(() => parsePathData("L 1 2")).toThrow(/must start with a move/);
  });

  it("reads transform lists into one matrix", () => {
    expect(parseTransform("translate(10 20)")).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform("scale(2 3)")).toEqual([2, 0, 0, 3, 0, 0]);
    expect(parseTransform("matrix(1 2 3 4 5 6)")).toEqual([1, 2, 3, 4, 5, 6]);
    // Left to right: the point scales first, then translates.
    expect(parseTransform("translate(10 0) scale(2)")).toEqual([
      2, 0, 0, 2, 10, 0,
    ]);
    // Rotations come back as cosines and sines, so 90 degrees lands near
    // the quarter turn instead of exactly on its rounded values.
    expect(parseTransform("rotate(90)")).toEqual([
      6.123233995736766e-17, 1, -1, 6.123233995736766e-17, 0, 0,
    ]);
    // A rotation about a centre keeps the centre where it was.
    expect(parseTransform("rotate(90 5 5)").slice(4)).toEqual([10, 0]);
    expect(() => parseTransform("translate(10) wobble(1)")).toThrow(
      /outside the grammar/,
    );
    expect(() => parseTransform("rotate(heavy)")).toThrow(
      /not a finite number/,
    );
  });
});

describe("SVG to PDF conversion", () => {
  it("converts a hatch document at its own size by default", () => {
    const pdf = svgToPdf(HATCH_SVG);
    expect(isPdf(pdf.pdf)).toBe(true);
    expect(hasPdfTrailer(pdf.pdf)).toBe(true);
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 400, height: 300 });
    expect(pdf.width).toBe(400);
    expect(pdf.height).toBe(300);
    // Four sky strokes plus one contour line; the paper is the one fill.
    expect(pdf.strokeCount).toBe(5);
    expect(pdf.fillCount).toBe(1);
  });

  it("states a cross-reference table that lands on its objects", () => {
    const pdf = svgToPdf(HATCH_SVG);
    expect(checkedXrefOffsets(pdf.pdf)).toHaveLength(5);
  });

  it("scales to a requested page width and keeps the ratio", () => {
    const pdf = svgToPdf(HATCH_SVG, { fit: { mode: "width", value: 800 } });
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 800, height: 600 });
  });

  it("scales to a requested page height and keeps the ratio", () => {
    const pdf = svgToPdf(HATCH_SVG, { fit: { mode: "height", value: 150 } });
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 200, height: 150 });
  });

  it("scales by a zoom factor, fractional sizes included", () => {
    const pdf = svgToPdf(HATCH_SVG, { fit: { mode: "zoom", value: 0.5 } });
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 200, height: 150 });
    const wide = svgToPdf(HATCH_SVG, { fit: { mode: "width", value: 612 } });
    expect(pdfPageSize(wide.pdf)).toEqual({ width: 612, height: 459 });
  });

  it("rejects a fit request the page could not honour", () => {
    expect(() =>
      svgToPdf(HATCH_SVG, { fit: { mode: "width", value: 0 } }),
    ).toThrow(/positive number of points/);
    expect(() =>
      svgToPdf(HATCH_SVG, { fit: { mode: "width", value: -480 } }),
    ).toThrow(/positive number of points/);
    expect(() =>
      svgToPdf(HATCH_SVG, { fit: { mode: "width", value: Number.NaN } }),
    ).toThrow(/finite number/);
    expect(() =>
      svgToPdf(HATCH_SVG, { fit: { mode: "zoom", value: 0 } }),
    ).toThrow(/positive scale factor/);
  });

  it("rejects a fit mode outside the documented set, by name", () => {
    // A TypeScript caller cannot write this fit, but a JavaScript caller
    // or a JSON options block can, and the scale lookup reads every mode
    // it does not name as "height": without the check it returned a page
    // of 1.33 x 1 points (T055).
    const fit = { mode: "bogus", value: 1 } as unknown as PdfFit;
    expect(() => svgToPdf(HATCH_SVG, { fit })).toThrow(
      /a PDF fit mode must be one of/,
    );
    expect(() => svgToPdf(HATCH_SVG, { fit })).toThrow(/got "bogus"/);
  });

  it("rejects input that is no SVG document, with a named error", () => {
    expect(() => svgToPdf("")).toThrow(/non-empty string/);
    expect(() => svgToPdf("not a hatch document")).toThrow(/no root element/);
    expect(() => svgToPdf("<g />")).toThrow(/<svg> root element/);
    expect(() =>
      svgToPdf('<!DOCTYPE svg [<!ENTITY x SYSTEM "file">]>'),
    ).toThrow(/document type declaration/);
  });

  it("rejects what it cannot translate without guessing", () => {
    expect(() =>
      svgToPdf(
        '<svg width="10" height="10"><rect x="0" y="0" width="5" height="5" fill="#fff" opacity="0.5"/></svg>',
      ),
    ).toThrow(/attribute "opacity"/);
    expect(() =>
      svgToPdf(
        '<svg width="10" height="10"><image href="photo.png" x="0" y="0" width="5" height="5"/></svg>',
      ),
    ).toThrow(/vector strokes, not raster/);
    expect(() =>
      svgToPdf('<svg width="10" height="10"><text x="1" y="2">label</text></svg>'),
    ).toThrow(/draws no text/);
    expect(() =>
      svgToPdf('<svg width="10" height="10"><frobnicator /></svg>'),
    ).toThrow(/no translation for the <frobnicator>/);
    expect(() =>
      svgToPdf(
        '<svg width="10" height="10"><g mask="url(#nope)"><path d="M 0 0 L 1 1" stroke="#000" fill="none"/></g></svg>',
      ),
    ).toThrow(/no mask definition/);
    expect(() =>
      svgToPdf(
        '<svg width="10" height="10" viewBox="0 0 20 10"><path d="M 0 0 L 1 1" stroke="#000" fill="none"/></svg>',
      ),
    ).toThrow(/viewBox/);
  });

  it("applies the mask and the clip path of the document", () => {
    const masked = contentStreamOf(svgToPdf(HATCH_SVG).pdf);
    const stripped = contentStreamOf(svgToPdf(HATCH_SVG_WITHOUT_MASKS).pdf);
    // One even-odd clip states the cloud cutout, one clip path holds the
    // sky band to its extent.
    expect((masked.match(/W\* n/g) ?? []).length).toBe(1);
    expect((masked.match(/W n/g) ?? []).length).toBe(1);
    expect(stripped).not.toContain("W* n");
    expect(stripped).not.toContain("W n");
    expect(svgToPdf(HATCH_SVG_WITHOUT_MASKS).pdf.length).not.toBe(
      svgToPdf(HATCH_SVG).pdf.length,
    );
  });

  it("places symbol marks under their use transforms", () => {
    const pdf = svgToPdf(SYMBOLS_SVG);
    // Two placements of a two-stroke mark, plus the paper fill.
    expect(pdf.strokeCount).toBe(4);
    expect(pdf.fillCount).toBe(1);
    const stream = contentStreamOf(pdf.pdf);
    // The page flip is one cm; each placement adds its own.
    expect((stream.match(/ cm/g) ?? []).length).toBe(3);
    expect(stream).toContain("c");
  });

  it("dashes strokes when the document asks for it", () => {
    const pdf = svgToPdf(
      '<svg width="20" height="20"><path d="M 1 5 L 19 5" stroke="#000000" stroke-width="1" stroke-dasharray="3 2" fill="none"/></svg>',
    );
    expect(contentStreamOf(pdf.pdf)).toContain("[3 2] 0 d");
    expect(pdf.strokeCount).toBe(1);
  });
});

describe("acceptance: an example PDF exports with vector strokes", () => {
  const engine = createV1Engine();
  const scene = engine.renderScene(exampleSceneInput());
  const exported = svgToPdf(scene.svg);
  const stream = contentStreamOf(exported.pdf);

  it("starts with a valid PDF header and ends with its trailer", () => {
    expect(textOf(exported.pdf).startsWith(`%PDF-${PDF_VERSION}\n%`)).toBe(true);
    expect(isPdf(exported.pdf)).toBe(true);
    expect(hasPdfTrailer(exported.pdf)).toBe(true);
    expect(checkedXrefOffsets(exported.pdf)).toHaveLength(5);
  });

  it("draws the scene as vector strokes, one per stroked path", () => {
    // Every path that draws ink names its stroke width, whether it carries
    // its own stroke colour or inherits one from its region group (task
    // T036 groups the hatch strokes into runs), and every one of them
    // arrives as one stroked PDF path.
    const strokedPaths = countAttribute(scene.svg, 'stroke-width="');
    expect(strokedPaths).toBeGreaterThan(150);
    expect(exported.strokeCount).toBe(strokedPaths);
    expect(exported.fillCount).toBe(1);
  });

  it("carries path construction and stroke painting, no raster", () => {
    // Vector geometry: thousands of segments built and stroked by name -
    // straight pieces as `l`, the fitted curves of task T036 as `c`.
    expect((stream.match(/ m\n/g) ?? []).length).toBeGreaterThan(500);
    const segments =
      (stream.match(/ l\n/g) ?? []).length + (stream.match(/ c\n/g) ?? []).length;
    expect(segments).toBeGreaterThan(2_500);
    expect((stream.match(/\nS\n/g) ?? []).length).toBe(exported.strokeCount);
    // Raster output would need an image object and a Do to draw one.
    expect(textOf(exported.pdf)).not.toContain("/Image");
    expect(textOf(exported.pdf)).not.toContain("/XObject");
    expect(stream).not.toContain(" Do");
    // The cloud cutouts arrive as even-odd clips, never as erased pixels.
    expect((stream.match(/W\* n/g) ?? []).length).toBe(2);
  });

  it("writes to a file and reads back the same bytes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hatch-pdf-"));
    try {
      const file = path.join(dir, "example.pdf");
      writeFileSync(file, exported.pdf);
      expect(sameBytes(readFileSync(file), exported.pdf)).toBe(true);
      expect(pdfPageSize(readFileSync(file))).toEqual({
        width: 1024,
        height: 768,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("acceptance: the page size matches the aspect ratio", () => {
  const engine = createV1Engine();

  it("exports a 4:3 scene as a 1024 x 768 point page", () => {
    const scene = engine.renderScene(exampleSceneInput());
    const pdf = svgToPdf(scene.svg);
    expect(scene.ir.canvas).toEqual({ width: 1024, height: 768 });
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 1024, height: 768 });
    expect(pdf.width / pdf.height).toBeCloseTo(4 / 3, 10);
  });

  it("exports a 16:9 scene as a 1024 x 576 point page", () => {
    const wide = engine.renderScene(exampleSceneInput({ aspectRatio: "16:9" }));
    const pdf = svgToPdf(wide.svg);
    expect(wide.ir.canvas).toEqual({ width: 1024, height: 576 });
    expect(pdfPageSize(pdf.pdf)).toEqual({ width: 1024, height: 576 });
    expect(pdf.width / pdf.height).toBeCloseTo(16 / 9, 10);
  });

  it("keeps the ratio under every fit mode", () => {
    const wide = engine.renderScene(exampleSceneInput({ aspectRatio: "16:9" }));
    for (const fit of [
      { mode: "width" as const, value: 612 },
      { mode: "height" as const, value: 792 },
      { mode: "zoom" as const, value: 0.5 },
    ]) {
      const size = pdfPageSize(svgToPdf(wide.svg, { fit }).pdf);
      expect(size.width / size.height).toBeCloseTo(16 / 9, 10);
    }
  });
});

describe("acceptance: fixed inputs give identical PDF bytes", () => {
  const engine = createV1Engine();
  const scene = engine.renderScene(exampleSceneInput());
  const options = { fit: { mode: "width" as const, value: 612 } };

  it("converts the same document to the same bytes twice", () => {
    const first = svgToPdf(scene.svg, options);
    const second = svgToPdf(scene.svg, options);
    expect(sameBytes(second.pdf, first.pdf)).toBe(true);
    expect(second.width).toBe(first.width);
    expect(second.strokeCount).toBe(first.strokeCount);
  });

  it("stays identical after another export ran in between", () => {
    const first = svgToPdf(scene.svg, options);
    svgToPdf(scene.svg, { fit: { mode: "zoom", value: 2 } });
    svgToPdf(HATCH_SVG, options);
    const third = svgToPdf(scene.svg, options);
    expect(sameBytes(third.pdf, first.pdf)).toBe(true);
  });

  it("exports the same scene with a different seed to different bytes", () => {
    const reseeded = engine.renderScene(
      exampleSceneInput({ seed: EXAMPLE_SEED + 1 }),
    );
    expect(
      sameBytes(
        svgToPdf(reseeded.svg, options).pdf,
        svgToPdf(scene.svg, options).pdf,
      ),
    ).toBe(false);
  });

  it("changes the bytes and the page when the fit changes", () => {
    const narrow = svgToPdf(scene.svg, { fit: { mode: "width", value: 300 } });
    const wide = svgToPdf(scene.svg, options);
    expect(sameBytes(narrow.pdf, wide.pdf)).toBe(false);
    expect(pdfPageSize(narrow.pdf).width).toBe(300);
  });
});
