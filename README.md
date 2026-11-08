# hatch

hatch is a deterministic, style-aware vector scene compiler. A structured
JSON scene specification passes through planning, geometry synthesis, and
style application. The renderer draws the scene as a hatched illustration
built from region-based line fills, negative space, and contour lines.
SVG is the canonical output. PNG export rasterizes it, and PDF export
carries the same vectors to print.

The requirements live in one file: [docs/SPEC.md](docs/SPEC.md).

## Engine

The `HatchEngine` facade of specification section 21 compiles one scene
spec. The pipeline lives in `@hatch/core`; `@hatch/renderer-svg` binds it to
the real stages:

```ts
import { createV1Engine } from "@hatch/renderer-svg";

const engine = createV1Engine();
const result = engine.renderScene(spec);
// result.svg, result.sceneSpec, result.ir, result.trace
```

The same spec, seed, and preset always produce the same bytes
(specification section 10), and every render leaves a JSON trace with one
event per stage. The trace ends in the full output metric set of
specification section 9E: the region count, the stroke count, the SVG size
in bytes, the export duration, and the visual density score, which is the
total hatch stroke length over the canvas area. The export duration is the
one measured value, so two renders of the same inputs share every trace
byte except it.

The geometry event of the trace also states what the object grammar of the
style omitted (specification section 9B): for every object, the internal
boundaries its generator emitted, the ones the detail budget kept, and the
ones the style dropped. A building block that draws eight window and floor
lines under a budget of four records eight emitted, four kept, and four
dropped, so a reader sees the simplification instead of guessing it from
the budget number.

## Scene diffing

`@hatch/agent` diffs two scene specs at the semantic level. The diff lists
one change per semantic difference, each with a dotted path, the values on
both sides, and one sentence a reader can act on:

```ts
import { diffSceneSpecs, formatSceneDiff } from "@hatch/agent";

const updated = engine.editScene(spec, [
  { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
]);
const diff = diffSceneSpecs(spec, updated);
// diff.equal, diff.changes, diff.summary
console.log(formatSceneDiff(diff));
```

Objects are compared by id, so a moved object reads as one change, and
free-form blocks (`environment.sky`, `styleOverrides`) are walked key by
key. The `debug` block is a view switch, not scene content, so the diff
ignores it, the same way the spec hash does.

## Camera and composition

The `camera` and `composition` blocks of the spec drive the planning stage
(specification section 5). `@hatch/core` reads them in one place, the camera
model, and turns them into the placement of every object:

- `camera.framing` scales the subject the frame holds. `close` draws the
  same scene about 53 percent larger than `wide`.
- `camera.lens` sets the base depth exaggeration. A `normal` lens keeps the
  depth stack nearly flat; an `ultra-wide` lens separates near from far.
- `camera.perspectiveStrength` scales the base of the lens. `0` flattens the
  stack whatever lens the camera carries. The field is optional and defaults
  to the full base.
- `camera.tilt` rolls the framing in degrees. The horizon, the anchors, and
  every object lean with it. The planner clamps the roll to 12 degrees,
  which keeps the horizon on a wide canvas.
- `composition.balance` moves the layout off the vertical center line
  (`left`, `right`) or spreads it away from that line (`asymmetric`).
- `composition.depthLayers` says how many planes the depth stack spans.
  `1` is flat, and the four draw roles span at most `4`.
- `composition.focalPoints` names the objects the composition emphasizes.
  Each one draws 25 percent larger. A name no object carries is rejected.
- `composition.negativeSpace` says how much of the paper stays free of hatch
  ink. It is the one control of the two blocks that changes ink, not
  placement; see below.

Each control composes into one scale and one rotation per object, which the
geometry stage applies beside the anchor. The planning event of the trace
records the whole decision, including every clamp, so a reader sees why the
render differs from what the spec wrote.

