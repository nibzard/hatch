# @hatch/objects

The object generators. Each generator maps the semantic parameters of
specification section 6 onto a complete `Geometry`: a silhouette, contour
lines, internal boundaries, and style zones (specification sections 6 and
24). Five kinds ship with V1 - house, tree, hill, mountain, and water - and
round 2 adds the skatepark objects bowl, quarter pipe, handrail, skater,
fence, and bench, and the urban objects tram, building block, streetlight,
car, road, and lamp post. The coastal kinds lighthouse, cliff, and rock
complete the set, because sections 1, 5, and 14 name them.

## Use

```ts
import { createRng } from "@hatch/core";
import { generateSceneObject } from "@hatch/objects";

const geometry = generateSceneObject({
  object: {
    id: "bowl-1",
    kind: "bowl",
    position: { x: 0.5, y: 0.6 },
    scale: 1.5,
    params: { width: 340, depth: 96, curvature: 0.5 },
  },
  anchor: { x: 512, y: 640 },
  rng: createRng("scene-1"),
});
```

`anchor` is the ground point of the object in scene units, and `position`
is the fractional placement of the scene. The geometry arrives placed, so
the caller feeds it straight into region building and hatching.

## API

- `objectGenerators`: the registry of every shipped generator, keyed by
  kind. `OBJECT_KINDS` lists the kinds in registry order, `isObjectKind`
  checks a string, and `objectGenerator(kind)` looks one up with a readable
  error on a miss. `V1_OBJECT_KINDS`, `SKATEPARK_OBJECT_KINDS`,
  `URBAN_OBJECT_KINDS`, `V2_OBJECT_KINDS`, and `COASTAL_OBJECT_KINDS`
  slice the same registry by release.
- `OBJECT_KIND_ALIASES`: kind names the specification states for an object
  this registry serves under another name. `rail` resolves to `handrail`
  (specification sections 5 and 11), `building` to `building-block`
  (section 11), and `cottage` to `house` (section 5).
- `ObjectGenerator`: the shared contract. Each generator states its
  `kind`, its `title`, its `zoneRoles`, its `parameterSpace`, and its
  `defaultParameters`. It parses raw params and builds geometry.
- `generateSceneObject(request)`: the facade for the scene compiler. It
  resolves the kind, parses the params, forks the stream of the object
  id, generates, enforces the object grammar of the request
  (`objectGrammar`), applies the placement, and validates the result.
- `generateHouse`, `generateTree`, `generateHill`, `generateMountain`,
  `generateWater`, `generateBowl`, `generateQuarterPipe`,
  `generateHandrail`, `generateSkater`, `generateFence`, `generateBench`,
  `generateTram`, `generateBuildingBlock`, `generateStreetlight`,
  `generateCar`, `generateRoad`, `generateLampPost`,
  `generateLighthouse`, `generateCliff`, `generateRock`: the typed
  generator functions, for direct use in tests.
- `applyObjectGrammar(geometry, grammar)`: the pass the
  `objectGrammar` style section drives (specification section 8). See
  below.
- `placement.ts`, `parameters.ts`, `shapes.ts`, `roles.ts`: the shared
  pieces. See the source files for the full list of exports.

## The generators

| Kind | Reads as | Style zones |
| --- | --- | --- |
| house | Wall block, gabled roof, chimney, door, windows | `architecture`, `roof` |
| tree | Tapered trunk, lobed canopy, clump lines | `foliage` |
| hill | Smooth mound with strip lines | `field` |
| mountain | Two faces under one ridge, optional snow cap | `mountain`, `rock`, `snow` |
| water | Shore band with wave lines | `water` |
| bowl | Poured transition under a flat deck, coping on the lips | `concrete`, `pavement` |
| quarter-pipe | Transition wall with a deck platform and coping | `concrete`, `pavement` |
| handrail | Kinked tube on posts, running down a bank | `metal` |
| skater | Riding stance on a board, grounded by one cast shadow | `figure`, `architecture`, `metal`, `shadow` |
| fence | Posts, rails, and optional pickets | `architecture` |
| bench | Seat slab on metal legs, with a leaning backrest | `architecture`, `metal` |
| tram | Rounded body, window band, doors, bogies, pantograph | `architecture`, `glass`, `metal` |
| building-block | Stepped mass, window grid, and a parapet band | `architecture`, `glass`, `roof` |
| streetlight | Pole, reaching arm, and a head with a lit lens | `metal`, `glass` |
| car | Body slab, glazed cabin, and two wheels | `architecture`, `glass`, `metal` |
| road | Two kerbs, dashed lane markings, one camber line | `pavement` |
| lamp-post | Tapered post, collar, glass lantern, and a cap | `metal`, `glass` |
| lighthouse | Tapered tower on a plinth, signal band, gallery deck, lamp room | `architecture`, `signal`, `metal`, `glass` |
| cliff | Headland slope over a wave-cut face, with strata lines | `mountain`, `rock` |
| rock | Lobed boulder with a wash line and cracks | `rock` |

