# Repository gates

The workspace projects under `tests/` hold the release gates of the
repository. They consume the built packages and the example scenes, so they
test the product a caller receives rather than one module in isolation.
`pnpm test` and `pnpm typecheck` cover them like any package under
`packages/`.

- `v1-release-gate.test.ts` (task T019): the specification section 24 V1
  checklist over every scene in `examples/scenes/` - SVG output, paper
  background, region hatching, cloud cutouts, the five object types, one
  style preset, the deterministic seed, the JSON scene spec, and SVG, PNG,
  and PDF export. It proves that two runs of each example are byte-identical
  and that every render matches its golden fixture under `examples/golden/`.
  One exception carries the byte rule: the trace holds the export timing of
  specification section 9E, a wall-clock measurement, so two runs of a trace
  compare with that one number normalized (task T027).

- `visual/` (task T024): the Playwright golden-image suite over the PNG
  output, specification sections 20 and 24. Each committed baseline is
  the exporter's own PNG bytes, compared byte for byte in Node and shown
  in headless Chromium against the same file. It runs in its own gate
  step of `pnpm verify`, not under Vitest; see
  [visual/README.md](visual/README.md).

Later rounds add their gates here.
