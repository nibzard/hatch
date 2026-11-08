# @hatch/styles

Style presets for the hatch scene compiler. A preset is one complete
`StyleSpec`: the environment family it draws, a palette, one hatch family
per style zone, contour rules, an object grammar, a composition grammar,
and a texture block. The schema lives in `@hatch/core` (specification
section 8). This package fills the schema in.

Round 1 ships `pastoral-v1`. Round 2 adds `coastal-v1`, `urban-v1`, and
`skatepark-v1` (specification sections 11 and 24). A later round adds
`interior-v1`.

Every preset holds the same six hatch families, so the zone roles the
object generators emit resolve under each one. What changes is the tuning:
one family reads as pasture under `pastoral-v1` and as paved deck under
`skatepark-v1`. Each preset section below names its reading of the
families.

The `objectGrammar` section is enforced, not declarative. Together,
`abstractionLevel` and `maxDetailPerObject` set the detail budget
`round(maxDetailPerObject x (1 - abstractionLevel))` marks per object,
`edgeRoundnessBias` rounds the corners of every object path, and
`keepNegativeSpace` keeps the cutouts as paper. The
`@hatch/objects` README states the full pass.

## Use

```ts
import { getStylePreset, listStylePresets, resolveStyle } from "@hatch/styles";

const preset = getStylePreset("pastoral-v1");

// The same style with denser sky hatching (specification section 8):
const style = resolveStyle("pastoral-v1", {
  hatchFamilies: {
    ...preset.hatchFamilies,
    sky: { ...preset.hatchFamilies.sky, spacing: 4 },
  },
});
```

## API

- `pastoralV1`: the preset as a `StyleSpec`. Frozen, and shared by every
  render that names it. Do not mutate it. Call `getStylePreset` for a copy.
- `PASTORAL_V1_PRESET_ID`: `"pastoral-v1"`. Use it as the
  `meta.stylePreset` value of a scene spec.
- `STYLE_PRESETS`: every preset by id, frozen.
- `listStylePresets()`: every registered id in alphabetical order.
- `hasStylePreset(id)`: true when `id` names a registered preset.
- `environmentTypeOfPreset(id)`: the environment family the preset draws,
  for example `rural` for `pastoral-v1`. `undefined` when the preset
  declares no family. Throws a readable error for an unknown id.
- `presetIdsForEnvironment(type)`: every registered preset that draws one
  environment family, in alphabetical order. `custom` returns the whole
  registry, because it names no family. A family no preset draws yet, for
  example `interior`, returns an empty list.
- `getStylePreset(id)`: one deep copy of the preset. Throws a readable
  error for an unknown id.
- `resolveStyle(id, overrides?)`: one `ResolvedStyleSpec`. It merges the
  overrides over the preset and validates the result. An override replaces
  one whole top-level section, because `StyleOverrides` is a partial of the
  top-level fields only. Spread the section first when you want to change
  one value.

## Conventions

- Angles are degrees. `0` is horizontal and parallel to the horizon, `90`
  is vertical, and values grow counter-clockwise.
- Distances are SVG user units on the 1024 x 768 reference canvas of a
  4:3 scene. Scale them with the canvas when the aspect ratio changes.
- Ratios are numbers between 0 and 1.
- Hatch strokes use one soft ink. Contour strokes use one darker ink. This
  follows specification section 3B: contour outlines are slightly darker
  and cleaner than the hatch fills.
- The palette holds tone colors. The hatch families hold the ink that
  draws the lines. `palette.accent` drives the accent line role, and
  `palette.trunk` drives trunk and rock strokes (specification section
  16D). No hatch family covers architecture: pastoral buildings are
  contour and accent work over plain paper.

## pastoral-v1

Quiet open countryside. One dominant sky, a clean horizon, a striped
field, distant violet-blue masses, and a few objects reduced to plain
geometry. At least 35 percent of the canvas stays empty paper.

### environmentType

