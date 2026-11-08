/**
 * Module entry for @hatch/core.
 *
 * Scope from specification section 11: SceneSpec, StyleSpec, Region, Geometry,
 * and RenderTrace. Task T010 adds the scene, style, region, fill, geometry,
 * IR, and trace schemas as Zod schemas plus TypeScript types, and exports all
 * of them from this package root. Task T011 adds the seeded RNG that drives
 * every render stage. Task T017 adds the pipeline itself: the spec hash, the
 * planning stage, contour humanization, and the HatchEngine facade.
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/core" as const;

/** One-line role of this package. */
export const packageRole =
  "Scene, style, region, geometry, and trace types shared by every stage.";

// JSON values and serializable paths.
export * from "./json.js";
export * from "./path.js";

// Region fills and the region primitive (specification section 7).
export * from "./fill.js";
export * from "./region.js";

// The style grammar (specification section 8).
export * from "./style.js";

// The scene description model (specification section 5).
export * from "./scene.js";

// The camera and composition model the planner follows (specification
// sections 4B, 5, and 18).
export * from "./camera.js";

// The environment model: the sky, ground, and atmosphere blocks of the
// spec (specification sections 4B, 4D, and 5).
export * from "./environment.js";

// The negative-space model: the empty share the composition asks for
// (specification sections 5, 8, 15, and 18).
export * from "./negative-space.js";

// The object grammar model: the detail every object of a style may carry
// (specification sections 3C, 8, and 18).
export * from "./object-grammar.js";

// The style role vocabulary of SceneObject.styleRole (sections 5 and 16D).
export * from "./style-role.js";

// Object geometry output (specification sections 6 and 11).
export * from "./geometry.js";

// Traces and metrics (specification sections 4 and 9).
export * from "./trace.js";

// The style-aware intermediate representation (specification section 22).
export * from "./ir.js";

// Deterministic seeded randomness for every render stage (specification
// sections 2, 10, and 17).
export * from "./rng.js";

// Canonical JSON and the scene spec hash (specification sections 9A and 10).
export * from "./hash.js";

// The scene planning stage (specification sections 4B, 5, and 18).
export * from "./plan.js";

// Contour humanization (specification sections 4D, 8, and 17).
export * from "./contour.js";

// The scene compiler pipeline and the engine facade (specification
// sections 4, 9, 10, 21, and 22).
export * from "./engine.js";

// Shared parse error formatting.
export * from "./error.js";
