/**
 * The coastal-v1 preset (specification sections 3, 8, 11, and 17).
 *
 * coastal-v1 draws an open coast under a wide sky: a low horizon, a
 * wind-combed dune band, a restless sea, and one hard headland of sea
 * cliff. The look keeps the pastoral contract of specification section 3 -
 * warm paper, one soft hatch ink, one darker contour ink - and turns every
 * knob towards wind and water: the lightest and loosest sky of the three
 * presets, the most restless water, and the hardest cliff strata.
 *
 * The families keep the names of specification section 8, so the roles of
 * @hatch/objects resolve without a new table. Under this preset they read
 * as coast: `field` is the dune grass, `mountain` is the headland face,
 * `water` is the sea, and `cliff` is the sea cliff.
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
export const COASTAL_V1_PRESET_ID = "coastal-v1";

/**
 * Soft ink for hatch strokes, one shade cooler than the pastoral ink. It
 * stays lighter than the contour ink, so the line fills read as tone and
 * the contours stay readable on top (specification section 3B).
 */
const HATCH_INK = "#38332d";

/** Darker, cleaner ink for contour and accent strokes. */
const CONTOUR_INK = "#232019";

/** The coastal preset of round 2 (specification sections 11 and 24). */
export const coastalV1: StyleSpec = deepFreeze({
  // The environment family the preset draws. The intent stage checks
  // it against environment.type, so the preset owns the scenes it
  // styles.
  environmentType: "coastal",
  palette: {
    // Cooler off-white paper. Salt air washes the sheet a shade greyer
    // than the pastoral sheet, and it stays the negative space.
    paper: "#f4f1ea",
    // Pale wind-washed blue. It tints the widest sky of the preset.
    sky: "#b7cfdd",
    // Grey-green dune grass, dryer and duller than pasture.
    grass: "#8d9c78",
    // Weathered white paint for a coast cottage or a lighthouse wall.
    architecture: "#e7e3d8",
    // Sea teal-blue under a hatched surface.
    water: "#9dbdc9",
    // Signal red for the accents the coast marks with: a lighthouse
    // band, a door, a buoy.
    accent: "#c04c33",
    // Blue-grey for the headland mass (specification section 3A).
    mountain: "#7f8a94",
    // Driftwood brown for trunks, mooring posts, and rocks.
    trunk: "#7a6a55",
  },
  hatchFamilies: {
    // Sky: the widest zone of the composition, so it stays the lightest
    // and the loosest (sections 3D and 17). The tilt follows the wind and
    // the jitter lets the lines drift, the way a coastal sky reads.
    sky: {
      angle: 25,
      spacing: 8,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.5,
    },
    // Dune grass: the wind combs the ground plane one way, so the field
    // hatch tilts off the horizon and drifts more than mown pasture.
    field: {
      angle: 18,
      spacing: 5.5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 1,
    },
    // Wind-clipped shrub: crosshatch, dense and uneven, though not as
    // wild as free-growing foliage (sections 3B and 17).
    foliage: {
      angleA: 30,
      angleB: 120,
      spacingA: 4,
      spacingB: 5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 1.2,
    },
    // Headland face: slanted hatch with strong density (section 3B), one
    // step softer than the sea cliff below it.
    mountain: {
      angle: 55,
      spacing: 4,
      stroke: HATCH_INK,
      weight: 0.6,
      jitter: 0.6,
    },
    // Sea: two diagonals that cross at a shallow angle (section 3B).
    // The jitter sits far above the pastoral value, because open water
    // never reads as calm.
    water: {
      angleA: 5,
      angleB: 95,
      spacingA: 5,
      spacingB: 7,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.8,
    },
    // Sea cliff: near-vertical strata, the heaviest hatch of the preset,
    // because wave-cut rock reads harder than any soil.
    cliff: {
      angle: 85,
      spacing: 3.5,
      stroke: HATCH_INK,
      weight: 0.7,
      jitter: 0.75,
    },
  },
  contours: {
    // Contours lead over every hatch field, in the darker ink of section
    // 3B. The wobble runs above the pastoral value, so the line reads as
    // drawn against wind.
    weight: 1.15,
    color: CONTOUR_INK,
    wobble: 0.45,
    simplifyTolerance: 0.65,
  },
  objectGrammar: {
    // Coast objects stay plain solids: a cottage as three primitives, a
    // lighthouse as one tower with one band. Detail below the pastoral
    // level, because the scene is about the open stretch.
    abstractionLevel: 0.55,
    // Fewer detail marks per object than the pastoral preset: the wind
    // strips a scene down.
    maxDetailPerObject: 8,
    // Rounded silhouettes, half-way: dunes, water, and cloud masses.
    edgeRoundnessBias: 0.5,
    // Clouds, foam, and windows stay as paper (section 3C).
    keepNegativeSpace: true,
  },
  compositionGrammar: {
    // More empty paper than the pastoral preset: the wide sky and the
    // open sea carry the composition (section 3D).
    minEmptyAreaRatio: 0.4,
    // The horizon sits low, which leaves one dominant sky region.
    preferredHorizonBand: [0.66, 0.76],
    // One focal object, for example the lighthouse on the headland.
    focalObjectCount: 1,
  },
  texture: {
    // Humanization knobs (sections 3E and 17). Every value sits above
    // the pastoral preset: air moves at the coast.
    lineJitter: 0.55,
    dropout: 0.05,
    pressureVariance: 0.22,
    paperNoise: 0.035,
  },
});