The preset draws rural environments. The intent stage checks the
value against `environment.type` of the scene spec, so a scene that
names another family renders under this preset only when it says
`custom`.

| Field | Value | Meaning |
| --- | --- | --- |
| `environmentType` | `"rural"` | The preset draws rural environments. The intent stage checks the value against `environment.type`. |

### palette

| Field | Value | Meaning |
| --- | --- | --- |
| `palette.paper` | `#f6f1e7` | Warm off-white paper. It is the negative space. |
| `palette.sky` | `#a3c6d9` | Light sky blue tint behind the sky hatch. |
| `palette.grass` | `#7fa361` | Muted grass green for the field tone. |
| `palette.architecture` | `#e2d8c8` | Warm limestone for cottage walls and fences. |
| `palette.water` | `#a6c0d2` | Pale blue for still water. |
| `palette.accent` | `#b0452e` | Muted red for accents: chimney caps, door frames, roof ridges. |
| `palette.mountain` | `#8b93a4` | Violet-blue for distant masses. |
| `palette.trunk` | `#6d4c38` | Muted brown for trunks, branches, and rocks. |

### hatchFamilies

Every zone draws either `hatch` or `crosshatch`. A `hatch` family has
`angle`, `spacing`, `stroke`, `weight`, and `jitter`. A `crosshatch` family
has two of everything: `angleA` and `angleB` for the two directions,
`spacingA` and `spacingB` for the two spacings, then the shared `stroke`,
`weight`, and `jitter`. The jitter unit is one user unit of drift per
stroke point.

#### hatchFamilies.sky

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.sky.angle` | `15` | Slight tilt so the sky field never reads as a ruler edge. |
| `hatchFamilies.sky.spacing` | `7` | Open spacing. The sky stays the lightest zone. |
| `hatchFamilies.sky.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.sky.weight` | `0.55` | Light stroke weight. |
| `hatchFamilies.sky.jitter` | `0.3` | Low jitter. Sky lines stay very regular. |

#### hatchFamilies.field

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.field.angle` | `0` | Horizontal and evenly spaced. |
| `hatchFamilies.field.spacing` | `5` | Even spacing across the ground plane. |
| `hatchFamilies.field.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.field.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.field.jitter` | `0.55` | Enough drift to read as mown grass. |

#### hatchFamilies.foliage

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.foliage.angleA` | `45` | First direction of the mesh. |
| `hatchFamilies.foliage.angleB` | `135` | Second direction, at right angles to the first. |
| `hatchFamilies.foliage.spacingA` | `3.5` | Dense first spacing. |
| `hatchFamilies.foliage.spacingB` | `4.5` | Wider second spacing, so the mesh stays uneven. |
| `hatchFamilies.foliage.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.foliage.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.foliage.jitter` | `1.4` | Highest jitter in the preset. Foliage is irregular. |

#### hatchFamilies.mountain

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.mountain.angle` | `60` | Slanted hatch along the ridge direction. |
| `hatchFamilies.mountain.spacing` | `3.5` | Half the sky spacing, so distant masses read dense. |
| `hatchFamilies.mountain.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.mountain.weight` | `0.6` | Slightly heavier than the sky. |
| `hatchFamilies.mountain.jitter` | `0.45` | Low jitter. Rock edges stay crisp. |

#### hatchFamilies.water

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.water.angleA` | `10` | Shallow diagonal, near the horizon direction. |
| `hatchFamilies.water.angleB` | `100` | Second diagonal that crosses the first. |
| `hatchFamilies.water.spacingA` | `5.5` | Open first spacing. |
| `hatchFamilies.water.spacingB` | `6.5` | Wider second spacing. |
| `hatchFamilies.water.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.water.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.water.jitter` | `0.3` | Low jitter. The surface reads calm. |

#### hatchFamilies.cliff

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.cliff.angle` | `80` | Near-vertical strata. |
| `hatchFamilies.cliff.spacing` | `4` | Dense spacing for hard rock. |
| `hatchFamilies.cliff.stroke` | `#3a342e` | Soft hatch ink. |
| `hatchFamilies.cliff.weight` | `0.65` | Heaviest hatch weight in the preset. |
| `hatchFamilies.cliff.jitter` | `0.5` | Moderate jitter. |

