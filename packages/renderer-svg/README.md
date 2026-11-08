# @hatch/renderer-svg

The SVG renderer (specification sections 7, 11, and 12). One `RenderIR`
(specification section 22) enters, one SVG document leaves. SVG is the
canonical output of hatch: crisp, human-readable, editable, and
deterministic.

Since task T017 this package is also the V1 composition root: it binds the
`HatchEngine` of `@hatch/core` to every real stage collaborator.

## Render

```ts
import { renderSvg } from "@hatch/renderer-svg";

const svg = renderSvg(ir); // "<?xml version=...<svg ...>...</svg>"
```

`renderSvg(ir, rng?)` validates the intermediate representation against the
`RenderIR` schema of `@hatch/core` and throws one readable error when it is
malformed. The optional second argument overrides the seeded stream; by
default the renderer derives the `render` stage stream from the render
identity of the trace (`createRenderRng`).

`renderSvgDocument(ir, rng?)` renders the same bytes and also returns the
number of hatch strokes it drew and their total length in user units, which
the engine records as the `strokeCount` and `visualDensityScore` metrics of
the render trace (specification section 9E).

## The engine

The pipeline itself lives in `@hatch/core`: `HatchEngine` runs the
specification section 4 stages and returns the SVG, the parsed spec, the
intermediate representation, and the trace. The engine takes its
collaborators through the constructor, because every package it orchestrates
imports `@hatch/core` and cannot be imported back. This package wires them:

```ts
import { createV1Engine } from "@hatch/renderer-svg";

const engine = createV1Engine();
const result = engine.renderScene(spec);
result.svg;       // the SVG document
result.sceneSpec; // the parsed scene spec
result.ir;        // the intermediate representation
result.trace;     // one event per stage, plus metrics
```

- the presets come from `@hatch/styles`,
- the object generators from `@hatch/objects`,
- the region composition and the contour simplification from
  `@hatch/geometry`,
- the scene edit operations from `@hatch/agent` (task T023), which is what
  makes `engine.editScene(spec, operations)` work,
- the renderer from this package,
- and `V1_ZONE_FAMILIES` maps every region role of the V1 generators to the
  hatch family that fills it.

`createV1Engine(overrides)` replaces any collaborator wholesale, which is how
the tests spy on the stream a stage receives. Later rounds register more
presets and more object kinds without touching the wiring here.


## Document structure

The document is the region stack of specification section 7, in draw order:

1. `<metadata>` - the embedded metadata block, plain JSON: `generator`,
   `version`, `seed`, `preset`, `specHash` (specification section 9A).
2. `<defs>` - one `<clipPath>` per region that carries a `clip` extent,
   then one `<mask>` per mask of the intermediate representation, then one
   mark definition `<g id="sym-...">` per library entry the scene places.
3. The paper `<rect>` - filled with `style.palette.paper`, the negative
   space of the whole composition.
4. The regions, stacked by ascending `zIndex` (input order between equals).
   Each region is one `<g>` with `data-region-id`, `data-role`, and
   `data-zindex`, holding one `<path>` per hatch stroke of `@hatch/hatching`.
   The style stage paints the zones of one object inside one band per
   object, in the depth order of the plan, so the band of an object that
   stands in front draws above every band behind it; the `zIndex` a
   generator authors orders the zones of its own object alone. A `none`
   fill region keeps an empty group, so the stack shows where the negative
   space sits.
5. Mask wrappers - one nested `<g mask="url(#...)">` per mask, wrapped
   around the whole region stack.
6. The contour layer - `<g data-layer="contours">`, one `<path>` per
   contour stroke, over every hatch field. The style stage carves each
   stroke at the silhouette of every object that stands in front of the
   object the stroke belongs to, so the layer draws on top but never
   through a nearer object.
7. The symbol layer - `<g data-layer="symbols">`, one `<use>` per
   placement. Every `use` references the definition of the mark it places,
   so the document holds no dangling reference.
8. The debug overlays - one `<g data-layer="debug-...">` per enabled
   `debug` flag (see below), after every artwork layer and outside every
   mask wrapper, so they explain the drawing without changing it.

## Cloud cutouts as negative space

A mask with `invert: true` (the default) paints the full canvas white and
the mask path black inside `<mask maskUnits="userSpaceOnUse">`. SVG masks
work on luminance: white keeps the hatching, black hides it. The paper
rect sits below the wrappers and outside them, so the cloud shape shows
paper through the cutout (specification sections 3C, 7, and 24). A mask
with `invert: false` inverts the luminance and keeps only the inside of
its path.

