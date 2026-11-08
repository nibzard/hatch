/**
 * Module entry for @hatch/objects.
 *
 * Scope from specification section 11: object generators - tree, cottage,
 * lighthouse, mountain, bowl, rail, bench, fence, human figure, cloud
 * bank, road, tram, building block. Specification section 24 fixes the
 * five V1 objects, and round 2 expands the library with the skatepark
 * objects bowl, quarter pipe, handrail, skater, fence, and bench, and the
 * urban objects tram, building block, streetlight, car, road, and lamp
 * post. The coastal kinds of sections 1, 5, and 14 - lighthouse, cliff,
 * and rock - join the registry with the round that renders coastal scenes.
 * Later rounds keep extending the registry.
 *
 * A generator maps the semantic parameters of specification section 6 to a
 * Geometry: a silhouette, contour lines, internal boundaries, and style
 * zones. Nothing here emits SVG; the style application stage and the
 * renderer own that (section 6: TreeObject -> TreeGenerator -> Geometry ->
 * StyledRegions -> SVG).
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/objects" as const;

/** One-line role of this package. */
export const packageRole =
  "Semantic object generators, for example tree, cottage, bowl, and tram.";

// The generator contract and the registry of every shipped object
// (specification sections 6 and 24).
export * from "./generator.js";

// Semantic parameter spaces and their parsing.
export * from "./parameters.js";

// Small path constructors shared by the generators.
export * from "./shapes.js";

// The object grammar pass of the geometry synthesis stage (specification
// sections 3C, 8, and 18).
export * from "./grammar.js";

// Local frame to scene placement.
export * from "./placement.js";

// The style zone role vocabulary the generators emit.
export * from "./roles.js";

// The five V1 generators (specification section 24).
export * from "./house.js";
export * from "./tree.js";
export * from "./hill.js";
export * from "./mountain.js";
export * from "./water.js";

// The skatepark objects of round 2 (specification sections 5 and 24).
export * from "./bowl.js";
export * from "./quarter-pipe.js";
export * from "./handrail.js";
export * from "./skater.js";
export * from "./fence.js";
export * from "./bench.js";

// The urban objects of round 2 (specification sections 5 and 24).
export * from "./tram.js";
export * from "./building-block.js";
export * from "./streetlight.js";
export * from "./car.js";
export * from "./road.js";
export * from "./lamp-post.js";

// The coastal objects of the specification (sections 1, 5, 14, and 16).
export * from "./lighthouse.js";
export * from "./cliff.js";
export * from "./rock.js";

// The scene object facade of the geometry synthesis stage.
export * from "./scene-object.js";
