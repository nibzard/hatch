/**
 * The pixel math of the PNG export (task T026).
 *
 * The raster itself - decode the SVG, draw it to a canvas, encode the
 * blob - runs in the browser and the Playwright smoke suite covers it on
 * the real page. The size rule is pure math, so it lives here: name one
 * pixel width, and the height follows the aspect ratio of the document.
 */

import { describe, expect, it } from "vitest";

import { pngSizeOf } from "../src/editor/png.js";

describe("pngSizeOf", () => {
  it("follows the aspect ratio of a named width", () => {
    expect(pngSizeOf(1024, 768, { mode: "width", value: 480 })).toEqual({
      width: 480,
      height: 360,
    });
  });

  it("rounds the height to the nearest whole pixel", () => {
    // 480 px over 16:9 is 270 exactly; 481 px rounds 270.5625 to 271.
    expect(pngSizeOf(1600, 900, { mode: "width", value: 480 })).toEqual({
      width: 480,
      height: 270,
    });
    expect(pngSizeOf(1600, 900, { mode: "width", value: 481 })).toEqual({
      width: 481,
      height: 271,
    });
  });

  it("keeps the document size under the original fit", () => {
    expect(pngSizeOf(1024, 768, { mode: "original" })).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("rejects a width that names no whole pixel", () => {
    expect(() => pngSizeOf(1024, 768, { mode: "width", value: 0 })).toThrow(
      /whole number of pixels/,
    );
    expect(() => pngSizeOf(1024, 768, { mode: "width", value: 12.5 })).toThrow(
      /whole number of pixels/,
    );
  });

  it("rejects a document with no positive size", () => {
    expect(() => pngSizeOf(0, 768, { mode: "original" })).toThrow(/positive size/);
    expect(() => pngSizeOf(Number.NaN, 768, { mode: "original" })).toThrow(
      /positive size/,
    );
  });
});