The mask hides ink at composite time; it removes no geometry from the
markup. A render without its masks carries the identical stroke paths,
which keeps the output inspectable (specification section 22).

## Symbol marks and their definitions

A `SymbolPlacement` is a reference, not a copy. The `symbolLibrary` of the
intermediate representation is the one definition source: each entry carries
an `id` plus the strokes of the mark in its own local units, and a placement
names the entry by `symbolId`. The renderer emits one definition per placed
entry, a `<g id="sym-...">` inside `<defs>`, and points each `<use>` at it
through an allocated, XML-safe id, in library order. An entry that no
placement names adds nothing to the document.

The definition is a `g`, not an SVG `symbol` element. A `use` that names a
`symbol` instantiates a nested viewport that defaults to 100 percent of the
canvas, which clips and stretches a mark authored in local units: a stroke
at a negative local coordinate disappears. A `g` carries no viewport, so
the mark's local units reach the page verbatim, and the placement's
`translate`, `rotate`, and `scale` alone decide where and how large the mark
draws. (Verified against a browser renderer: the same mark placed through a
`symbol` lost its strokes below local x 0, while the `g` form drew the
whole mark.)

A placement that names no definition, and a library that defines one id
twice, both fail validation with a readable error. A scene never silently
loses its symbols.

## Debug overlays

The `debug` block of the scene spec (specification sections 5 and 9) turns
one render into its own blueprint. Each flag appends exactly one layer,
`<g data-layer="debug-...">`, named by `DEBUG_LAYER_NAMES`:

- `showRegions` - `debug-regions`: every region tinted and outlined in a
  cycling hue, dashed, in draw order, with `data-region-id`, `data-role`,
  `data-zindex`, and `data-order` on each path.
- `showDepthMap` - `debug-depth`: one tint per region in one shade, whose
  `fill-opacity` grows with the depth rank of the `zIndex`, plus
  `data-depth-rank`. Regions that share a `zIndex` share a rank.
- `showHatchDirections` - `debug-hatch-directions`: one arrow per hatch
  family, at the center of the region, pointing the way the strokes run,
  with `data-family`, `data-angle`, and `data-spacing`.
- `showNegativeSpace` - `debug-negative-space`: one tint per mask
  (`data-mask-id`, `data-invert`) and per `none` fill region
  (`data-unfilled`).
- `showAnchors` - `debug-anchors`: one circle and crosshair per object
  anchor of the intermediate representation, with `data-object-id`,
  `data-kind`, `data-role`, `data-depth`, and `data-depth-index`. A
  placement the planner had to clamp onto the canvas carries
  `data-position-clamped="true"`.
- `showConstructionLines` - `debug-construction`: the canvas frame, the
  horizon, one clip extent per region that carries one, and one horizontal
  plus one vertical axis per anchor, each named by `data-guide`.
- `showContourOnly` - `debug-contour-only`: an opaque paper wash over the
  canvas, then every contour stroke redrawn on top. The wash hides the
  artwork at composite time and removes no geometry from the markup - the
  same rule a cloud cutout mask follows.

The flags leave the render identity untouched: `sceneSpecHash` excludes the
`debug` block, so a render with overlays and the same scene without them
share one spec hash, one seeded stream, and identical hatch strokes. With
every flag off - no debug object, an empty one, or one of explicit false
flags - the output is byte-identical to a plain render.

## Determinism

Every random value flows from the seeded RNG of `@hatch/core`; the renderer
forks nothing itself and never calls the global random source. All numbers
format through one shared three-decimal writer. The same intermediate
representation, under the same render identity, serializes to identical
bytes (specification section 10).

## Modules

- `render.ts` - `renderSvg`, `renderSvgDocument`, and `createRenderRng`
- `debug.ts` - the debug overlay layers, one per `debug` flag
  (`DEBUG_LAYER_NAMES`, `debugLayerName`, `debugOverlayLayers`)
- `pipeline.ts` - the V1 composition root: `createV1Engine`
- `masks.ts` - mask and clip path elements
- `symbols.ts` - symbol definitions and resolving placements
- `metadata.ts` - the embedded metadata block
- `path-data.ts` - core paths as SVG `d` values
- `xml.ts` - the minimal deterministic XML writer
- `ids.ts` - XML-safe, unique ids for `url(#...)` references
- `format.ts` - deterministic number formatting
