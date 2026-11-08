/**
 * The V1 composition root (specification sections 4, 11, and 21).
 *
 * The pipeline itself lives in @hatch/core: {@link HatchEngine} owns the
 * stage order, the trace, and the render identity. The engine cannot import
 * the packages it orchestrates, because they all import it, so every stage
 * enters through constructor collaborators.
 *
 * This module is the one place that binds them: the presets of
 * @hatch/styles, the object generators of @hatch/objects, the boolean
 * region composition and the contour simplification of @hatch/geometry, the
 * edit operations of @hatch/agent, and the SVG renderer of this package. A
 * caller that wants the whole V1 compiler needs one function:
 *
 * ```ts
 * const engine = createV1Engine();
 * const result = engine.renderScene(spec); // svg, sceneSpec, ir, trace
 * const updated = engine.editScene(spec, edits); // specification section 21
 * ```
 *
 * Later rounds extend the collaborators, never the stage order: more
 * presets and more object kinds register without a change here, and the
 * high-level prompt entry of specification section 21 arrives with the
 * round that owns it.
 */

import { sceneEditSource } from "@hatch/agent";
import {
  HatchEngine,
  type HatchEngineOptions,
  type ZoneFamilyTable,
} from "@hatch/core";
import {
  carveStroke,
  clipStroke,
  composeRegion,
  simplifyPath,
} from "@hatch/geometry";
import { generateSceneObject, STYLE_ZONE_ROLES } from "@hatch/objects";
import { listStylePresets, resolveStyle } from "@hatch/styles";

import { renderSvgDocument } from "./render.js";

/**
 * The zone family table of the engine: every region role the planner and
 * the object generators emit, mapped to the hatch family that fills it
 * (specification sections 8 and 16D).
 *
 * The object entries come from the role vocabulary of @hatch/objects, so a
 * generator that adds a role and registers it there reaches the engine
 * without an edit here. The two environment roles - the sky and the ground
 * the planner lays out - complete the table.
 */
export const V1_ZONE_FAMILIES: ZoneFamilyTable = {
  sky: "sky",
  ground: "field",
  ...Object.fromEntries(
    STYLE_ZONE_ROLES.map((role) => [role.role, role.family]),
  ),
};

/**
 * Build one engine wired to every V1 stage.
 *
 * Pass `overrides` to swap a collaborator in tests, for example a renderer
 * that records what it received. Every option the object carries replaces
 * the default wholesale.
 */
export function createV1Engine(
  overrides: Partial<HatchEngineOptions> = {},
): HatchEngine {
  const options: HatchEngineOptions = {
    styles: { listPresets: listStylePresets, resolve: resolveStyle },
    objects: { generateObject: generateSceneObject },
    renderer: { render: (ir, rng) => renderSvgDocument(ir, rng) },
    zoneFamilies: V1_ZONE_FAMILIES,
    tools: {
      composeRegion,
      simplifyContour: simplifyPath,
      clipContour: clipStroke,
      carveContour: carveStroke,
    },
    edits: sceneEditSource,
    ...overrides,
  };
  return new HatchEngine(options);
}
