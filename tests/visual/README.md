# Visual regression suite

The Playwright golden-image suite over the PNG output (task T024,
specification sections 20 and 24). Round 1 stayed free of the browser
platform by design; this suite is the round 2 addition. Playwright is the
visual regression tool the specification names in section 20.

## What one case does

Every case is one scene spec plus a pixel width. The suite:

1. Compiles the spec through the real engine (`createV1Engine`), the same
   path a caller takes.
2. Rasterizes the SVG document with `svgToPng` of `@hatch/export` at 480
   pixels of width, so the height follows the aspect ratio of the scene.
3. Compares the PNG bytes of that export against the committed baseline
   in `baselines/`, byte by byte, in Node.
4. Shows the same PNG bytes in a headless Chromium page, as a data URL,
   at one image pixel per device pixel, and compares the pixels the
   browser shows against the same baseline with `toHaveScreenshot`.

## Two comparisons, one baseline

The committed baseline of a case is the PNG the exporter itself writes,
not a screenshot of it. One file then serves two independent gates:

- **The byte gate** (step 3) tolerates no drift at all. PNG is a lossless
  encoding, so a raster that differs in one pixel always encodes to
  different bytes. The comparison lives outside `toHaveScreenshot`, on
  purpose.
- **The browser gate** (step 4) validates the raster on the browser
  platform: Chromium decodes the PNG and shows exactly the committed
  pixels.

The byte gate exists because the browser gate has a blind spot. The
comparator behind `toHaveScreenshot` is pixelmatch with its antialiasing
detection on, and Playwright exposes no switch for it. That detection
drops a lone differing pixel whenever its 3x3 neighbourhood already looks
like an antialiased edge, whatever `maxDiffPixels: 0` says. The corner
pixel (0,0) of a scene is such a position: a render change that repaints
exactly that pixel passes the browser gate and fails the byte gate. The
suite proves this on every run.

## The strictness check

One test in the suite repaints exactly one device pixel of the first
case: a `<rect>` the size of that pixel, appended on top of the scene
document, rasterized by the same pinned exporter. The test then asserts:

1. An exact in-page comparison - two decodes, every byte, no
   antialiasing detection - counts exactly one differing pixel, at the
   corner. The drift is really one pixel.
2. The byte gate fails on it. One drifted pixel fails the suite,
   wherever it lands.

## The cases

The suite reads every scene under `examples/scenes/`, so it grows with the
example set. Two derived cases add the round 2 features of the
specification section 24 V2 checklist on top of the first example:

- `<id>-urban-v1`: the same scene under a round 2 preset, so the tuned
  hatch families of `urban-v1` reach the browser platform.
- `<id>-debug-overlays`: the same scene with all seven debug flags on, so
  the round 2 overlay layers reach the browser platform.

## Run it

The suite runs headless, inside the verify gate:

```sh
pnpm verify
```

It also runs on its own:

```sh
pnpm --filter @hatch/gate run test:visual
```

The browser binary is a prerequisite of the suite, not of
`pnpm install`. Install it once per machine:

```sh
pnpm --filter @hatch/gate exec playwright install chromium
```

A run without the binary fails and names the same command.

A relative `PLAYWRIGHT_BROWSERS_PATH` is delicate: the install command
resolves it against `tests/`, while a launch under `pnpm verify` resolves
it against the repository root, so one value names two directories. The
suite configuration turns the value absolute, against the first of the
candidate directories that holds a Chromium download, before the first
launch. An absolute value passes through untouched.

## Maintain the baselines

The baselines are committed files, never written by a gate pass
(`updateSnapshots: "none"`). A byte drift fails the suite on purpose: it
says the PNG output of a scene changed. After a deliberate render change,
regenerate the baselines and commit them with the change, the same way
`node examples/render.mjs --golden` maintains the SVG fixtures under
`examples/golden/`:

```sh
pnpm --filter @hatch/gate run test:visual:update
```

The command runs `update-baselines.mjs`, which renders every case and
writes the exporter's own PNG bytes. A Playwright `--update-snapshots`
run would write a Chromium screenshot instead, which the byte gate
rejects; the regeneration therefore needs no browser. The command needs
the built packages, so run `pnpm build` first.

A new scene under `examples/scenes/` joins the suite on the next
regeneration. The pinned resvg version is one of the fixed inputs of the
PNG bytes, so a version bump regenerates the baselines too. Review the
diff of the PNG files before you commit them.

## Files

- `playwright.config.ts`: the headless Chromium project, the strict
  comparison settings, the baseline location, and the resolution of a
  relative `PLAYWRIGHT_BROWSERS_PATH`.
- `scenes.ts`: the case list and the render path each case takes.
- `visual-regression.spec.ts`: the committed-baseline checks, the byte
  and browser golden comparisons, and the drift strictness check.
- `update-baselines.mjs`: the regeneration command behind
  `test:visual:update`, and the only writer of `baselines/`.
- `baselines/`: the committed golden PNGs, one per case, the bytes the
  exporter writes.
- `test-results/`: the actual and diff images of a failing comparison.
  Git ignores it.
