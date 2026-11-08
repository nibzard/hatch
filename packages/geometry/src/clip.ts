/**
 * Boolean clipping and stroke clipping (specification sections 7, 11,
 * and 20).
 *
 * Regions compose from other regions: a sky minus cloud cutouts, a field
 * clipped to the canvas, a foliage zone united from two lobes. The
 * boolean helpers run these operations through the Paper.js engine and
 * return core paths again.
 *
 * The stroke clippers answer a different question: which parts of a stroke
 * fall on which side of a boundary? The hatching engine needs the inner
 * one, because every hatch line it draws must stop at the region boundary.
 * The style application stage needs the outer one, because the contour
 * lines of a background object must stop at the silhouette of the object
 * in front of it. Both split the stroke at the boundary crossings; they
 * disagree only about which pieces survive.
 */

import paper from "paper";

import type { Path } from "@hatch/core";

import {
  ensurePaperScope,
  fromPaperPath,
  isClosedPath,
  subpathsOf,
  toPaperPath,
} from "./paper.js";

/** Every boolean operation the Paper.js engine provides for regions. */
export const BOOLEAN_OPERATIONS = [
  "unite",
  "intersect",
  "subtract",
  "exclude",
] as const;

/** One boolean operation between two closed regions. */
export type BooleanOperation = (typeof BOOLEAN_OPERATIONS)[number];

/** Strokes shorter than this length count as empty. */
const STROKE_EPSILON = 1e-7;

/** Two crossing offsets closer than this count as one. */
const OFFSET_EPSILON = 1e-7;

/** Close every contour of a Paper.js item, so it works as a region. */
function closeAsRegion(item: paper.PathItem): void {
  if (item instanceof paper.CompoundPath) {
    // The typings name the children `Item[]`; a compound path only ever
    // holds path contours.
    const children = item.children as paper.Path[];
    for (const child of children) {
      child.closed = true;
    }
    return;
  }
  (item as paper.Path).closed = true;
}

/**
 * Run one boolean operation between two closed regions.
 *
 * Both inputs count as closed areas, whatever their winding. The result
 * keeps holes of the geometry as extra contours inside one path. Returns
 * `null` when the operation leaves nothing, for example an intersection
 * of two disjoint regions.
 */
export function booleanClip(
  subject: Path,
  clip: Path,
  operation: BooleanOperation,
): Path | null {
  if (!BOOLEAN_OPERATIONS.includes(operation)) {
    throw new Error(
      `boolean operation must be one of ${BOOLEAN_OPERATIONS.join(", ")}, ` +
        `received "${operation}"`,
    );
  }
  ensurePaperScope();
  const subjectItem = toPaperPath(subject);
  const clipItem = toPaperPath(clip);
  closeAsRegion(subjectItem);
  closeAsRegion(clipItem);
  const result = subjectItem[operation](clipItem, { insert: false });
  return fromPaperPath(result);
}

/**
 * Unite paths into one region. The result covers the area inside any
 * input path. Returns `null` for an empty input list.
 */
export function unitePaths(paths: readonly Path[]): Path | null {
  ensurePaperScope();
  if (paths.length === 0) {
    return null;
  }
  const items = paths.map((path) => {
    const item = toPaperPath(path);
    closeAsRegion(item);
    return item;
  });
  const [first, ...rest] = items;
  if (first === undefined) {
    return null;
  }
  const result =
    rest.length === 0 ? first : first.unite(rest, { insert: false });
  return fromPaperPath(result);
}

/**
 * Carve masks out of a region, as the cloud cutouts of specification
 * section 24 do. Returns `null` when the masks remove the region
 * completely.
 */
export function subtractMasks(
  subject: Path,
  masks: readonly Path[],
): Path | null {
  ensurePaperScope();
  if (masks.length === 0) {
    return fromPaperPath(toPaperPath(subject));
  }
  const subjectItem = toPaperPath(subject);
  closeAsRegion(subjectItem);
  const maskItems = masks.map((mask) => {
    const item = toPaperPath(mask);
    closeAsRegion(item);
    return item;
  });
  const result = subjectItem.subtract(maskItems, { insert: false });
  return fromPaperPath(result);
}

/**
 * Keep the parts of a stroke that fall outside every mask.
 *
 * The masks play the role the silhouettes of nearer objects play in a
 * scene: a line that runs under such an object stops at its silhouette, so
 * no line of a background object draws through the object in front of it.
 * Each contour of the stroke splits at every mask boundary it crosses, and
 * a piece survives when its midpoint lies outside every mask. A stroke the
 * masks cover completely gives an empty list, and a stroke they never
 * touch returns as the one piece it is.
 *
 * Unlike {@link clipStroke} the stroke may be closed and may hold several
 * contours, because the contour lines and internal boundaries the object
 * generators emit come compound. A closed contour that crosses a mask
 * returns open arcs.
 */
