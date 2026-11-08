/**
 * The pastoral-v1 preset (specification sections 3, 8, and 17).
 *
 * pastoral-v1 draws quiet open countryside: one dominant sky, a clean
 * horizon, a striped field, distant violet-blue masses, and a few objects
 * reduced to plain geometry. The look comes from specification section 3:
 * warm off-white paper, blue sky hatch, green field hatch, red
 * architectural accents, and muted brown trunks and rocks.
 *
 * Every value is a rule for one compiler stage, not a decoration:
 * - the planner reads `compositionGrammar` and `objectGrammar`,
 * - the style application stage reads `hatchFamilies`, `contours`, and
 *   `palette`,
 * - the humanization stage reads `texture` (specification section 17).
 *
 * Conventions:
 * - Angles are degrees. 0 is horizontal and parallel to the horizon, 90 is
 *   vertical, and values grow counter-clockwise.
 * - Distances are SVG user units on the 1024 x 768 reference canvas of a
 *   4:3 scene.
 */

import type { StyleSpec } from "@hatch/core";

import { deepFreeze } from "./freeze.js";

/** The preset id, and the value for `meta.stylePreset`. */
export const PASTORAL_V1_PRESET_ID = "pastoral-v1";

/**
 * Soft ink for hatch strokes. Hatch stays lighter than contour so the line
 * fills read as tone and the contour lines stay readable on top of them
 * (specification section 3B: contour outlines are slightly darker).
 */
const HATCH_INK = "#3a342e";

/** Darker, cleaner ink for contour and accent strokes. */
const CONTOUR_INK = "#26221e";

/** The first style preset (specification section 8). */
export const pastoralV1: StyleSpec = deepFreeze({
  // The environment family the preset draws. The intent stage checks
  // it against environment.type, so the preset owns the scenes it
  // styles.
  environmentType: "rural",
  palette: {
    // Warm off-white paper. It is the negative space of the composition.
    paper: "#f6f1e7",
    // Light sky blue. It tints the sky wash behind the sky hatch.
    sky: "#a3c6d9",
    // Muted grass green for field tone.
    grass: "#7fa361",
    // Warm limestone for cottage walls and fences.
    architecture: "#e2d8c8",
    // Pale blue for still water.
    water: "#a6c0d2",
    // Muted red for accents: chimney caps, door frames, roof ridges.
    accent: "#b0452e",
    // Violet-blue for distant masses (specification section 3A).
    mountain: "#8b93a4",
    // Muted brown for trunks, branches, and rocks.
    trunk: "#6d4c38",
  },
  hatchFamilies: {
    // Sky: regular, open, low jitter (section 17: sky lines are very
    // regular). The slight tilt keeps the field of lines from reading as a
    // ruler edge.
    sky: {
      angle: 15,
      spacing: 7,
      stroke: HATCH_INK,
      weight: 0.55,
      jitter: 0.3,
    },
    // Field: horizontal and evenly spaced (section 3B). The jitter makes
    // the lines slightly wavy, like mown grass.
    field: {
      angle: 0,
      spacing: 5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.55,
    },
    // Foliage: crosshatch, denser and more irregular than any other zone
    // (sections 3B and 17). The two spacings differ so the mesh stays
    // open and uneven.
    foliage: {
      angleA: 45,
      angleB: 135,
      spacingA: 3.5,
      spacingB: 4.5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 1.4,
    },
    // Mountain: slanted hatch with stronger density (section 3B). The
    // spacing is half the sky spacing, which pushes the ridge lines back.
    mountain: {
      angle: 60,
      spacing: 3.5,
      stroke: HATCH_INK,
      weight: 0.6,
      jitter: 0.45,
    },
    // Water: two diagonal systems that cross at a shallow angle
    // (section 3B). Both jitter values stay low so the surface reads calm.
    water: {
      angleA: 10,
      angleB: 100,
      spacingA: 5.5,
      spacingB: 6.5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.3,
    },
    // Cliff: near-vertical strata, the heaviest hatch weight after the
    // contours, so rock reads harder than soil.
    cliff: {
      angle: 80,
      spacing: 4,
      stroke: HATCH_INK,
      weight: 0.65,
      jitter: 0.5,
    },
  },
  contours: {
    // Contours sit on top of every hatch field, so they carry the most
    // weight and the darkest ink (section 3B). The wobble and the
    // simplify tolerance keep them hand-drawn and clean at the same time.
    weight: 1.1,
    color: CONTOUR_INK,
    wobble: 0.35,
    simplifyTolerance: 0.6,
  },
  objectGrammar: {
    // Pastoral objects are plain solids: blob canopy plus trunk, cottage
    // as three primitives (section 3C). 0.6 keeps doors and windows but
    // drops texture detail.
    abstractionLevel: 0.6,
    // One object may emit at most 10 detail marks, for example windows,
    // branches, or fence posts. The planner collapses anything beyond it.
    maxDetailPerObject: 10,
    // Slight bias toward rounded silhouettes: canopies, sheep, and hills.
    edgeRoundnessBias: 0.55,
    // Clouds, windows, and doorways stay as paper (section 3C: clouds are
    // negative space cutouts).
    keepNegativeSpace: true,
  },
  compositionGrammar: {
    // At least 35 percent of the canvas stays empty paper (section 3D:
    // large regions of empty paper).
    minEmptyAreaRatio: 0.35,
    // The horizon sits in the lower third, measured in normalized height,
    // which leaves one dominant sky region.
    preferredHorizonBand: [0.62, 0.72],
    // Few focal objects (section 3D). Everything else stays subordinate.
    focalObjectCount: 1,
  },
  texture: {
    // Humanization knobs (sections 3E and 17). Every stroke may drift by
    // this many user units from its ideal path.
    lineJitter: 0.4,
    // Share of strokes the engine drops entirely, which leaves small gaps
    // that read as dry ink.
    dropout: 0.04,
    // Spread of the stroke width, which reads as ink pressure.
    pressureVariance: 0.18,
    // Strength of the paper grain interaction.
    paperNoise: 0.03,
  },
});
