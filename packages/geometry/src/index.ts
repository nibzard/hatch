/**
 * Module entry for @hatch/geometry.
 *
 * Scope from specification section 11: splines, offsets, clipping,
 * simplification, and region composition. Every helper reads and writes
 * the JSON-safe path model of @hatch/core and runs its geometry through
 * Paper.js (specification sections 2 and 20). All helpers are pure
 * numeric code: the same input always gives the same output
 * (specification section 10).
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/geometry" as const;

/** One-line role of this package. */
export const packageRole =
  "Splines, offsets, clipping, simplification, and region composition.";

// The Paper.js bridge: scope setup and path model conversion.
export * from "./paper.js";

// Splines through anchor points.
export * from "./spline.js";

// Path offsets at a fixed distance.
export * from "./offset.js";

// Boolean clipping of regions and clipping of open strokes.
export * from "./clip.js";

// Simplification within a tolerance.
export * from "./simplify.js";

// Corner rounding at a share of the shorter adjacent segment.
export * from "./round.js";

// Region composition: clip extents, masks, and draw order.
export * from "./compose.js";

// Length, bounds, area, inside tests, and sampling.
export * from "./measure.js";
