/**
 * Region composition (specification sections 7, 11, and 24).
 *
 * A scene stacks regions: a sky region with cloud cutouts, a field
 * clipped to the canvas, a foliage zone over a hill. Composition applies
 * that geometry: clip each region to its extent, carve the masks out of
 * it, and emit drawable regions with their fill style and draw order.
 *
 * A carved region keeps its holes as extra contours inside one path, in
 * the winding the boolean engine produces. The hatching engine and the
 * point-in-region test both respect those holes.
 */

import type { FillStyle, Path, Region } from "@hatch/core";
import { formatIssues, RegionSchema } from "@hatch/core";

import { booleanClip, subtractMasks } from "./clip.js";
import { pathArea } from "./measure.js";

/** Regions below this area count as empty. */
const AREA_EPSILON = 1e-6;

/** One region to compose, with its extent and its cutouts. */
export interface RegionComposition {
  /** Region id. A result with several contours gains a `#n` suffix. */
  id: string;
  /** Region role from specification section 16C, for example "sky". */
  role?: string;
  /** The region area before clipping and masks. */
  path: Path;
  /** The fill style the composed regions carry. */
  fillStyle: FillStyle;
  /** The extent of the region. Everything outside it is dropped. */
  clip?: Path;
  /** Cutouts carved out of the region, for example cloud shapes. */
  masks?: readonly Path[];
  /** Draw order. Regions with a lower zIndex draw first. */
  zIndex: number;
}

/**
 * Compose one region: apply the clip extent, carve the masks, and drop
 * empty geometry.
 *
 * The result holds at most one region. Its path may be compound: disjoint
 * pieces of the clipped area and the carved holes stay together in one
 * path, in the winding the boolean engine produces. Hatching and the
 * point-in-region test both respect those contours. The result parses
 * against the Region schema of @hatch/core, so it can enter a RenderIR
 * unchanged.
 */
export function composeRegion(input: RegionComposition): Region[] {
  let piece: Path | null = input.path;
  if (input.clip !== undefined) {
    piece = booleanClip(piece, input.clip, "intersect");
  }
  if (piece !== null && input.masks !== undefined && input.masks.length > 0) {
    piece = subtractMasks(piece, input.masks);
  }
  if (piece === null || pathArea(piece) <= AREA_EPSILON) {
    return [];
  }

  // The clip and the masks are applied geometry now, so the composed
  // region carries no clip of its own.
  const region: Region = {
    id: input.id,
    ...(input.role === undefined ? {} : { role: input.role }),
    path: piece,
    fillStyle: input.fillStyle,
    zIndex: input.zIndex,
  };
  const parsed = RegionSchema.safeParse(region);
  if (!parsed.success) {
    throw new Error(
      `composed region is invalid: ${formatIssues(parsed.error.issues)}`,
    );
  }
  return [region];
}

/**
 * Compose many regions and return them in draw order: ascending zIndex,
 * with the input order kept between equals.
 *
 * This is the region stack a scene planner hands to the renderer.
 */
export function composeRegions(
  inputs: readonly RegionComposition[],
): Region[] {
  return inputs
    .flatMap((input) => composeRegion(input))
    .sort((left, right) => left.zIndex - right.zIndex);
}
