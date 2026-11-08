/**
 * The object grammar pass (specification sections 3C, 8, and 18).
 *
 * The `objectGrammar` section of a style preset states how much detail an
 * object of that style may carry. The generators draw what their semantic
 * parameters ask for; this pass, one shared stage between generation and
 * placement, enforces the grammar over every object the same way:
 *
 * - {@link detailBudgetOf} turns `abstractionLevel` and
 *   `maxDetailPerObject` into the number of internal boundaries the object
 *   keeps. The pass keeps the first boundaries in emission order and drops
 *   the rest, because every shipped generator emits its structural
 *   boundaries first - the ridge of a mountain, the rim of a bowl, the
 *   eaves line of a house - and its detail marks after them: windows,
 *   clumps, strata, pickets, transition lines. A preset that abstracts
 *   hard keeps the structural line and drops the marks; a preset at
 *   abstraction 1 keeps no boundary at all, so the object reads from its
 *   silhouette and its contours alone.
 * - `edgeRoundnessBias` rounds every polyline corner of the object - its
 *   silhouette, its contours, its internal boundaries, and its style
 *   zones - through `roundPathCorners` of @hatch/geometry, so the whole
 *   object draws rounder, not only its outline.
 *
 * The rounding of a zone needs the one guard this pass adds: a zone and
 * the silhouette are rounded on their own paths, and a boolean-built zone
 * - the wall of a house, already cut by its door - carries shorter edges
 * at the same corner, so its arc may cut less than the arc of the
 * silhouette and its hatch would pass the outline of its own object. So
 * every zone the silhouette contained stays contained: the pass clips it
 * to the rounded silhouette. A zone that already escapes the silhouette
 * keeps its escape, because the escape is drawn on purpose: the cast
 * shadow of a skater reads as a shadow exactly because it spreads past
 * the figure. `keepNegativeSpace` does not act here either, because the
 * paper it governs is carved before and after this pass: the house
 * generator subtracts its openings from the wall zone while it builds
 * them, and the style application stage holds the cloud cutouts of the
 * scene. Both read the field where they run.
 *
 * The pass draws no random number, so the same geometry under the same
 * grammar always gives the same result (specification section 10).
 */

import {
  detailBudgetOf,
  edgeRoundnessShare,
  type Geometry,
  type ObjectGrammar,
  type Path,
  type StyleZone,
} from "@hatch/core";
import {
  booleanClip,
  pathArea,
  roundPathCorners,
  subtractMasks,
} from "@hatch/geometry";

/**
 * The area share of one zone a boolean rebuild may shift without counting
 * as an escape from its silhouette. The cast shadow of a skater, the real
 * escape, spreads over many percent of its own area; spline flattening
 * noise stays under this share.
 */
const CONTAINMENT_SLIVER_SHARE = 1e-4;

/** The area below which a path counts as empty, as in region composition. */
const AREA_EPSILON = 1e-6;

/**
 * True when `zone` sits inside `silhouette` up to boolean noise.
 *
 * The test subtracts the silhouette from the zone: a zone the silhouette
 * contained loses everything but a sliver of curve-flattening noise,
 * while a zone that escapes on purpose keeps a real share of its area.
 */
function zoneLiesInside(zone: Path, silhouette: Path): boolean {
  const outside = subtractMasks(zone, [silhouette]);
  if (outside === null) {
    return true;
  }
  const area = pathArea(zone);
  return pathArea(outside) <= Math.max(AREA_EPSILON, area * CONTAINMENT_SLIVER_SHARE);
}

/**
 * Round one style zone, keeping it inside the rounded silhouette when the
 * silhouette contained it before the grammar ran.
 */
function roundZone(
  zone: StyleZone,
  silhouette: Path,
  roundedSilhouette: Path,
  share: number,
): StyleZone {
  const rounded = roundPathCorners(zone.path, share);
  if (rounded === zone.path) {
    return zone;
  }
  const clipped = zoneLiesInside(zone.path, silhouette)
    ? booleanClip(rounded, roundedSilhouette, "intersect")
    : null;
  return { ...zone, path: clipped ?? rounded };
}

/**
 * Enforce one object grammar over one generated geometry.
 *
 * The input stays untouched: the pass returns a new geometry when the
 * grammar changes anything and the input itself when it does not, so a
 * style at abstraction 0, roundness 0, and a ceiling above every object
 * costs nothing.
 */
export function applyObjectGrammar(
  geometry: Geometry,
  grammar: ObjectGrammar,
): Geometry {
  const budget = detailBudgetOf(grammar);
  const share = edgeRoundnessShare(grammar.edgeRoundnessBias);
  const boundaries =
    geometry.internalBoundaries.length <= budget
      ? geometry.internalBoundaries
      : geometry.internalBoundaries.slice(0, budget);
  if (share === 0 && boundaries === geometry.internalBoundaries) {
    return geometry;
  }
  const silhouette = roundPathCorners(geometry.silhouette, share);
  return {
    silhouette,
    contours: geometry.contours.map((contour) =>
      roundPathCorners(contour, share),
    ),
    internalBoundaries: boundaries.map((boundary) =>
      roundPathCorners(boundary, share),
    ),
    styleZones: geometry.styleZones.map((zone) =>
      roundZone(zone, geometry.silhouette, silhouette, share),
    ),
  };
}
