# @hatch/ui

The human editor of hatch (task T026, specification sections 11 and 23).
One React and Vite page holds every panel of the section 23 list:

- **Canvas preview** - the SVG document the engine produced, injected as
  markup, with the trace metrics and the spec hash in its footer.
- **Layer and object list** - the objects grouped under their draw roles,
  with selection, per-row remove, and the add form.
- **Inspector** - the fields of the selected object: kind, role,
  position, scale, rotation, and the params JSON.
- **Seed field and preset picker** - the toolbar controls that own the
  render identity (specification section 10).
- **Hatch controls** - one section per hatch family of the resolved
  style; every field writes one dotted style path.
- **Composition controls** - the camera and the composition blocks of
  specification section 5.
- **Debug toggles** - one checkbox per debug flag of sections 5 and 9.
- **Spec panel** - the JSON of the spec under edit, with Apply, Open
  file, and Download.
- **Export panel** - the SVG as the canonical bytes, the PNG as one
  raster of them.

## The render loop

The page runs the real compiler inside the browser. `@hatch/ui` imports
`createV1Engine` from `@hatch/renderer-svg` and bundles the whole
pipeline - the engine, the object generators, Paper.js - into the page,
so the canvas shows the canonical output of the same compiler the CLI
and the golden fixtures use. No server stands behind the canvas.

Every panel dispatches one action to the state model (`src/editor/state.ts`).
Object edits and style edits apply through the edit operations of
specification section 21 - `engine.editScene` with `moveObject`,
`setStyle`, `replaceObject`, `addObject`, and `removeObject` - so edits
patch the spec, never the pixels (section 15). The seed field, the preset
picker, the camera and composition controls, and the debug toggles patch
their spec blocks directly, because section 21 defines no operations for
them. Every write validates before it commits; a rejected write keeps the
last valid spec and names the reason in the error bar.

The PNG export rasterizes the same SVG bytes through the browser canvas.
The canonical offline raster stays `@hatch/export` on `resvg-js`; this
package does not import it, because a page cannot carry a native module.

## Commands

```sh
pnpm --filter @hatch/ui run dev     # the editor at a local port
pnpm --filter @hatch/ui run build   # the production bundle into dist/
pnpm --filter @hatch/ui test        # the Vitest unit suite (Node)
pnpm --filter @hatch/ui run test:smoke  # build, then the Playwright smoke suite
```

The smoke suite serves the production build through `vite preview` on a
free port and walks the acceptance of the task: load a spec, edit it
through the operations, re-render, export SVG and PNG.

The browser binary is a prerequisite of the smoke suite, not of
`pnpm install`. One install serves the golden-image suite too:

```sh
pnpm --filter @hatch/gate exec playwright install chromium
```

`pnpm verify` runs the smoke suite as its own gate step, after the
visual regression suite.

## Layout

- `index.html`, `src/main.tsx`, `src/App.tsx` - the page and its panels
- `src/editor/` - the state model, the engine binding, the starter
  scenes, the PNG raster, and the download helper
- `src/components/` - one module per panel
- `test/` - the Vitest unit suite over the state model and the pixel math
- `e2e/` - the Playwright smoke suite

The starter scenes import from `examples/scenes/`, the same directory the
release gate reads, so the editor and the golden fixtures never drift
apart.
