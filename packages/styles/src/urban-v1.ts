/**
 * The urban-v1 preset (specification sections 3, 8, 11, and 17).
 *
 * urban-v1 draws a built street: façades that stack to the top of the
 * frame, a road band, a tram in the middle distance, and a sky reduced to
 * a narrow wash. The look keeps the contract of specification section 3 -
 * paper for the negative space, one soft hatch ink under one darker
 * contour ink - and turns every knob towards the built: hatches lie flat
 * and even, jitter drops, contours firm up, and the composition lets the
 * frame fill far more than the pastoral preset allows.
 *
 * The families keep the names of specification section 8, so the urban
 * roles of @hatch/objects resolve without a new table. Under this preset
 * they read as street: `field` is façade render and pavement, `mountain`
 * is roof plane and parapet, `water` is window glass, and `cliff` is
 * metalwork - pole, rail, and pole bracket.
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
export const URBAN_V1_PRESET_ID = "urban-v1";

/**
 * Soft ink for hatch strokes, one shade deeper than the pastoral ink. It
 * stays lighter than the contour ink, so the tone fields stay tone and the
 * contours stay readable on top (specification section 3B).
 */
const HATCH_INK = "#33302b";

/** Darker, cleaner ink for contour and accent strokes. */
const CONTOUR_INK = "#211f1a";

/** The urban preset of round 2 (specification sections 11 and 24). */
export const urbanV1: StyleSpec = deepFreeze({
  // The environment family the preset draws. The intent stage checks
  // it against environment.type, so the preset owns the scenes it
  // styles.
  environmentType: "urban",
  palette: {
    // Grey-white paper. The city sheet loses the warm cast of the
    // pastoral sheet, and it stays the negative space of the frame.
    paper: "#f2f0ea",
    // Pale grey-blue sky between rooflines.
    sky: "#b6bcc4",
    // Muted street-tree green for whatever planting the street holds.
    grass: "#7f9169",
    // Rendered façade stone, cooler and flatter than rural limestone.
    architecture: "#d9d2c4",
    // Blue-grey window glass under a hatched pane.
    water: "#a7b6c0",
    // Transit red for the accents the street marks with: a tram stripe,
    // a door frame, a sign bracket.
    accent: "#a83d2c",
    // Blue-grey for the distant roofline, the urban reading of the
    // distant mass (specification section 3A).
    mountain: "#8a8f9b",
    // Dark iron brown for trunks, poles, and rail stock.
    trunk: "#4f4a44",
  },
  hatchFamilies: {
    // Sky: a narrow wash above the roofline, so it stays even and quiet
    // (section 17). The tilt keeps it from reading as a ruler edge.
    sky: {
      angle: 30,
      spacing: 6,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.25,
    },
    // Façade render and pavement: horizontal and evenly spaced (section
    // 3B), with the lowest drift of the three presets, because a built
    // surface is ruled rather than grown.
    field: {
      angle: 0,
      spacing: 4.5,
      stroke: HATCH_INK,
      weight: 0.55,
      jitter: 0.2,
    },
    // Street tree and cast shadow: crosshatch, dense, but steadier than
    // free foliage, so a shadow on pavement reads as a flat mass.
    foliage: {
      angleA: 45,
      angleB: 135,
      spacingA: 3.5,
      spacingB: 4,
      stroke: HATCH_INK,
      weight: 0.55,
      jitter: 0.8,
    },
    // Roof planes and parapets: slanted hatch with strong density
    // (section 3B), close to ruled, because a roof pitch is drawn work.
    mountain: {
      angle: 45,
      spacing: 3.5,
      stroke: HATCH_INK,
      weight: 0.6,
      jitter: 0.25,
    },
    // Window glass: two diagonals that cross at a shallow angle (section
    // 3B), the calmest fill of the preset, so a pane reads as a pane.
    water: {
      angleA: 25,
      angleB: 115,
      spacingA: 4.5,
      spacingB: 5.5,
      stroke: HATCH_INK,
      weight: 0.45,
      jitter: 0.2,
    },
    // Metalwork: near-vertical, the heaviest and straightest hatch of
    // the preset, so a thin pole reads as tube steel.
    cliff: {
      angle: 88,
      spacing: 3,
      stroke: HATCH_INK,
      weight: 0.7,
      jitter: 0.15,
    },
  },
  contours: {
    // The firmest contour of the three presets: architectural line work
    // carries the drawing, in the darker ink of section 3B, with a tight
    // wobble and a tight tolerance so a kerb stays a kerb.
    weight: 1.2,
    color: CONTOUR_INK,
    wobble: 0.2,
    simplifyTolerance: 0.45,
  },
  objectGrammar: {
    // Buildings stay geometric primitives with window grids (section
    // 3C), so the abstraction runs above the pastoral level.
    abstractionLevel: 0.75,
    // A window grid needs more detail marks than a cottage, so the cap
    // rises with it.
    maxDetailPerObject: 14,
    // Square edges: the bias runs low, because a façade has no rounded
    // silhouette to favor.
    edgeRoundnessBias: 0.25,
    // Glass, doorways, and sky gaps stay as paper (section 3C).
    keepNegativeSpace: true,
  },
  compositionGrammar: {
    // Less empty paper than the pastoral preset: the built frame fills,
    // and the paper survives in panes, doorways, and the sky wash
    // (section 3D).
    minEmptyAreaRatio: 0.22,
    // The horizon sits at the middle height, where a street camera
    // holds it, with room for the storeys above.
    preferredHorizonBand: [0.55, 0.68],
    // The street still keeps few focal objects: the tram and one more.
    focalObjectCount: 2,
  },
  texture: {
    // Humanization knobs (sections 3E and 17). Every value sits below
    // the pastoral preset: the hand stays disciplined on ruled work.
    lineJitter: 0.25,
    dropout: 0.03,
    pressureVariance: 0.12,
    paperNoise: 0.02,
  },
});