Every zone role maps to one hatch family through `STYLE_ZONE_ROLES`:
`architecture` to `field`, `roof` to `mountain`, `foliage` to `foliage`,
`field` to `field`, `mountain` to `mountain`, `rock` to `cliff`, `water`
to `water`, and `snow` to `none` (negative space). Round 2 adds
`concrete` to `mountain`, `pavement` to `field`, `metal` to `cliff`,
`glass` to `water`, `shadow` to `foliage`, and `figure` to `none`. The
coastal kinds add `signal` to `mountain`, so the painted band of the
lighthouse hatches denser than the tower wall beside it.

Two roles share one hatch family when the style grammar of V1 has no
better slot for them: the skatepark and urban presets of round 2 (task
T021) tune the families per scene type, and a later round may add
families to the core grammar when two roles need separate fills.

The z index a generator writes on one zone orders the zones of its own
object alone - wall under roof, roof under glass - and stays inside the
1 to 99 band one object owns. The style stage of `@hatch/core` paints the
zones of an object in one band per object, in the depth order of the plan,
so no authored value decides which object covers another.

### Parameters

Each parameter states its kind, range, and default in a parameter space
table. The zod schema of the generator and the table must agree; a probe
test in `test/parameters.test.ts` proves it, so a seeded sweep of the
table covers the accepted range.

| Kind | Parameters |
| --- | --- |
| house | `width` 20 to 600, `wallHeight` 12 to 400, `roofPitch` 0.15 to 3, `overhang` 0 to 0.25, `chimney`, `door`, `windows` 0 to 6 |
| tree | `trunkHeight` 8 to 400, `trunkWidth` 2 to 80, `trunkBend` -1 to 1, `canopyRadius` 6 to 300, `canopyLobes` 4 to 14, `canopyIrregularity` 0 to 0.6, `clumpLines` 1 to 6, `branchLines` 0 to 5 |
| hill | `width` 40 to 2000, `height` 10 to 600, `crestAnchors` 3 to 12, `crestIrregularity` 0 to 1, `lean` -1 to 1, `strips` 1 to 4 |
| mountain | `width` 60 to 2400, `height` 40 to 1200, `peakPosition` -0.8 to 0.8, `secondaryPeaks` 0 to 2, `ruggedness` 0 to 1, `ridgeExit` -1 to 1, `snowCap` 0 to 0.8 |
| water | `width` 60 to 2400, `depth` 20 to 800, `waveLines` 1 to 12, `waveAmplitude` 0 to 40, `shoreIrregularity` 0 to 1, `calmBand` 0 to 0.9 |
| bowl | `width` 60 to 1600, `depth` 20 to 400, `curvature` 0 to 1, `deckWidth` 0 to 200, `coping`, `transitionLines` 1 to 5 |
| quarter-pipe | `width` 60 to 1200, `height` 40 to 600, `curvature` 0 to 1, `platform` 0 to 200, `coping`, `transitionLines` 1 to 5 |
| handrail | `width` 40 to 900, `height` 30 to 400, `drop` 0 to 0.8, `tubeWidth` 3 to 24, `kinkShare` 0 to 0.8, `posts` 2 to 5 |
| skater | `height` 60 to 400, `crouch` 0 to 1, `lean` -1 to 1, `board`, `boardLength` 20 to 200, `armSwing` -1 to 1 |
| fence | `width` 60 to 1600, `height` 30 to 300, `posts` 2 to 8, `rails` 0 to 3, `pickets` 0 to 24, `pointed` |
| bench | `width` 60 to 600, `seatHeight` 20 to 120, `backHeight` 0 to 150, `slats` 1 to 5, `legs` 2 to 4 |
| tram | `length` 120 to 1400, `bodyHeight` 60 to 400, `floorHeight` 20 to 120, `windows` 2 to 10, `doors` 0 to 3, `pantograph` |
| building-block | `width` 60 to 900, `height` 80 to 1600, `floors` 1 to 14, `columns` 1 to 6, `setback` 0 to 1 |
| streetlight | `height` 80 to 600, `armLength` 0 to 1, `headLength` 12 to 120, `baseWidth` 10 to 80 |
| car | `length` 80 to 700, `bodyHeight` 30 to 160, `cabin` 0 to 1, `windows` 0 to 4, `wheelRadius` 8 to 50 |
| road | `width` 120 to 2400, `depth` 30 to 500, `lanes` 1 to 4, `markings`, `wander` 0 to 1 |
| lamp-post | `height` 80 to 600, `lanternSize` 12 to 100, `panes` 1 to 4, `baseWidth` 10 to 80, `finial` |
| lighthouse | `height` 120 to 900, `baseWidth` 28 to 180, `taper` 0.2 to 0.85, `band`, `bandPosition` 0.2 to 0.85, `lanternSize` 14 to 120, `door` |
| cliff | `width` 100 to 2400, `height` 40 to 900, `topShare` 0.15 to 0.9, `faceBatter` 0 to 0.45, `ruggedness` 0 to 1, `strata` 0 to 5, `faceLeft` |
| rock | `width` 20 to 420, `height` 14 to 320, `lobes` 5 to 12, `irregularity` 0 to 0.7, `cracks` 0 to 3 |

