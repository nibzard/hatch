/**
 * Module entry for @hatch/hatching.
 *
 * Scope from specification section 11: parallel strokes, crosshatching,
 * jitter, clipping to paths, line dropout, pressure variation. The engine
 * fills one region at a time: it places the line systems of the region
 * fill, humanizes every line from the texture values of the style, and
 * clips each line to the region path (specification sections 7 and 17).
 * Every random value flows from the seeded RNG of @hatch/core, so
 * identical seeds give identical stroke sets (specification section 10).
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/hatching" as const;

/** One-line role of this package. */
export const packageRole =
  "Parallel strokes, crosshatch, jitter, clipping, dropout, and pressure variation.";

// The stroke records one region fill produces.
export * from "./stroke.js";

// Parallel line placement over a region extent.
export * from "./lines.js";

// Humanization of one stroke, driven by the style texture.
export * from "./jitter.js";

// The region hatching engine.
export * from "./engine.js";
