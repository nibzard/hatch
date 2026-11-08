# Example scenes

The seeded example scenes of the V1 release (task T019, specification
section 24). Each scene is one JSON scene spec that uses the full V1
vocabulary: the five object types, cloud cutouts, the paper background, and
the `pastoral-v1` preset.

| Scene | Ratio | Seed | Reads as |
| --- | --- | --- | --- |
| `pastoral-creek-0001` | 4:3 | 20261107 | A cottage behind a creek, a massif and a hill on the horizon, a tree on the near bank |
| `mountain-lake-0002` | 16:9 | 424242 | A peak and a ridge over a wide lake, a boathouse on the near shore, a pine at the right |

## Layout

- `scenes/`: one JSON scene spec per example. This is the engine input, read
  from disk exactly as a caller would read it.
- `golden/`: the committed golden SVG fixtures, one per scene. The release
  gate renders each scene and compares the bytes against its fixture.
- `render.mjs`: the render script described below.
- `output/`: the render scratch the script writes. Git ignores it.

## Render

Build the packages first, then run the script:

```sh
pnpm build
node examples/render.mjs
```

The script compiles every scene under `scenes/` and writes four files per
scene into `output/`: `<id>.svg` (the canonical document), `<id>.png` (one
raster preview of the same bytes at 480 pixels wide), `<id>.pdf` (the
vector print document of the same strokes at 480 points wide), and
`<id>.trace.json` (the compilation trace, with the full output metric set
of specification section 9E: region count, stroke count, SVG size, export
timing, and the visual density score).

Two runs of the script write identical artwork bytes. The same spec, seed,
preset, and compiler version always give the same output (specification
section 10). The trace carries one measured value, the export duration, so
two trace files differ in that number alone.

## Golden fixtures

After a deliberate compiler change, rewrite the fixtures and commit them
with the change:

```sh
node examples/render.mjs --golden
```

The PNG output stays uncommitted on purpose. The pinned resvg version is one
of the fixed inputs of a raster (task T018), so PNG bytes are proven between
two runs of the same tree, never against a file. The PDF output is scratch
of the same kind: `svgToPdf` (task T030) is deterministic, but the examples
prove its bytes run against run, not against a committed file.

## The release gate

`tests/v1-release-gate.test.ts` runs the specification section 24 V1
checklist over every scene in `scenes/`: SVG output, paper background,
region hatching, cloud cutouts, the five object types, one style preset, the
deterministic seed, the JSON scene spec, and SVG, PNG, and PDF export. The
suite runs inside `pnpm verify`, so the checklist is part of the one-command
gate.
