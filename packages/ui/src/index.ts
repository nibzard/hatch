/**
 * Module entry for @hatch/ui.
 *
 * Scope from specification section 11: canvas preview, layer tree,
 * inspector, parameter controls, export panel. The browser application
 * itself starts at `index.html` and `src/main.tsx`; this entry exposes
 * the editor model - the state that maps every panel action to one spec
 * patch or one edit operation - so the Node test suite and any host page
 * reach it without the DOM.
 */

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/ui" as const;

/** One-line role of this package. */
export const packageRole =
  "Human editor: canvas preview, layer tree, inspector, hatch and composition controls, and export panel.";

// The editor model: state, actions, and the engine binding.
export * from "./editor/state.js";
export { engine, renderSpec, type EditorRender } from "./editor/engine.js";
export { STARTER_SCENES, type StarterScene } from "./editor/starters.js";
export {
  pngSizeOf,
  svgDocumentSize,
  type EditorPngFit,
  type PngSize,
} from "./editor/png.js";