### contours

| Field | Value | Meaning |
| --- | --- | --- |
| `contours.weight` | `1.1` | Heavier than every hatch weight, so contours lead. |
| `contours.color` | `#26221e` | Darker ink than the hatch, per section 3B. |
| `contours.wobble` | `0.35` | Hand-drawn drift along the contour, in user units. |
| `contours.simplifyTolerance` | `0.6` | Simplification tolerance before the wobble is applied. |

### objectGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `objectGrammar.abstractionLevel` | `0.6` | Plain solids: blob canopy plus trunk, cottage as three primitives. Doors and windows stay, texture detail goes. |
| `objectGrammar.maxDetailPerObject` | `10` | At most 10 detail marks per object. The planner collapses the rest. |
| `objectGrammar.edgeRoundnessBias` | `0.55` | Slight bias toward rounded silhouettes: canopies, sheep, hills. |
| `objectGrammar.keepNegativeSpace` | `true` | Clouds, windows, and doorways stay as paper. |

### compositionGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `compositionGrammar.minEmptyAreaRatio` | `0.35` | At least 35 percent of the canvas stays empty paper. |
| `compositionGrammar.preferredHorizonBand` | `[0.62, 0.72]` | The horizon sits in the lower third of the frame, in normalized height. |
| `compositionGrammar.focalObjectCount` | `1` | One dominant focal object. The rest stays subordinate. |

### texture

| Field | Value | Meaning |
| --- | --- | --- |
| `texture.lineJitter` | `0.4` | Drift per stroke point, in user units. |
| `texture.dropout` | `0.04` | Share of strokes the engine drops. Reads as dry ink. |
| `texture.pressureVariance` | `0.18` | Spread of the stroke width. Reads as ink pressure. |
| `texture.paperNoise` | `0.03` | Strength of the paper grain interaction. |

## coastal-v1

An open coast under a wide sky. A low horizon, a wind-combed dune band, a
restless sea, and one hard headland of sea cliff. Every knob turns towards
wind and water: the widest and loosest sky of the four presets, the most
restless water, and the hardest cliff strata.

Under this preset the families read as coast: `field` is dune grass,
`mountain` is the headland face, `water` is the sea, and `cliff` is the
sea cliff. At least 40 percent of the canvas stays empty paper. The
object registry now places the scene this preset was tuned for: the
`lighthouse`, `cliff`, and `rock` kinds of `@hatch/objects` carry it,
with the lighthouse band resolving through the shared `signal` role.

### environmentType

The preset draws coastal environments. The intent stage checks the
value against `environment.type` of the scene spec, so a scene that
names another family renders under this preset only when it says
`custom`.

| Field | Value | Meaning |
| --- | --- | --- |
| `environmentType` | `"coastal"` | The preset draws coastal environments. The intent stage checks the value against `environment.type`. |

### palette

| Field | Value | Meaning |
| --- | --- | --- |
| `palette.paper` | `#f4f1ea` | Cooler off-white paper. Salt air washes the sheet greyer than the pastoral sheet. It is the negative space. |
| `palette.sky` | `#b7cfdd` | Pale wind-washed blue behind the sky hatch. |
| `palette.grass` | `#8d9c78` | Grey-green dune grass, dryer than pasture. |
| `palette.architecture` | `#e7e3d8` | Weathered white paint for a coast cottage or a lighthouse wall. |
| `palette.water` | `#9dbdc9` | Sea teal-blue under the hatched surface. |
| `palette.accent` | `#c04c33` | Signal red for the marks of the coast: a lighthouse band, a door, a buoy. |
| `palette.mountain` | `#7f8a94` | Blue-grey for the headland mass. |
| `palette.trunk` | `#7a6a55` | Driftwood brown for trunks, mooring posts, and rocks. |

