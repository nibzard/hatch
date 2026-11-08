/**
 * The Vite configuration of the editor (task T026, specification sections
 * 11 and 23).
 *
 * `@hatch/ui` is one browser application, not a workspace library: it
 * imports the compiler through the built `dist/` directories of its
 * workspace siblings, exactly like every other cross-package import in
 * this repository, and bundles the whole pipeline - the engine, the
 * object generators, Paper.js - into the page. The editor therefore
 * renders inside the browser with no server behind it, and the SVG it
 * shows is the canonical output of `createV1Engine`, not a re-imagined
 * preview.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // The compiler itself targets ES2023 (tsconfig.base.json); match it so
    // the bundle runs in the same language surface the packages test.
    target: "es2023",
    sourcemap: true,
  },
});
