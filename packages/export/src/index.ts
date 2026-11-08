/**
 * Module entry for @hatch/export.
 *
 * Scope from specification section 11: SVG to PNG, SVG to PDF, thumbnails,
 * preview sheets. SVG to PNG landed with T018 through `resvg-js`
 * (specification sections 2, 12, and 24), the raster preview a V1 release
 * ships beside its canonical SVG. T030 adds SVG to PDF: one translation
 * of the same vector geometry into a print document, never a raster of
 * it. Thumbnails and preview sheets build on the two conversions once
 * more outputs exist to arrange.
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/export" as const;

/** One-line role of this package. */
export const packageRole = "SVG to PNG, SVG to PDF, thumbnails, and preview sheets.";

// SVG to PNG: one rasterization of the canonical SVG bytes.
export * from "./png.js";

// Byte-level inspection of the PNG files this package writes.
export * from "./png-info.js";

// SVG to PDF: one vector translation of the canonical SVG bytes.
export * from "./pdf.js";

// Byte-level inspection of the PDF files this package writes.
export * from "./pdf-info.js";
