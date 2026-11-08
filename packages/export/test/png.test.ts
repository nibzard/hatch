/**
 * PNG export tests (task T018, specification sections 2, 11, and 24).
 *
 * The three acceptance criteria, as tests:
 *
 * 1. an example PNG renders: a scene through the V1 engine becomes PNG
 *    bytes, written to a file and read back;
 * 2. the pixel size matches the requested aspect ratio: 4:3 and 16:9 scenes
 *    export at pixel sizes that hold their ratio;
 * 3. fixed inputs give identical PNG bytes: two conversions of the same SVG
 *    under the same options agree byte for byte, and a different conversion
 *    in between does not shift them.
 *
 * The size assertions read the IHDR chunk out of the PNG itself, never the
 * option that was asked for, so a rasterizer that ignored the request would
 * fail the test instead of passing it.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createV1Engine } from "@hatch/renderer-svg";

import {
  isPng,
  pngDimensions,
  svgToPng,
  type PngFit,
  type RenderedPng,
} from "../src/index.js";

import {
  exampleSceneInput,
  EXAMPLE_SEED,
  HATCH_SVG,
  HATCH_SVG_WITHOUT_MASKS,
  INK_SVG,
} from "./fixtures.js";

/** The PNG file trailer: a zero-length IEND chunk and its checksum. */
const IEND = Uint8Array.of(
  0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
);

/** Compare two byte arrays as the PNG bytes they are. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

/** True when the file ends with its IEND trailer, so nothing is truncated. */
function isComplete(png: Uint8Array): boolean {
  return sameBytes(png.subarray(png.length - IEND.length), IEND);
}

/** The pixel ratio of one raster, reduced to a plain fraction check. */
function ratioOf(png: RenderedPng): number {
  return png.width / png.height;
}

describe("SVG to PNG conversion", () => {
  it("rasterizes a hatch document at its own size by default", () => {
    const png = svgToPng(HATCH_SVG);
    expect(pngDimensions(png.png)).toEqual({
      width: 400,
      height: 300,
      bitDepth: 8,
      colorType: 6,
    });
    expect(png.width).toBe(400);
    expect(png.height).toBe(300);
    expect(isComplete(png.png)).toBe(true);
  });

  it("scales to a requested pixel width and keeps the ratio", () => {
    const png = svgToPng(HATCH_SVG, { fit: { mode: "width", value: 800 } });
    expect(pngDimensions(png.png)).toMatchObject({ width: 800, height: 600 });
    expect(ratioOf(png)).toBeCloseTo(4 / 3, 10);
  });

  it("scales to a requested pixel height and keeps the ratio", () => {
    const png = svgToPng(HATCH_SVG, { fit: { mode: "height", value: 150 } });
    expect(pngDimensions(png.png)).toMatchObject({ width: 200, height: 150 });
  });

  it("scales by a zoom factor", () => {
    const png = svgToPng(HATCH_SVG, { fit: { mode: "zoom", value: 0.5 } });
    expect(pngDimensions(png.png)).toMatchObject({ width: 200, height: 150 });
  });

  it("rejects a fit request the rasterizer would silently ignore", () => {
    expect(() =>
      svgToPng(HATCH_SVG, { fit: { mode: "width", value: 0 } }),
    ).toThrow(/whole number of pixels/);
    expect(() =>
      svgToPng(HATCH_SVG, { fit: { mode: "width", value: -480 } }),
    ).toThrow(/whole number of pixels/);
    expect(() =>
      svgToPng(HATCH_SVG, { fit: { mode: "width", value: Number.NaN } }),
    ).toThrow(/finite number/);
    expect(() =>
      svgToPng(HATCH_SVG, { fit: { mode: "zoom", value: 0 } }),
    ).toThrow(/positive scale factor/);
  });

  it("rejects a fit mode outside the documented set, by name", () => {
    // A TypeScript caller cannot write this fit, but a JavaScript caller
    // or a JSON options block can, and resvg would answer it with the
    // document's own size: the silent ignore the module refuses (T055).
    const fit = { mode: "bogus", value: 1 } as unknown as PngFit;
    expect(() => svgToPng(HATCH_SVG, { fit })).toThrow(
      /a PNG fit mode must be one of/,
    );
    expect(() => svgToPng(HATCH_SVG, { fit })).toThrow(/got "bogus"/);
  });

  it("rejects input that is no SVG document, with a named error", () => {
    expect(() => svgToPng("")).toThrow(/non-empty string/);
    expect(() => svgToPng("not a hatch document")).toThrow(
      /could not rasterize/,
    );
  });

  it("applies the mask and the clip path of the document", () => {
    const masked = svgToPng(HATCH_SVG, { fit: { mode: "zoom", value: 2 } });
    const stripped = svgToPng(HATCH_SVG_WITHOUT_MASKS, {
      fit: { mode: "zoom", value: 2 },
    });
    expect(stripped.width).toBe(masked.width);
    expect(sameBytes(stripped.png, masked.png)).toBe(false);
  });

  it("paints a background color behind the drawing when asked", () => {
    const plain = svgToPng(INK_SVG);
    const backed = svgToPng(INK_SVG, { background: "#ffffff" });
    expect(pngDimensions(backed.png)).toEqual(pngDimensions(plain.png));
    expect(sameBytes(backed.png, plain.png)).toBe(false);
    // A hatch document paints its own paper over the full canvas, so a
    // background behind it cannot change one byte.
    const paper = svgToPng(HATCH_SVG);
    const papered = svgToPng(HATCH_SVG, { background: "#ffffff" });
    expect(sameBytes(papered.png, paper.png)).toBe(true);
  });
});

