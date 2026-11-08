/**
 * The compiler binding of the editor (specification sections 11 and 21).
 *
 * One `createV1Engine()` runs the whole pipeline inside the page: the
 * browser bundles the engine, the object generators, and Paper.js, and
 * renders the spec client-side with no server behind it. The SVG the
 * canvas shows is therefore the canonical output of the same compiler the
 * CLI, the agent API, and the golden fixtures use - not a second preview
 * path.
 *
 * The PNG export of the panel is a raster of these same bytes drawn
 * through the browser canvas; the canonical raster of a release remains
 * `@hatch/export`, which this package deliberately does not import,
 * because `resvg-js` is a native module and no browser bundle carries it.
 */

import type { RenderResult, SceneSpec } from "@hatch/core";
import { createV1Engine } from "@hatch/renderer-svg";

/** The V1 compiler the editor renders with (specification section 21). */
export const engine = createV1Engine();

/** One render attempt: the result when the spec compiled, the reason when not. */
export interface EditorRender {
  readonly result: RenderResult | null;
  readonly error: string | null;
}

/**
 * Compile one spec for the canvas.
 *
 * The state model validates every write, so a render failure here is rare
 * - a preset the registry dropped, a generator the spec names - but the
 * page must survive it: the failure lands in `error` and the App keeps
 * the last result that rendered.
 */
export function renderSpec(spec: SceneSpec): EditorRender {
  try {
    return { result: engine.renderScene(spec), error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