`composition.negativeSpace` states the share of the paper the render keeps
empty, and the style names its own reference: the `minEmptyAreaRatio` of the
preset's composition grammar. An ask that meets the floor renders the preset
exactly as stated, so the tuned families of every preset stay reachable. Each
`0.1` of `negativeSpace` above the floor opens every hatch spacing by 12
percent, and each `0.1` below tightens it the same way. The scene regions and
the object zones both open, the stroke weight never moves - the tone grows
lighter without growing thinner, and `environment.atmosphere.fog` stays the
control that thins ink - and `paper` zones stay paper whatever the ask. The
rain region keeps the density its own count names, because
`environment.atmosphere.rain` states its stroke count instead of its spacing.
The moderation never tightens a spacing below 30 percent of what the preset
states, and the planning event of the trace records the goal, the floor, the
multiplier, and the clamp.

## Environment and style roles

The `environment.type` field, the `environment.sky` block, the
`environment.ground` block, and the `environment.atmosphere` block drive the
render the same way, beside the `styleRole` field of an object. `@hatch/core`
reads every environment key in one place, the environment model, and every
key the block accepts has one documented effect:

- `environment.type` names the world the scene draws, and every preset names
  the world it styles. The intent stage checks the two against each other,
  so the field owns the pairing of a scene with its style: a spec that says
  `coastal` under `pastoral-v1` fails before any stage runs, with a message
  that names the pair, the presets that draw the family it asked for, and
  the two fixes. `custom` names no family, so it pairs with every preset -
  it is how a scene states a cross-pairing on purpose. A family no preset
  draws yet fails the same way: `interior` waits for the `interior-v1`
  preset. The editor preset picker moves the type with the preset, so the
  page never holds a pair the compiler rejects. The intent event of the
  trace records the type of the scene beside the family of its preset.
- `environment.sky.cloudCount` draws cloud cutouts over the sky region. The
  count is an integer from `0` to `12`. Each cutout is negative space: the
  hatch of the sky passes under it and the paper shows through, so a cloud
  reads as a hole in the field, never as an object.
- `environment.ground.strips` draws mown-field lines across the ground plane,
  from the horizon down. The planning stage lays them out; the style stage
  strokes them inside the visible ground, so each line stops at the objects
  that stand over it. The count is an integer from `0` to `6`.
- `environment.atmosphere.fog` fades the ink of every object by its draw
  depth. At full fog the background plane keeps 35 percent of its hatch
  weight, the midground about 57, and the focal plane keeps all of it. The
  strength clamps into `[0, 1]`, and the clamp is recorded in the trace.
- `environment.atmosphere.rain` draws diagonal rain strokes over the whole
  scene, above every object zone. The count is an integer from `0` to `160`
  and sets the stroke spacing across the canvas width.
- `styleRole` on an object replaces the hatch family every zone of that
  object resolves to. It names one fill role of specification section 16D,
  for example `sky hatch` or `water hatch`; `paper` leaves the object as
  negative space. The schema rejects any other string at parse time.

A key outside this vocabulary is rejected by name, so a spec that asks for
sky `storminess`, `haze`, or a ground `material` fails instead of rendering
an unchanged composition. The planning event of the trace records the cloud
count, the ground strip count, the fog with its clamp, and the rain count.

The environment family of each preset is part of its grammar:
`pastoral-v1` draws `rural`, `coastal-v1` draws `coastal`, `urban-v1` draws
`urban`, and `skatepark-v1` draws `skatepark`. `@hatch/styles` answers the
pairing both ways - `environmentTypeOfPreset` reads the family of one
preset, and `presetIdsForEnvironment` lists the presets of one family, which
is the lookup a prompt planner needs before it writes the pair.

## Depth and occlusion

The planner stacks the objects by draw role, then by spec order. An object
that draws later in that order stands in front, and the ink of the objects
behind it stops at its silhouette:

- The hatch of every object zone is carved at the silhouette of each object
  in front of it. The scene regions take the same cutouts, which is why the
  sky and the ground hatch stop where an object stands.