describe("acceptance: an example PNG renders from a V1 scene", () => {
  const engine = createV1Engine();
  const scene = engine.renderScene(exampleSceneInput());
  const exported = svgToPng(scene.svg, { fit: { mode: "width", value: 480 } });

  it("produces PNG bytes that carry the scene, not a blank raster", () => {
    expect(isPng(exported.png)).toBe(true);
    expect(isComplete(exported.png)).toBe(true);
    expect(exported.png.length).toBeGreaterThan(10_000);
    expect(pngDimensions(exported.png).colorType).toBe(6);
  });

  it("writes to a file and reads back the same bytes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hatch-png-"));
    try {
      const file = path.join(dir, "example.png");
      writeFileSync(file, exported.png);
      expect(sameBytes(readFileSync(file), exported.png)).toBe(true);
      expect(pngDimensions(readFileSync(file))).toMatchObject({
        width: 480,
        height: 360,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches the aspect ratio the scene requested at 4:3", () => {
    expect(scene.ir.canvas).toEqual({ width: 1024, height: 768 });
    expect(pngDimensions(exported.png)).toMatchObject({ width: 480, height: 360 });
    expect(ratioOf(exported)).toBeCloseTo(4 / 3, 10);
  });

  it("matches the aspect ratio the scene requested at 16:9", () => {
    const wide = engine.renderScene(exampleSceneInput({ aspectRatio: "16:9" }));
    const exported = svgToPng(wide.svg, { fit: { mode: "width", value: 480 } });
    expect(wide.ir.canvas).toEqual({ width: 1024, height: 576 });
    expect(pngDimensions(exported.png)).toMatchObject({ width: 480, height: 270 });
    expect(ratioOf(exported)).toBeCloseTo(16 / 9, 10);
  });
});

describe("acceptance: fixed inputs give identical PNG bytes", () => {
  const engine = createV1Engine();
  const scene = engine.renderScene(exampleSceneInput());
  const options = { fit: { mode: "width" as const, value: 320 } };

  it("converts the same document to the same bytes twice", () => {
    const first = svgToPng(scene.svg, options);
    const second = svgToPng(scene.svg, options);
    expect(sameBytes(second.png, first.png)).toBe(true);
    expect(second.width).toBe(first.width);
  });

  it("stays identical after another export ran in between", () => {
    const first = svgToPng(scene.svg, options);
    svgToPng(scene.svg, { fit: { mode: "zoom", value: 2 } });
    svgToPng(HATCH_SVG, options);
    const third = svgToPng(scene.svg, options);
    expect(sameBytes(third.png, first.png)).toBe(true);
  });

  it("exports the same scene with a different seed to different bytes", () => {
    const reseeded = engine.renderScene(
      exampleSceneInput({ seed: EXAMPLE_SEED + 1 }),
    );
    expect(
      sameBytes(svgToPng(reseeded.svg, options).png, svgToPng(scene.svg, options).png),
    ).toBe(false);
  });

  it("changes the bytes when the pixel size changes", () => {
    const narrow = svgToPng(scene.svg, { fit: { mode: "width", value: 160 } });
    const wide = svgToPng(scene.svg, options);
    expect(sameBytes(narrow.png, wide.png)).toBe(false);
    expect(narrow.png.length).toBeLessThan(wide.png.length);
  });
});
