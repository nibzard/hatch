# @hatch/hatching

The region hatch generation engine. One region enters, one stroke set
leaves: the engine places the line systems of the region fill, humanizes
every line from the `texture` values of the style, and clips each line to
the region path (specification sections 7, 11, and 17).

## Use

```ts
import { createStageRng } from "@hatch/core";
import { hatchRegions } from "@hatch/hatching";
import { pastoralV1 } from "@hatch/styles";

const rng = createStageRng(sceneSeedParts, "style");
const sets = hatchRegions(regions, pastoralV1, rng);

for (const set of sets) {
  console.log(set.regionId, set.strokes.length, set.density.toFixed(3));
}
```

Each region forks its own stream under `hatch:<region id>`, and each line
family forks again under `a` or `b`. Adding a region or changing one family
never shifts the numbers of another, so a scene edit changes only the
strokes it touches.

## API

- `hatchRegion(region, style, rng)`: the stroke set of one region. The
  region parses against the `Region` schema first. A `none` fill, an empty
  clip result, or a degenerate area gives an empty set, so a negative-space
  region keeps its place in the trace.
- `hatchRegions(regions, style, rng)`: the sets of many regions, in
  ascending `zIndex` with the input order kept between equals. Region ids
  must be unique, because the fork label of a region is its id.
- `HatchStroke`: one generated line. It carries its `path`, its pressure
  varied `weight`, its `color`, its `family` (`"a"` or `"b"`), and the
  `angle` and `spacing` that placed it. The last two feed the hatch
  direction map of specification section 9.
- `HatchSet`: the strokes of one region, plus its fill `kind`, its
  `droppedStrokeCount`, and its `density` (total stroke length over region
  area), which feeds the visual density score of the render trace.

## Containment

Every stroke stays inside its region. The engine applies the jitter first,
then clips: it builds the wavy line, clips it to the region with
`clipStroke`, keeps the inner pieces, and only then trims the ends. A hole
in the region stops a line as surely as the outer contour does, because the
clipper tests every piece against the full compound path.

Section 17 also asks for slight over-shoot at boundaries. The engine only
under-shoots, because a stroke that leaves its region would break the
containment rule the renderer and the tests rely on.

## The deviation budget

One knob drives every geometric humanization effect: the irregularity
amplitude of a family.

```
amplitude = family.jitter + texture.lineJitter
```

The zone states its own irregularity and the texture adds the same paper
irregularity to every zone. Every humanized stroke keeps one promise: it
stays within `amplitude` user units of its ideal line. The budget splits
into two shares.

| Effect | Share | Rule |
| --- | --- | --- |
| Angle drift | 40 percent | The drift of one line is bounded so the rise of the tilted line over half its extent stays inside the share. A 1000 unit sky line drifts a fraction of a degree. A 50 unit foliage line drifts several degrees. |
| Waviness | 60 percent | Two sine waves carry the share. `texture.paperNoise` takes its slice of it at a much shorter wavelength, which reads as grain dragging the pen. |

The remaining texture values map one to one.

| Effect | Knob | Rule |
| --- | --- | --- |
| Spacing variance | `amplitude` over `spacing` | Local spacing varies by that fraction, capped at 30 percent, because a line that wobbles by `amplitude` units makes its gap read wider and narrower by about that much. |
| Dropout | `texture.dropout` | The share of lines the engine drops entirely. Dry ink. |
| Pressure variance | `texture.pressureVariance` | The stroke width varies inside that fraction of the family weight, clamped so the width stays positive. |
| End under-shoot | `amplitude` | Each piece end recedes by up to a quarter of the piece, never more. |

A still texture (`lineJitter` 0, family `jitter` 0, `dropout` 0,
`pressureVariance` 0) draws the ideal field: straight lines at the family
angle, one spacing apart, at the family weight.

The draws happen in one fixed order per line: angle drift, then dropout,
and for a kept line pressure, the three wave phases, and two end trims per
kept piece. The spacing step that leads to the next line closes each line.
A dropped line stops drawing after its dropout draw, and a still amplitude
draws no wave phases, so two styles with different texture values also
consume their streams differently. Determinism holds per input: the same
style, the same region, and the same seed always give the same strokes.

## Determinism

Every random value comes from the seeded RNG of `@hatch/core`. Nothing in
this package calls the global random source of JavaScript; the workspace
guard test blocks that call in every package source file. Identical seed
keys give identical stroke sets, which the test suite proves by deep
comparison (specification section 10).

## Guards

- A spacing so small that one family needs more than 20 000 lines throws a
  readable error instead of building millions of strokes. Raise the
  spacing, or split the region.
- A region that fails the `Region` schema throws a readable error.
- Duplicate region ids in `hatchRegions` throw, because two regions would
  share one random stream.

## Verify

Run the workspace gate from the repository root:

```
pnpm install
pnpm verify
```

The test suite in `test/` covers the three acceptance criteria of the task:
containment of every stroke in its region, density rising as spacing falls,
and identical seeds giving identical stroke sets.