### hatchFamilies

#### hatchFamilies.sky

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.sky.angle` | `25` | Tilt that follows the wind. |
| `hatchFamilies.sky.spacing` | `8` | Widest spacing of the preset. The sky stays the lightest zone. |
| `hatchFamilies.sky.stroke` | `#38332d` | Soft hatch ink, one shade cooler than the pastoral ink. |
| `hatchFamilies.sky.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.sky.jitter` | `0.5` | Drift that reads as moving air. |

#### hatchFamilies.field

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.field.angle` | `18` | The wind combs the ground one way, so the dune grass tilts off the horizon. |
| `hatchFamilies.field.spacing` | `5.5` | Open spacing across the dune band. |
| `hatchFamilies.field.stroke` | `#38332d` | Soft hatch ink. |
| `hatchFamilies.field.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.field.jitter` | `1` | Drifts more than mown pasture. |

#### hatchFamilies.foliage

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.foliage.angleA` | `30` | First direction of the mesh. |
| `hatchFamilies.foliage.angleB` | `120` | Second direction, at right angles to the first. |
| `hatchFamilies.foliage.spacingA` | `4` | Dense first spacing. |
| `hatchFamilies.foliage.spacingB` | `5` | Wider second spacing, so the mesh stays uneven. |
| `hatchFamilies.foliage.stroke` | `#38332d` | Soft hatch ink. |
| `hatchFamilies.foliage.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.foliage.jitter` | `1.2` | Dense and uneven, though steadier than free-growing foliage. |

#### hatchFamilies.mountain

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.mountain.angle` | `55` | Slanted hatch along the headland face. |
| `hatchFamilies.mountain.spacing` | `4` | Dense spacing, one step looser than the cliff below. |
| `hatchFamilies.mountain.stroke` | `#38332d` | Soft hatch ink. |
| `hatchFamilies.mountain.weight` | `0.6` | Heavier than the sky. |
| `hatchFamilies.mountain.jitter` | `0.6` | Moderate drift on weathered rock. |

#### hatchFamilies.water

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.water.angleA` | `5` | Shallow diagonal, close to the horizon direction. |
| `hatchFamilies.water.angleB` | `95` | Second diagonal that crosses the first. |
| `hatchFamilies.water.spacingA` | `5` | Open first spacing. |
| `hatchFamilies.water.spacingB` | `7` | Wider second spacing, so the crossing stays loose. |
| `hatchFamilies.water.stroke` | `#38332d` | Soft hatch ink. |
| `hatchFamilies.water.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.water.jitter` | `0.8` | The most restless water of the four presets. Open sea never reads calm. |

#### hatchFamilies.cliff

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.cliff.angle` | `85` | Near-vertical strata. |
| `hatchFamilies.cliff.spacing` | `3.5` | Dense spacing for wave-cut rock. |
| `hatchFamilies.cliff.stroke` | `#38332d` | Soft hatch ink. |
| `hatchFamilies.cliff.weight` | `0.7` | Heaviest hatch weight in the preset. |
| `hatchFamilies.cliff.jitter` | `0.75` | High drift on broken rock. |

### contours

| Field | Value | Meaning |
| --- | --- | --- |
| `contours.weight` | `1.15` | Heavier than every hatch weight, so contours lead. |
| `contours.color` | `#232019` | Darker ink than the hatch, per section 3B. |
| `contours.wobble` | `0.45` | Hand-drawn drift above the pastoral value, so the line reads as drawn against wind. |
| `contours.simplifyTolerance` | `0.65` | Looser simplification, which keeps the ragged edge of a dune. |

### objectGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `objectGrammar.abstractionLevel` | `0.55` | Plain solids, one step plainer than pastoral: a lighthouse is one tower with one band. |
| `objectGrammar.maxDetailPerObject` | `8` | At most 8 detail marks per object. The wind strips a scene down. |
| `objectGrammar.edgeRoundnessBias` | `0.5` | Half-way bias: dunes, water, and cloud masses read round; a cottage stays square. |
| `objectGrammar.keepNegativeSpace` | `true` | Clouds, foam, and windows stay as paper. |

### compositionGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `compositionGrammar.minEmptyAreaRatio` | `0.4` | More empty paper than pastoral. The wide sky and the open sea carry the composition. |
| `compositionGrammar.preferredHorizonBand` | `[0.66, 0.76]` | The horizon sits low, which leaves one dominant sky region. |
| `compositionGrammar.focalObjectCount` | `1` | One focal object, for example the lighthouse on the headland. |

### texture

| Field | Value | Meaning |
| --- | --- | --- |
| `texture.lineJitter` | `0.55` | Drift per stroke point, above the pastoral value. |
| `texture.dropout` | `0.05` | Share of strokes the engine drops. |
| `texture.pressureVariance` | `0.22` | Spread of the stroke width. |
| `texture.paperNoise` | `0.035` | Strength of the paper grain interaction. |

## urban-v1

A built street. Façades that stack to the top of the frame, a road band, a
tram in the middle distance, and a sky reduced to a narrow wash. Every knob
turns towards the built: hatches lie flat and even, jitter drops, contours
firm up, and the frame fills far more than the pastoral preset allows.

Under this preset the families read as street: `field` is façade render
and pavement, `mountain` is roof plane and parapet, `water` is window
glass, and `cliff` is metalwork, from pole to rail. At least 22 percent of
the canvas stays empty paper, in panes, doorways, and the sky wash.

### environmentType

The preset draws urban environments. The intent stage checks the
value against `environment.type` of the scene spec, so a scene that
names another family renders under this preset only when it says
`custom`.

| Field | Value | Meaning |
| --- | --- | --- |
| `environmentType` | `"urban"` | The preset draws urban environments. The intent stage checks the value against `environment.type`. |

### palette

| Field | Value | Meaning |
| --- | --- | --- |
| `palette.paper` | `#f2f0ea` | Grey-white paper. The city sheet loses the warm cast of the pastoral sheet. |
| `palette.sky` | `#b6bcc4` | Pale grey-blue sky between rooflines. |
| `palette.grass` | `#7f9169` | Muted street-tree green. |
| `palette.architecture` | `#d9d2c4` | Rendered façade stone, cooler and flatter than rural limestone. |
| `palette.water` | `#a7b6c0` | Blue-grey window glass under a hatched pane. |
| `palette.accent` | `#a83d2c` | Transit red: a tram stripe, a door frame, a sign bracket. |
| `palette.mountain` | `#8a8f9b` | Blue-grey for the distant roofline. |
| `palette.trunk` | `#4f4a44` | Dark iron brown for trunks, poles, and rail stock. |

### hatchFamilies

#### hatchFamilies.sky

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.sky.angle` | `30` | Tilt that keeps the narrow wash off the ruler edge. |
| `hatchFamilies.sky.spacing` | `6` | Even spacing. The sky is a band, not a field. |
| `hatchFamilies.sky.stroke` | `#33302b` | Soft hatch ink, one shade deeper than the pastoral ink. |
| `hatchFamilies.sky.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.sky.jitter` | `0.25` | Low drift. A city sky reads flat. |

#### hatchFamilies.field

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.field.angle` | `0` | Horizontal and evenly spaced, the render course and the kerb line. |
| `hatchFamilies.field.spacing` | `4.5` | Dense spacing for built surfaces. |
| `hatchFamilies.field.stroke` | `#33302b` | Soft hatch ink. |
| `hatchFamilies.field.weight` | `0.55` | Slightly heavier than the sky. |
| `hatchFamilies.field.jitter` | `0.2` | The lowest drift of the four presets. A built surface is ruled, not grown. |

