/**
 * The skatepark-v1 preset (specification sections 3, 8, 11, and 17).
 *
 * skatepark-v1 draws poured concrete under a wide sky: a flat deck, curved
 * transition walls, tube steel on posts, and one rider as contour work
 * over paper. The look keeps the contract of specification section 3 -
 * paper for the negative space, one soft hatch ink under one darker
 * contour ink - and turns the families towards hard surfaces: the deck
 * hatch lies flatter and wider than pasture, the transition hatch runs
 * dense and crisp, and the metal hatch runs straight and heavy.
 *
 * The families keep the names of specification section 8, so the
 * skatepark roles of @hatch/objects resolve without a new table. Under
 * this preset they read as park: `field` is the paved deck, `mountain` is
 * the formed transition, `cliff` is coping, rail, and post, `foliage` is
 * the cast shadow and the verge planting, and `figure` stays paper, which
 * the zone table already fills with `none`.
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
export const SKATEPARK_V1_PRESET_ID = "skatepark-v1";

/**
 * Soft ink for hatch strokes, one shade greyer than the pastoral ink. It
 * stays lighter than the contour ink, so the tone fields stay tone and the
 * contours stay readable on top (specification section 3B).
 */
const HATCH_INK = "#34312e";

/** Darker, cleaner ink for contour and accent strokes. */
const CONTOUR_INK = "#22201e";

/** The skatepark preset of round 2 (specification sections 11 and 24). */
export const skateparkV1: StyleSpec = deepFreeze({
  // The environment family the preset draws. The intent stage checks
  // it against environment.type, so the preset owns the scenes it
  // styles.
  environmentType: "skatepark",
  palette: {
    // Concrete-white paper, the coolest sheet of the four presets, and
    // still the negative space of the composition.
    paper: "#f3f2ee",
    // Washed blue over the park, one step greyer than the rural sky.
    sky: "#b3c9d8",
    // Dry verge green for the planting strip at the fence line.
    grass: "#93a06f",
    // Poured concrete for decks, ramps, and bench slabs.
    architecture: "#d8d6cf",
    // Deck-tape orange for the accents the park marks with: a helmet, a
    // sticker, a board underside.
    accent: "#bf5b2b",
    // Blue-grey for the glass the park holds none of and a scene may
    // still add: a bus shelter, a bottle, a lens.
    water: "#a9c0cc",
    // Concrete grey for the formed faces, the urban reading of the
    // distant mass (specification section 3A).
    mountain: "#9aa0a6",
    // Worn plywood brown for decks, seats, and any trunk left standing.
    trunk: "#6f5a45",
  },
  hatchFamilies: {
    // Sky: calm and open above the park (sections 3D and 17), lighter
    // and wider than the pastoral sky, so the frame breathes over the
    // concrete.
    sky: {
      angle: 20,
      spacing: 7.5,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.35,
    },
    // Paved deck: horizontal and evenly spaced (section 3B), one step
    // wider and steadier than pasture, because a machine-laid plane
    // reads flatter than ground.
    field: {
      angle: 0,
      spacing: 6,
      stroke: HATCH_INK,
      weight: 0.55,
      jitter: 0.3,
    },
    // Cast shadow and verge planting: crosshatch, the densest fill of
    // the park (sections 3B and 17), steady enough that a shadow stays a
    // flat mass on the deck.
    foliage: {
      angleA: 30,
      angleB: 120,
      spacingA: 3.5,
      spacingB: 4.5,
      stroke: HATCH_INK,
      weight: 0.6,
      jitter: 0.9,
    },
    // Formed transition: slanted hatch with strong density (section 3B),
    // crisper than rock, because a poured radius is drawn work.
    mountain: {
      angle: 50,
      spacing: 3.5,
      stroke: HATCH_INK,
      weight: 0.65,
      jitter: 0.35,
    },
    // Glass: two diagonals that cross at a shallow angle (section 3B),
    // calm and even, the same reading a window pane carries.
    water: {
      angleA: 15,
      angleB: 105,
      spacingA: 5,
      spacingB: 6,
      stroke: HATCH_INK,
      weight: 0.5,
      jitter: 0.3,
    },
    // Coping, rail, and post: near-vertical, the heaviest and straightest
    // hatch of the preset, so a thin tube reads as steel.
    cliff: {
      angle: 90,
      spacing: 3.2,
      stroke: HATCH_INK,
      weight: 0.75,
      jitter: 0.2,
    },
  },
  contours: {
    // Contours lead over every hatch field in the darker ink of section
    // 3B. The wobble and the tolerance sit under the pastoral values, so
    // a coping radius stays a clean curve.
    weight: 1.15,
    color: CONTOUR_INK,
    wobble: 0.3,
    simplifyTolerance: 0.55,
  },
  objectGrammar: {
    // Ramps are built geometry and a rider is contour work, so the
    // abstraction runs above the pastoral level while the figure keeps
    // its silhouette.
    abstractionLevel: 0.65,
    // One object may carry a handful of marks: coping lines, transition
    // lines, spokes.
    maxDetailPerObject: 9,
    // Built edges, with room for the curves of a transition: the bias
    // runs below the middle.
    edgeRoundnessBias: 0.35,
    // The rider and any cloud over the park stay as paper (section 3C).
    keepNegativeSpace: true,
  },
  compositionGrammar: {
    // The park opens a wide empty plane, so the empty-paper share stays
    // near the pastoral floor (section 3D).
    minEmptyAreaRatio: 0.3,
    // The horizon sits below the middle, which gives the park the lower
    // two thirds of the frame.
    preferredHorizonBand: [0.58, 0.7],
    // One focal object: the rider.
    focalObjectCount: 1,
  },
  texture: {
    // Humanization knobs (sections 3E and 17). The drift sits under the
    // pastoral value, because clean line work is the point of the park.
    lineJitter: 0.35,
    dropout: 0.05,
    pressureVariance: 0.2,
    paperNoise: 0.03,
  },
});
