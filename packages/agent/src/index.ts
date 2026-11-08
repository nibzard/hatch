/**
 * Module entry for @hatch/agent.
 *
 * Scope from specification section 11: prompt-to-spec, spec validation,
 * edit operations, scene diffing. Task T023 adds the edit operations of
 * specification section 21: `moveObject`, `setStyle`, `replaceObject`,
 * `addObject`, and `removeObject`, which patch the scene spec and never
 * the pixels (specification section 15). Task T027 adds the scene diffing
 * of the V3 round: `diffSceneSpecs` lists the semantic changes between two
 * specs. The prompt-to-spec planner arrives with the round that owns it.
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/agent" as const;

/** One-line role of this package. */
export const packageRole = "Prompt-to-spec, spec validation, edit operations, and scene diffing.";

// Scene edit operations (specification sections 15 and 21).
export * from "./edits.js";

// Scene diffing (specification sections 9, 15, and 24 V3).
export * from "./diff.js";