#### hatchFamilies.foliage

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.foliage.angleA` | `45` | First direction of the mesh. |
| `hatchFamilies.foliage.angleB` | `135` | Second direction, at right angles to the first. |
| `hatchFamilies.foliage.spacingA` | `3.5` | Dense first spacing. |
| `hatchFamilies.foliage.spacingB` | `4` | Even denser second spacing, so a shadow reads as one flat mass. |
| `hatchFamilies.foliage.stroke` | `#33302b` | Soft hatch ink. |
| `hatchFamilies.foliage.weight` | `0.55` | Heavier than the sky, so the shadow mass holds. |
| `hatchFamilies.foliage.jitter` | `0.8` | Steadier than free foliage. A shadow on pavement stays flat. |

#### hatchFamilies.mountain

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.mountain.angle` | `45` | Slanted hatch that follows a roof pitch. |
| `hatchFamilies.mountain.spacing` | `3.5` | Dense spacing for roof planes and parapets. |
| `hatchFamilies.mountain.stroke` | `#33302b` | Soft hatch ink. |
| `hatchFamilies.mountain.weight` | `0.6` | Heavier than the walls below. |
| `hatchFamilies.mountain.jitter` | `0.25` | Close to ruled, because a roof pitch is drawn work. |

#### hatchFamilies.water

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.water.angleA` | `25` | Shallow diagonal of the pane. |
| `hatchFamilies.water.angleB` | `115` | Second diagonal that crosses the first. |
| `hatchFamilies.water.spacingA` | `4.5` | Even first spacing. |
| `hatchFamilies.water.spacingB` | `5.5` | Wider second spacing. |
| `hatchFamilies.water.stroke` | `#33302b` | Soft hatch ink. |
| `hatchFamilies.water.weight` | `0.45` | The lightest weight of the preset, so glass reads thin. |
| `hatchFamilies.water.jitter` | `0.2` | The calmest fill of the preset, so a pane reads as a pane. |

#### hatchFamilies.cliff

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.cliff.angle` | `88` | Near-vertical strokes on a pole or a rail. |
| `hatchFamilies.cliff.spacing` | `3` | The densest spacing of the preset, so thin work still fills. |
| `hatchFamilies.cliff.stroke` | `#33302b` | Soft hatch ink. |
| `hatchFamilies.cliff.weight` | `0.7` | Heaviest hatch weight in the preset. |
| `hatchFamilies.cliff.jitter` | `0.15` | The straightest hatch of the four presets, so a pole reads as tube steel. |

### contours

| Field | Value | Meaning |
| --- | --- | --- |
| `contours.weight` | `1.2` | The firmest contour of the four presets. Architectural line work carries the drawing. |
| `contours.color` | `#211f1a` | Darker ink than the hatch, per section 3B. |
| `contours.wobble` | `0.2` | Tight wobble, so a kerb stays a kerb. |
| `contours.simplifyTolerance` | `0.45` | Tight tolerance, so a window edge survives simplification. |

### objectGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `objectGrammar.abstractionLevel` | `0.75` | Buildings stay geometric primitives with window grids. |
| `objectGrammar.maxDetailPerObject` | `14` | A window grid needs more marks than a cottage. |
| `objectGrammar.edgeRoundnessBias` | `0.25` | Square edges. A façade has no rounded silhouette to favor. |
| `objectGrammar.keepNegativeSpace` | `true` | Glass, doorways, and sky gaps stay as paper. |

### compositionGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `compositionGrammar.minEmptyAreaRatio` | `0.22` | Less empty paper than pastoral. The built frame fills. |
| `compositionGrammar.preferredHorizonBand` | `[0.55, 0.68]` | The horizon sits at the middle height, where a street camera holds it. |
| `compositionGrammar.focalObjectCount` | `2` | The street keeps few focal objects: the tram and one more. |

### texture