- The contour strokes and the internal boundaries of an object stop at the
  same silhouettes. The carve runs after the wobble, so the drawn ink itself
  stops where the covering object starts: a wave line of the sea never draws
  through a rock that stands over it.
- The front object keeps every line of its own. Its silhouette never carves
  its zones or its lines away, so its own layering - wall under roof, roof
  under glass - keeps drawing inside it.

The renderer paints the same order. The zones of one object draw inside one
zIndex band per object, in depth order, so the object in front paints above
every object behind it. The zIndex a generator authors orders the zones of
its own object alone - a road that authors 6 for its pavement never paints
under a wall that authors 10 behind it - and the rain of the atmosphere
draws in one band above every object.

Each contour stroke of the intermediate representation names the object it
draws in `objectId`, so a test or a debugger can ask which object a line
belongs to.

## Editing

Edits patch the spec, never the pixels (specification section 15): an
operation states its change in the structured scene language, and the
caller re-renders the result. `engine.editScene` applies a list of the
five operations of specification section 21 and returns the updated spec.
The operations live in `@hatch/agent`; `createV1Engine` wires them in.

```ts
const updated = engine.editScene(spec, [
  { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
  { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
  { op: "replaceObject", id: "house-1", with: { kind: "quarter-pipe" } },
  { op: "addObject", object: { id: "bench-1", kind: "bench", position: { x: 0.4, y: 0.9 }, scale: 1 } },
  { op: "removeObject", id: "hill-1" },
]);
const result = engine.renderScene(updated);
```

`moveObject` shifts a position in normalized scene space. `setStyle`
writes one dotted style path into `styleOverrides`. `replaceObject` swaps
an object's kind and keeps every field the patch leaves out.
`addObject` appends one object under a fresh id. `removeObject` drops an
object and the focal points that name it. The input spec is never
mutated, and an edit that cannot apply throws one error that names the
operation and the ids involved.

The interactive editor of `@hatch/ui` drives the same operations from a
page: every panel edit becomes one operation (or one spec patch, for the
controls section 21 defines no operation for), the canvas re-renders
through the same engine in the browser, and the export panel writes the
SVG and a PNG raster of it. Open it with:

```
pnpm --filter @hatch/ui run dev
```

## PNG export

SVG stays the source of truth (specification section 12). `@hatch/export`
rasterizes the same bytes with `resvg-js`, so a PNG is a preview of one
document, never a second rendering path:

```ts
import { svgToPng } from "@hatch/export";

const { png, width, height } = svgToPng(result.svg, {
  fit: { mode: "width", value: 480 },
});
```

Name a pixel width, height, or zoom factor. The other edge follows the
aspect ratio of the document, so a 4:3 scene exports at 480 x 360. The same
SVG bytes under the same options give the same PNG bytes.

## PDF export

`svgToPdf` translates the same bytes into a vector PDF for print. It walks
the document's paths, clips, cloud cutout masks, and symbol placements, and
writes them as PDF operators. No raster step runs in between, so every
stroke stays a vector at any print scale:

```ts
import { svgToPdf } from "@hatch/export";

const { pdf, width, height } = svgToPdf(result.svg, {
  fit: { mode: "width", value: 612 },
});
```

One SVG user unit becomes one PDF point by default, so a 1024 x 768 scene
exports as a 1024 x 768 point page. A named width, height, or zoom resizes
the page and keeps the aspect ratio. The file holds no timestamp and no
random object id, so the same SVG bytes give the same PDF bytes.

## Examples

`examples/` holds the seeded example scenes of the V1 release. Each scene is
one JSON spec that uses the five V1 objects, cloud cutouts, the paper
background, and the `pastoral-v1` preset. See
[examples/README.md](examples/README.md).

```
pnpm build
node examples/render.mjs
```

The script writes SVG, PNG, PDF, and trace files under `examples/output/`,
which Git ignores. The golden SVG fixtures under `examples/golden/` stay
tracked, and the release gate matches every render against them.

## Packages

Specification section 11 defines nine packages. They live under
`packages/` in a pnpm workspace:

- `@hatch/core`: scene, style, region, geometry, and trace types
- `@hatch/geometry`: splines, offsets, clipping, simplification, and
  region composition, on top of Paper.js
- `@hatch/hatching`: the region hatch generation engine
- `@hatch/objects`: object generators, for example tree, cottage, and tram
- `@hatch/styles`: style presets, for example pastoral-v1 and urban-v1
- `@hatch/renderer-svg`: the SVG renderer and its debug layers
- `@hatch/export`: SVG to PNG and PDF export
- `@hatch/agent`: prompt-to-spec, validation, edits, and diffing
- `@hatch/ui`: the human editor, a React and Vite page that renders with
  the same engine in the browser and edits scenes through the edit
  operations (specification section 23)

Each package is one workspace project under `packages/`. It holds the
TypeScript source in `src/`, the Vitest tests in `test/`, and the build
output in `dist/`.

## Toolchain

The project needs Node 24 and pnpm 10. The toolchain is:

- `pnpm-workspace.yaml`: the workspace root over `packages/*`
- `package.json`: the workspace scripts `build`, `typecheck`, `test`, and `verify`
- `scripts/verify.mjs`: the verify gate
- `tests/visual/playwright.config.ts`: the headless Playwright suite of the
  golden images, with its committed baselines - the PNG bytes the exporter
  writes - under `tests/visual/baselines/`
- `packages/ui/vite.config.ts`: the browser build of the editor app
- `packages/ui/playwright.config.ts`: the headless Playwright smoke suite
  of the editor, over `vite preview` of the production build
- `tsconfig.base.json`: the shared compiler options in strict mode
- `tsconfig.json`: one typecheck pass over every Node-side package
- `packages/ui/tsconfig.json`: the typecheck pass of the browser app, with
  the DOM environment and JSX
- `packages/<name>/tsconfig.json`: typecheck for `src/` and `test/`
- `packages/<name>/tsconfig.build.json`: build of `src/` into `dist/`;
  `@hatch/ui` builds with Vite instead

Cross-package imports resolve through the built `dist/` directories. Run
`pnpm build` before `pnpm typecheck` once packages import each other.

## Verify

From a fresh clone, run:

```
pnpm install
pnpm verify
```

`pnpm verify` is the one-command gate. It runs these steps in order and
stops at the first failure:

1. **Prepare build**: `pnpm build` from a clean `dist/`. Cross-package
   imports resolve through `dist/`, so the gate builds before it
   typechecks.
2. **Typecheck**: `pnpm typecheck`, one strict pass over `src/` and
   `test/` in every package.
3. **Unit tests**: `pnpm test`, the Vitest suite of every package plus the
   repository gates under `tests/`. The V1 release gate renders every
   example scene twice, runs the specification section 24 checklist, and
   matches the bytes against the golden fixtures under `examples/golden/`.
4. **Visual regression**: the Playwright golden-image suite under
   `tests/visual/`, headless. Each case renders a scene to PNG and stands
   against one committed baseline under `tests/visual/baselines/` twice:
   the PNG bytes must match byte for byte, and Chromium must show the
   same pixels. The byte comparison is the zero-tolerance gate, because
   the browser comparator drops a lone drifted pixel that lands on an
   antialiasing-looking position. One drifted pixel fails the gate,
   wherever it lands. The step needs the Playwright browser binary:
   `pnpm --filter @hatch/gate exec playwright install chromium`.
5. **Editor smoke**: the Playwright smoke suite of `@hatch/ui`, headless
   over `vite preview` of the production build. The page loads a spec,
   edits it through the five edit operations of specification section
   21, re-renders, and exports SVG and PNG. The step shares the browser
   binary of the visual suite.
6. **Determinism gate**: a second clean build. Every file in `dist/`
   must be byte-identical to the first build. Identical source must
   give identical output (specification section 10). Later rounds add
   scene-render byte identity to this step.

The command exits 0 when every step passes. It exits non-zero when any
single step fails. Later rounds extend the gate. They never weaken it.