export function carveStroke(stroke: Path, masks: readonly Path[]): Path[] {
  if (masks.length === 0) {
    return [stroke];
  }
  ensurePaperScope();
  const maskItems = masks.map((mask) => {
    const item = toPaperPath(mask);
    closeAsRegion(item);
    return item;
  });

  const kept: Path[] = [];
  for (const contour of subpathsOf(stroke)) {
    const item = toPaperPath(contour) as paper.Path;
    const length = item.length;

    // Collect the boundary crossings of every mask as offsets along the
    // contour, without duplicates.
    const crossings = maskItems
      .flatMap((mask) => item.getIntersections(mask))
      .map((location) => location.offset)
      .sort((a, b) => a - b)
      .filter(
        (offset, index, all) =>
          index === 0 || offset - (all[index - 1] ?? 0) > OFFSET_EPSILON,
      );
    if (crossings.length === 0) {
      // No crossing to split at: the contour stays whole when it lies
      // outside every mask, and disappears when a mask holds it.
      const midpoint = item.getPointAt(length / 2);
      if (
        midpoint !== null &&
        !maskItems.some((mask) => mask.contains(midpoint))
      ) {
        const carved = fromPaperPath(item);
        if (carved !== null) {
          kept.push(carved);
        }
      }
      continue;
    }

    // Split at the crossings. A closed contour owns no ends, so it opens at
    // its first crossing first: the loop becomes one open path that starts
    // and ends there, and every later crossing sits at an interior offset
    // of it. Splitting a closed loop in place would instead return the
    // whole loop twice.
    let work = item;
    let offsets = crossings;
    if (item.closed) {
      const opened = item.splitAt(crossings[0]!);
      if (opened !== null) {
        work = opened as paper.Path;
      }
      offsets = crossings
        .slice(1)
        .map((offset) => offset - crossings[0]!)
        .filter(
          (offset) => offset > OFFSET_EPSILON && offset < length - OFFSET_EPSILON,
        );
    } else {
      // A crossing at the very ends of an open contour would split off
      // nothing.
      offsets = crossings.filter(
        (offset) => offset > OFFSET_EPSILON && offset < length - OFFSET_EPSILON,
      );
    }

    // Split at the largest offset first, so the earlier offsets stay valid.
    // Each split returns the tail part and leaves the head in place.
    const pieces: paper.Path[] = [];
    for (const offset of [...offsets].sort((a, b) => b - a)) {
      const tail = work.splitAt(offset);
      if (tail !== null) {
        pieces.push(tail as paper.Path);
      }
    }
    pieces.push(work);
    pieces.reverse();

    for (const piece of pieces) {
      const pieceLength = piece.length;
      if (pieceLength <= STROKE_EPSILON) {
        continue;
      }
      const midpoint = piece.getPointAt(pieceLength / 2);
      if (midpoint === null) {
        continue;
      }
      if (maskItems.some((mask) => mask.contains(midpoint))) {
        continue;
      }
      const carved = fromPaperPath(piece);
      if (carved !== null) {
        kept.push(carved);
      }
    }
  }
  return kept;
}

/**
 * Keep the parts of an open stroke that fall inside a closed region.
 *
 * The region may hold holes; strokes stop at every contour. The input
 * stroke must be one open contour. The result holds one open path per
 * kept piece, in the order they appear along the stroke. A stroke
 * entirely outside gives an empty list.
 */
export function clipStroke(stroke: Path, region: Path): Path[] {
  if (isClosedPath(stroke)) {
    throw new Error(
      "clipStroke needs an open stroke, received a closed path",
    );
  }
  const groups = subpathsOf(stroke);
  if (groups.length !== 1) {
    throw new Error(
      `clipStroke needs a stroke with one contour, received ${groups.length}`,
    );
  }
  ensurePaperScope();
  const strokeItem = toPaperPath(stroke) as paper.Path;
  const regionItem = toPaperPath(region);
  closeAsRegion(regionItem);

  // Collect the boundary crossings as offsets along the stroke, without
  // duplicates. A crossing at the very ends would split off nothing.
  const length = strokeItem.length;
  const offsets = strokeItem
    .getIntersections(regionItem)
    .map((location) => location.offset)
    .filter((offset) => offset > OFFSET_EPSILON && offset < length - OFFSET_EPSILON)
    .sort((a, b) => a - b)
    .filter((offset, index, all) => index === 0 || offset - (all[index - 1] ?? 0) > OFFSET_EPSILON);

  // Split at the largest offset first, so the earlier offsets stay valid.
  // Each split returns the tail part and leaves the head in place.
  const work = strokeItem.clone();
  const pieces: paper.Path[] = [];
  for (const offset of [...offsets].reverse()) {
    const tail = work.splitAt(offset);
    if (tail !== null) {
      pieces.push(tail as paper.Path);
    }
  }
  pieces.push(work);
  pieces.reverse();

  const kept: Path[] = [];
  for (const piece of pieces) {
    const pieceLength = piece.length;
    if (pieceLength <= STROKE_EPSILON) {
      continue;
    }
    const midpoint = piece.getPointAt(pieceLength / 2);
    if (midpoint === null || !regionItem.contains(midpoint)) {
      continue;
    }
    const clipped = fromPaperPath(piece);
    if (clipped !== null) {
      kept.push(clipped);
    }
  }
  return kept;
}