| Field | Value | Meaning |
| --- | --- | --- |
| `texture.lineJitter` | `0.25` | Drift per stroke point, under the pastoral value. |
| `texture.dropout` | `0.03` | Share of strokes the engine drops. |
| `texture.pressureVariance` | `0.12` | Spread of the stroke width. |
| `texture.paperNoise` | `0.02` | Strength of the paper grain interaction. |

## skatepark-v1

Poured concrete under a wide sky. A flat deck, curved transition walls,
tube steel on posts, and one rider as contour work over paper. The families
turn towards hard surfaces: the deck hatch lies flatter and wider than
pasture, the transition hatch runs dense and crisp, and the metal hatch
runs straight and heavy.

Under this preset the families read as park: `field` is the paved deck,
`mountain` is the formed transition, `cliff` is coping, rail, and post,
`foliage` is the cast shadow and the verge planting, and `figure` stays
paper, which the zone table already fills with `none`. At least 30 percent
of the canvas stays empty paper.

### environmentType

The preset draws skatepark environments. The intent stage checks the
value against `environment.type` of the scene spec, so a scene that
names another family renders under this preset only when it says
`custom`.

| Field | Value | Meaning |
| --- | --- | --- |
| `environmentType` | `"skatepark"` | The preset draws skatepark environments. The intent stage checks the value against `environment.type`. |

### palette

| Field | Value | Meaning |
| --- | --- | --- |
| `palette.paper` | `#f3f2ee` | Concrete-white paper, the coolest sheet of the four presets. |
| `palette.sky` | `#b3c9d8` | Washed blue over the park, one step greyer than the rural sky. |
| `palette.grass` | `#93a06f` | Dry verge green for the planting strip at the fence line. |
| `palette.architecture` | `#d8d6cf` | Poured concrete for decks, ramps, and bench slabs. |
| `palette.water` | `#a9c0cc` | Blue-grey for glass a scene may add: a shelter, a bottle, a lens. |
| `palette.accent` | `#bf5b2b` | Deck-tape orange: a helmet, a sticker, a board underside. |
| `palette.mountain` | `#9aa0a6` | Concrete grey for the formed faces. |
| `palette.trunk` | `#6f5a45` | Worn plywood brown for decks, seats, and any trunk left standing. |

### hatchFamilies

#### hatchFamilies.sky

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.sky.angle` | `20` | Slight tilt so the wash never reads as a ruler edge. |
| `hatchFamilies.sky.spacing` | `7.5` | Open spacing, so the frame breathes over the concrete. |
| `hatchFamilies.sky.stroke` | `#34312e` | Soft hatch ink, one shade greyer than the pastoral ink. |
| `hatchFamilies.sky.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.sky.jitter` | `0.35` | Low drift. The sky over a park reads calm. |

#### hatchFamilies.field

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.field.angle` | `0` | Horizontal and evenly spaced, the machine-laid plane of the deck. |
| `hatchFamilies.field.spacing` | `6` | One step wider than pasture, because a flat plane reads flatter than ground. |
| `hatchFamilies.field.stroke` | `#34312e` | Soft hatch ink. |
| `hatchFamilies.field.weight` | `0.55` | Slightly heavier than the sky. |
| `hatchFamilies.field.jitter` | `0.3` | Steadier than pasture. Concrete holds a line. |

#### hatchFamilies.foliage

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.foliage.angleA` | `30` | First direction of the mesh. |
| `hatchFamilies.foliage.angleB` | `120` | Second direction, at right angles to the first. |
| `hatchFamilies.foliage.spacingA` | `3.5` | Dense first spacing. The shadow is the darkest mass of the park. |
| `hatchFamilies.foliage.spacingB` | `4.5` | Wider second spacing, so the mesh stays open. |
| `hatchFamilies.foliage.stroke` | `#34312e` | Soft hatch ink. |
| `hatchFamilies.foliage.weight` | `0.6` | Heavier than the deck, so a cast shadow holds its mass. |
| `hatchFamilies.foliage.jitter` | `0.9` | Steady enough that a shadow stays a flat mass on the deck. |

