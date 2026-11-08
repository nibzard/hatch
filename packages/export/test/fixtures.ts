/**
 * Shared fixtures for the @hatch/export tests.
 *
 * The small documents are written by hand. They carry the constructs the
 * real renderer emits - a paper rectangle, a clipped region of hatch
 * strokes, a luminance mask that carves one cutout - at a size small enough
 * that every conversion runs in milliseconds. The example scene is a real
 * render through the V1 engine, which is what an exported PNG actually
 * holds (specification section 24).
 */

/**
 * A compact hatch document: paper, four sky strokes clipped to a band, one
 * cloud cutout mask, one contour line. 400 x 300 user units, 4:3.
 */
export const HATCH_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><defs><clipPath id="clip-sky" clipPathUnits="userSpaceOnUse"><path d="M 0 0 L 400 0 L 400 120 L 0 120 Z"/></clipPath><mask id="m-cloud-1" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="300"><rect x="0" y="0" width="400" height="300" fill="#ffffff"/><path d="M 60 50 L 150 50 L 150 90 L 60 90 Z" fill="#000000"/></mask></defs><rect data-layer="paper" x="0" y="0" width="400" height="300" fill="#f6f1e7"/><g mask="url(#m-cloud-1)"><g data-region-id="sky" clip-path="url(#clip-sky)" fill="none" stroke-linecap="round"><path d="M -10 20 L 410 26" stroke="#3a342e" stroke-width="0.55"/><path d="M -10 44 L 410 50" stroke="#3a342e" stroke-width="0.55"/><path d="M -10 68 L 410 74" stroke="#3a342e" stroke-width="0.55"/><path d="M -10 92 L 410 98" stroke="#3a342e" stroke-width="0.55"/></g></g><g data-layer="contours" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M 0 120 L 400 120" stroke="#26221e" stroke-width="1.1"/></g></svg>`;

/**
 * A stroke on a transparent canvas: one diagonal ink line, no paper. It
 * leaves pixels the `background` option can paint behind, which the paper
 * of a full hatch document never does.
 */
export const INK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path d="M 0 0 L 100 100" stroke="#3a342e" stroke-width="2" fill="none"/></svg>`;

/**
 * The same hatch document with its `mask` and `clip-path` attributes
 * removed. One rasterization of each must differ: the mask carves the cloud
 * cutout and the clip shortens the sky band, so a rasterizer that ignored
 * either attribute would draw the same pixels twice.
 */
export const HATCH_SVG_WITHOUT_MASKS = HATCH_SVG.replace(
  / mask="url\(#m-cloud-1\)"/,
  "",
).replace(/ clip-path="url\(#clip-sky\)"/, "");

/**
 * A symbol document in the grammar of task T034: one `g` definition in
 * `defs` with two ink strokes, placed twice through `use` elements with
 * translate, rotate, and scale transforms. 200 x 200 user units, 1:1.
 */
export const SYMBOLS_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><g id="sym-bird" fill="none" stroke-linecap="round"><path d="M -10 0 C -5 -6 5 -6 10 0" stroke="#3a342e" stroke-width="1.2"/><path d="M 2 0 C 6 -4 12 -4 16 1" stroke="#3a342e" stroke-width="1.2"/></g></defs><rect data-layer="paper" x="0" y="0" width="200" height="200" fill="#f6f1e7"/><g data-layer="symbols"><use href="#sym-bird" transform="translate(60 50) rotate(-8) scale(1.5)"/><use href="#sym-bird" transform="translate(120 100) rotate(10) scale(0.8)"/></g></svg>`;

/** The seed of the example scene: one fixed input of the export tests. */
export const EXAMPLE_SEED = 20261107;

/**
 * The example scene of the PNG export tests, as plain JSON.
 *
 * The object is an untyped input on purpose: `renderScene` parses it against
 * the scene schema, which is the JSON-driven path of specification section
 * 24, so the fixture needs no type cast and no schema-defaulted field.
 * Every V1 object kind of specification section 24 appears once, under the
 * pastoral-v1 preset, with cloud cutouts in the sky.
 */
export function exampleSceneInput(
  overrides: {
    aspectRatio?: string;
    seed?: number;
  } = {},
): unknown {
  return {
    meta: {
      id: "export-example-0001",
      seed: overrides.seed ?? EXAMPLE_SEED,
      stylePreset: "pastoral-v1",
      aspectRatio: overrides.aspectRatio ?? "4:3",
      version: "1.0.0",
    },
    camera: { framing: "wide", lens: "normal", horizonY: 0.66 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "asymmetric",
      negativeSpace: 0.4,
      depthLayers: 3,
    },
    environment: { type: "rural", sky: { cloudCount: 2 } },
    objects: [
      {
        id: "massif-1",
        kind: "mountain",
        role: "background",
        position: { x: 0.72, y: 0.66 },
        scale: 1.6,
        params: { width: 300, height: 170, secondaryPeaks: 2, ruggedness: 0.35 },
      },
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.68 },
        scale: 2,
        params: { width: 280, height: 70, crestIrregularity: 0.3 },
      },
      {
        id: "pond-1",
        kind: "water",
        role: "midground",
        position: { x: 0.26, y: 0.8 },
        scale: 1.2,
        params: { width: 330, depth: 80, waveAmplitude: 3 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.6, y: 0.78 },
        scale: 1.4,
        params: { width: 150, wallHeight: 80, roofPitch: 0.8, windows: 3 },
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "foreground",
        position: { x: 0.82, y: 0.86 },
        scale: 2,
        params: { trunkHeight: 90, canopyRadius: 60, canopyLobes: 8 },
      },
    ],
  };
}