The named exports `houseParameterSpace` and its siblings hold the
tables; `defaultHouseParameters` and its siblings hold the defaults.

## Local frames and placement

Each generator draws in its own local frame. Most objects stand on
`y = 0`, centered on `x = 0`, with the mass above that line towards
negative y. A tree with the default parameters spans about `[-37, 55]` in
x and `[-126, 0]` in y.

Two ground-band objects use the frame the water generator documents
instead: the far edge sits on `y = 0` and the surface reaches towards the
viewer to `y = depth`. The bowl keeps the same idea below the deck line,
because a bowl is a depression in the ground, and so does the road.

`placementOf(sceneObject, anchor)` turns a scene object and its anchor
into a `Placement`. `transformGeometry` applies it to a whole `Geometry`
and keeps every zone role and z index. A positive rotation reads counter
clockwise on the y-down canvas.

## The object grammar pass

Every preset states an `objectGrammar` section (specification section
8), and `applyObjectGrammar` enforces it over one generated `Geometry`,
right before the placement:

- `abstractionLevel` and `maxDetailPerObject` set a detail budget:
  `round(maxDetailPerObject x (1 - abstractionLevel))` internal
  boundaries survive, in emission order. The generators emit their
  structural lines first and their texture marks after, so a tight
  budget drops texture before structure. The `objectGrammar` module of
  `@hatch/core` computes the budget as part of the plan.
- `edgeRoundnessBias` rounds every corner of the silhouette, the
  contours, the boundaries, and the zones. The share each corner cuts
  is `bias x 0.5` of the shorter segment beside it, at most half of it.
  Zones that lie inside the silhouette are clipped back inside the
  rounded result, because a shorter zone edge cuts a smaller arc.
- `keepNegativeSpace` reaches the generators that subtract openings:
  the house keeps its door and windows as paper only while the grammar
  asks for it.

A geometry without a grammar in its request keeps the limits the
generator states itself.

## Determinism

Each object draws from its own stream, forked under
`object:<JSON id>` (specification section 10). Two objects never share a
stream, and burning numbers through one object leaves another untouched.
The built structures draw no random number at all - buildings, vehicles,
street furniture, ramps, rails, fences, benches, and the lighthouse stay
controlled (specification section 17) - so their seed cannot change them.

The organic generators fork sub streams with fixed labels, such as
`tree:canopy`, `water:waves`, `skater:pose`, `road:kerbs`, `cliff:strata`,
or `rock:cracks`, and draw
from them in one fixed order. The same params, the same id, and the same
seed always give the same geometry. Nothing in this package calls the
global random source of JavaScript; the workspace guard test blocks that
call.

## Guards

- A kind outside the registry throws a readable error that names every
  shipped kind.
- Params that fail the schema throw `invalid <kind> parameters:` plus
  the zod issues. Unknown keys drop silently, and missing fields fill
  from the defaults.
- A placement with a non-finite number or a scale of zero or less
  throws a readable error.
- Every generated geometry passes the `Geometry` schema check before it
  leaves the package.

## Verify

Run the workspace gate from the repository root:

```
pnpm install
pnpm verify
```

The test suite in `test/` covers the acceptance criteria of both rounds:
each generator returns complete geometry across a 32-sample seeded sweep
of its parameter space, and every path stays inside the local frame
envelope its parameters promise. The shared contract lives in
`test/sweep.ts`; every generator registers it through
`describeObjectContract`, then adds the tests of its own shapes.
