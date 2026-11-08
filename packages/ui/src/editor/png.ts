/**
 * The PNG export of the editor panel (specification sections 12 and 23).
 *
 * SVG stays the source of truth. The PNG the export button writes is one
 * raster of the same SVG bytes the canvas shows, drawn through the
 * browser's own SVG renderer onto a canvas - never a second rendering of
 * the scene. The canonical offline raster of a release stays
 * `@hatch/export` on `resvg-js`; this module exists because a page cannot
 * carry a native module, and a human clicking Export wants the pixels now.
 *
 * The fit follows the exporter's rule: name one pixel width, and the
 * height follows the aspect ratio of the document.
 */

/** The pixel size of one exported PNG. */
export interface PngSize {
  readonly width: number;
  readonly height: number;
}

/** How the export panel sizes its raster. */
export type EditorPngFit =
  /** One named pixel width; the height follows the aspect ratio. */
  | { readonly mode: "width"; readonly value: number }
  /** The document's own size, one pixel per user unit. */
  | { readonly mode: "original" };

/**
 * The pixel size of one export, from the document's user-unit size.
 *
 * The height rounds to the nearest whole pixel the same way the exporter
 * does, so a 4:3 document at 480 pixels wide exports at 480 x 360.
 */
export function pngSizeOf(
  documentWidth: number,
  documentHeight: number,
  fit: EditorPngFit,
): PngSize {
  if (
    !Number.isFinite(documentWidth) ||
    !Number.isFinite(documentHeight) ||
    documentWidth <= 0 ||
    documentHeight <= 0
  ) {
    throw new Error(
      `the SVG document needs a positive size, got ` +
        `${documentWidth} x ${documentHeight}`,
    );
  }
  if (fit.mode === "original") {
    return {
      width: Math.round(documentWidth),
      height: Math.round(documentHeight),
    };
  }
  if (!Number.isInteger(fit.value) || fit.value < 1) {
    throw new Error(
      `a PNG width needs a whole number of pixels of at least 1, got ` +
        `${fit.value}`,
    );
  }
  return {
    width: fit.value,
    height: Math.round((fit.value * documentHeight) / documentWidth),
  };
}

/**
 * The user-unit size of one SVG document, from its root `width` and
 * `height` attributes, with the `viewBox` as the fallback.
 *
 * The renderer writes both, so the fallback is the belt beside the
 * suspenders: a hand-written document that carries only a viewBox still
 * exports.
 */
export function svgDocumentSize(svg: string): PngSize {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.nodeName === "parsererror" || root.getAttribute("width") === null) {
    throw new Error("the SVG document carries no size to export");
  }
  const width = Number(root.getAttribute("width"));
  const height = Number(root.getAttribute("height"));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height };
  }
  const viewBox = root.getAttribute("viewBox");
  if (viewBox !== null) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  throw new Error("the SVG document carries no size to export");
}

/**
 * Rasterize the canonical SVG bytes to one PNG blob.
 *
 * The browser decodes the SVG as an image and draws it onto a canvas at
 * the target size, so the raster holds the vector at the resolution the
 * fit names, then `toBlob` encodes the PNG.
 */
export async function rasterizeSvgToPng(svg: string, fit: EditorPngFit): Promise<Blob> {
  const documentSize = svgDocumentSize(svg);
  const size = pngSizeOf(documentSize.width, documentSize.height, fit);
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("the browser provides no 2d canvas to rasterize with");
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob === null) {
      throw new Error("the canvas wrote no PNG");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
