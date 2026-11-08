/**
 * Module entry for @hatch/renderer-svg.
 *
 * Scope from specification section 11: paths, patterns, stroke output, debug
 * layers, metadata embedding. Task T014 covers the V1 core: the paper
 * background, the region stack by zIndex, clipping masks, cloud cutout
 * masks as negative space, contour strokes, and the embedded metadata
 * block (specification sections 7, 11, and 12). Task T022 adds the debug
 * overlays of specification sections 5 and 9, one layer per `debug` flag.
 * Symbol definitions in `defs`, one per placed mark of the
 * symbol library, arrive with task T034. Task T017 makes this package the
 * V1 composition root: `createV1Engine` binds the HatchEngine of
 * @hatch/core to the presets, the object generators, the geometry tools,
 * and this renderer.
 *
 * The renderer consumes the RenderIR of specification section 22 and emits
 * one SVG document. Every random value flows from the seeded RNG of
 * @hatch/core, so identical render identity gives identical bytes
 * (specification section 10).
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/renderer-svg" as const;

/** One-line role of this package. */
export const packageRole =
  "SVG output: paths, patterns, strokes, debug layers, and metadata.";

// Deterministic number formatting.
export * from "./format.js";

// The minimal deterministic XML writer.
export * from "./xml.js";

// Core paths as SVG path data.
export * from "./path-data.js";

// Hatch strokes as fitted, compact path runs (task T036).
export * from "./strokes.js";

// XML-safe, unique ids for url(#...) references.
export * from "./ids.js";

// Masks and clip paths, including cloud cutouts as negative space.
export * from "./masks.js";

// Symbol marks: definitions in `defs`, placements as resolving `use` elements.
export * from "./symbols.js";

// Debug overlays: one layer per `debug` flag of the scene spec.
export * from "./debug.js";

// The embedded metadata block.
export * from "./metadata.js";

// The renderer itself.
export * from "./render.js";

// The V1 composition root: the engine bound to every real stage.
export * from "./pipeline.js";