#### hatchFamilies.mountain

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.mountain.angle` | `50` | Slanted hatch that follows the transition radius. |
| `hatchFamilies.mountain.spacing` | `3.5` | Dense spacing for a formed face. |
| `hatchFamilies.mountain.stroke` | `#34312e` | Soft hatch ink. |
| `hatchFamilies.mountain.weight` | `0.65` | Heavier than the deck it rises from. |
| `hatchFamilies.mountain.jitter` | `0.35` | Crisper than rock. A poured radius is drawn work. |

#### hatchFamilies.water

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.water.angleA` | `15` | Shallow diagonal of the pane. |
| `hatchFamilies.water.angleB` | `105` | Second diagonal that crosses the first. |
| `hatchFamilies.water.spacingA` | `5` | Open first spacing. |
| `hatchFamilies.water.spacingB` | `6` | Wider second spacing. |
| `hatchFamilies.water.stroke` | `#34312e` | Soft hatch ink. |
| `hatchFamilies.water.weight` | `0.5` | Light stroke weight. |
| `hatchFamilies.water.jitter` | `0.3` | Low drift. Glass reads calm under any preset. |

#### hatchFamilies.cliff

| Field | Value | Meaning |
| --- | --- | --- |
| `hatchFamilies.cliff.angle` | `90` | Exactly vertical strokes, the line of a post under a tube. |
| `hatchFamilies.cliff.spacing` | `3.2` | Dense spacing, so thin coping still fills. |
| `hatchFamilies.cliff.stroke` | `#34312e` | Soft hatch ink. |
| `hatchFamilies.cliff.weight` | `0.75` | Heaviest hatch weight in the preset. |
| `hatchFamilies.cliff.jitter` | `0.2` | Straight hatch, so a thin tube reads as steel. |

### contours

| Field | Value | Meaning |
| --- | --- | --- |
| `contours.weight` | `1.15` | Heavier than every hatch weight, so contours lead. |
| `contours.color` | `#22201e` | Darker ink than the hatch, per section 3B. |
| `contours.wobble` | `0.3` | Under the pastoral value, so a coping radius stays a clean curve. |
| `contours.simplifyTolerance` | `0.55` | Tighter than pastoral, which keeps the transition line. |

### objectGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `objectGrammar.abstractionLevel` | `0.65` | Ramps are built geometry and a rider is contour work. |
| `objectGrammar.maxDetailPerObject` | `9` | A handful of marks per object: coping lines, transition lines, spokes. |
| `objectGrammar.edgeRoundnessBias` | `0.35` | Built edges, with room for the curves of a transition. |
| `objectGrammar.keepNegativeSpace` | `true` | The rider and any cloud over the park stay as paper. |

### compositionGrammar

| Field | Value | Meaning |
| --- | --- | --- |
| `compositionGrammar.minEmptyAreaRatio` | `0.3` | The park opens a wide empty plane, so the share stays near the pastoral floor. |
| `compositionGrammar.preferredHorizonBand` | `[0.58, 0.7]` | The horizon sits below the middle, which gives the park the lower two thirds of the frame. |
| `compositionGrammar.focalObjectCount` | `1` | One focal object: the rider. |

### texture

| Field | Value | Meaning |
| --- | --- | --- |
| `texture.lineJitter` | `0.35` | Drift per stroke point, under the pastoral value. Clean line work is the point of the park. |
| `texture.dropout` | `0.05` | Share of strokes the engine drops. |
| `texture.pressureVariance` | `0.2` | Spread of the stroke width. |
| `texture.paperNoise` | `0.03` | Strength of the paper grain interaction. |

## Verify

Run the workspace gate from the repository root:

```
pnpm install
pnpm verify
```

The test suite in `test/` checks that the preset validates against the
`StyleSpec` schema, that every registered preset validates, and that this
README documents every field of every preset.
