/**
 * SVG to PNG export (specification sections 2, 11, 12, and 24).
 *
 * SVG stays the canonical output (specification section 12). A PNG is a
 * derived preview: one rasterization of the same bytes, never a second
 * rendering path. `resvg-js` does the rasterization. It parses the whole
 * document - the clip paths, the luminance masks that carve the cloud
 * cutouts, the `use` references of the symbol library - and paints it with
 * its own rasterizer, so no browser and no headless Chromium stands behind
 * this call.
 *
 * Determinism (specification section 10) has three rules here:
 *
 * 1. Every option that could vary by machine stays pinned inside this
 *    module. System fonts stay unloaded, because a machine's font set is
 *    no part of a render identity and a hatch document draws no text.
 * 2. The caller names the pixel size and nothing else, through
 *    {@link PngFit}, and the aspect ratio always follows the document.
 * 3. The PNG encoder writes no timestamp chunk, so the same SVG bytes under
 *    the same options give the same PNG bytes. The pinned resvg version is
 *    one of the fixed inputs: bump it and the bytes may change.
 *
 * A fit request that resvg would silently ignore - a width of minus 480, a
 * zoom of NaN, a mode no {@link PngFit} documents - is rejected here with a
 * named error, because a caller that asked for 480 pixels must learn that
 * it did not get them.
 */

import {
  Resvg,
  type RenderedImage,
  type ResvgRenderOptions,
} from "@resvg/resvg-js";

/**
 * The rasterizer settings this module pins. They never leave this line, so
 * two callers on two machines rasterize with the same configuration.
 */
const PINNED_OPTIONS: ResvgRenderOptions = {
  font: { loadSystemFonts: false },
  logLevel: "off",
};

/** How one export maps the user units of a document onto pixels. */
export type PngFit =
  /** One pixel per user unit of the document's own size. */
  | { readonly mode: "original" }
  /**
   * A pixel width. The height follows the aspect ratio of the document,
   * rounded to the nearest whole pixel.
   */
  | { readonly mode: "width"; readonly value: number }
  /**
   * A pixel height. The width follows the aspect ratio of the document,
   * rounded to the nearest whole pixel.
   */
  | { readonly mode: "height"; readonly value: number }
  /** A scale factor against the document's own size, for example 0.5. */
  | { readonly mode: "zoom"; readonly value: number };

/** The options of one PNG export. Every other setting stays pinned. */
export interface SvgToPngOptions {
  /**
   * The pixel size of the export. Defaults to `original`, so a 1024 x 768
   * scene exports at 1024 x 768 pixels.
   */
  readonly fit?: PngFit;
  /**
   * A CSS color painted behind the whole document, for example `#ffffff`.
   * The default leaves the raster transparent behind the drawing. A hatch
   * document paints its own paper over the full canvas, so the default
   * still reads as paper.
   */
  readonly background?: string;
}

/** What one PNG export produced. */
export interface RenderedPng {
  /** The PNG file bytes, ready to write to disk as they are. */
  readonly png: Uint8Array;
  /** The pixel width of the raster, as the encoder wrote it. */
  readonly width: number;
  /** The pixel height of the raster, as the encoder wrote it. */
  readonly height: number;
}

/** The message of one thrown error, whatever shape it carries. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reject a fit mode outside the set {@link PngFit} documents, by name.
 *
 * A TypeScript caller cannot write one, but a JavaScript caller or a JSON
 * options block can. resvg answers an unknown `fitTo.mode` by rasterizing
 * at the document's own size, which is the silent ignore this module
 * refuses, so the mode is checked before any value is.
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
        `a PNG fit mode must be one of "original", "width", "height", or ` +
          `"zoom", got "${mode}"`,
      );
  }
}

/** Reject a fit request that names no usable pixel size. */
function checkedFit(fit: PngFit): ResvgRenderOptions["fitTo"] {
  checkedMode(fit.mode);
  if (fit.mode === "original") {
    return { mode: "original" };
  }
  const { mode, value } = fit;
  if (!Number.isFinite(value)) {
    throw new Error(
      `a PNG fit of "${mode}" needs a finite ` +
        `${mode === "zoom" ? "scale factor" : "number of pixels"}, got ${value}`,
    );
  }
  if (mode === "zoom") {
    if (value <= 0) {
      throw new Error(
        `a PNG fit of "zoom" needs a positive scale factor, got ${value}`,
      );
    }
    return { mode, value };
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `a PNG fit of "${mode}" needs a whole number of pixels of at least 1, ` +
        `got ${value}`,
    );
  }
  return { mode, value };
}

/** Rasterize one document, or throw one error that names this package. */
function rasterize(svg: string, settings: ResvgRenderOptions): RenderedImage {
  try {
    return new Resvg(svg, settings).render();
  } catch (error) {
    throw new Error(
      `svgToPng could not rasterize the document: ${messageOf(error)}`,
      { cause: error },
    );
  }
}

/**
 * Convert one SVG document to PNG bytes.
 *
 * The document is the one `renderSvg` of `@hatch/renderer-svg` writes, with
 * its XML declaration, and any other SVG string works too: the converter
 * reads the size out of the document, so it never needs the scene or the
 * style that produced it.
 *
 * ```ts
 * const { svg } = engine.renderScene(spec);
 * const { png, width, height } = svgToPng(svg, {
 *   fit: { mode: "width", value: 480 },
 * });
 * ```
 *
 * Two calls with the same SVG string and the same options return identical
 * bytes. Read the size back with {@link pngDimensions} when the PNG travels
 * through a file.
 */
export function svgToPng(svg: string, options: SvgToPngOptions = {}): RenderedPng {
  if (typeof svg !== "string" || svg.length === 0) {
    throw new Error("svgToPng needs the SVG document as a non-empty string");
  }
  if (options.background !== undefined && options.background.length === 0) {
    throw new Error(
      'the PNG background needs a CSS color, for example "#ffffff"',
    );
  }
  const settings: ResvgRenderOptions = {
    ...PINNED_OPTIONS,
    fitTo: checkedFit(options.fit ?? { mode: "original" }),
    ...(options.background === undefined
      ? {}
      : { background: options.background }),
  };

  const image = rasterize(svg, settings);
  return {
    png: image.asPng(),
    width: image.width,
    height: image.height,
  };
}
