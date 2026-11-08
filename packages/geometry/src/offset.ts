/**
 * Path offsets (specification sections 11 and 16A).
 *
 * An offset is the curve at a fixed distance from a path. Contour bands
 * around an object, a coping line inside a bowl lip, and a shrunk cloud
 * mask are all offsets. The helpers wrap the Paper.js offset engine,
 * which keeps bezier curves and resolves corners with a join style.
 *
 * Direction contract:
 *
 * - A closed region grows for a positive distance and shrinks for a
 *   negative one, whatever the winding of the input. Holes in a compound
 *   region move with the region: the outer contour grows, each hole
 *   shrinks.
 * - An open path moves to one side. A positive distance moves it toward
 *   the side of the travel direction rotated by -90 degrees, that is
 *   `(x, y) -> (y, -x)`. On the y-down SVG canvas that is visually the
 *   left side of the stroke.
 *
 * A shrink larger than the shape removes it, and the result is `null`.
 */

import type { Path } from "@hatch/core";

import { fromPaperPath, toPaperPath } from "./paper.js";

/** Corner styles the offset engine accepts. */
export const OFFSET_JOINS = ["miter", "bevel", "round"] as const;

/** One corner style. */
export type OffsetJoin = (typeof OFFSET_JOINS)[number];

/** Options for {@link offsetPath}. */
export interface OffsetOptions {
  /**
   * How the engine fills a corner that turns away from the offset side.
   * `miter` extends both edges to their intersection, `bevel` cuts the
   * corner with a straight edge, `round` arcs around it. Default `round`.
   */
  join?: OffsetJoin;
  /**
   * The longest miter the `miter` join draws, as a multiple of the
   * distance. A longer miter becomes a bevel. Default 4, as in SVG.
   */
  miterLimit?: number;
}

/** Default corner style. */
const DEFAULT_JOIN: OffsetJoin = "round";

/** Default miter limit, as in SVG. */
const DEFAULT_MITER_LIMIT = 4;

/**
 * Offset one path by a fixed distance.
 *
 * Returns `null` when the offset removes the path completely, which
 * happens when a negative distance shrinks a region past its size.
 */
export function offsetPath(
  path: Path,
  distance: number,
  options?: OffsetOptions,
): Path | null {
  if (!Number.isFinite(distance)) {
    throw new Error("offset distance must be a finite number");
  }
  const join = options?.join ?? DEFAULT_JOIN;
  if (!OFFSET_JOINS.includes(join)) {
    throw new Error(
      `offset join must be one of ${OFFSET_JOINS.join(", ")}, received "${join}"`,
    );
  }
  const miterLimit = options?.miterLimit ?? DEFAULT_MITER_LIMIT;
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new Error(
      "offset miterLimit must be a finite number of 1 or greater",
    );
  }

  const item = toPaperPath(path);
  const result = item.offset(distance, { join, miterLimit, insert: false });
  return fromPaperPath(result);
}
