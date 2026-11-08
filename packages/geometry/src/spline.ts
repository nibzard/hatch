/**
 * Spline interpolation (specification sections 4C, 11, and 16A).
 *
 * Object generators describe smooth shapes with a handful of anchor
 * points: a bowl lip, a tree canopy, a hill crest, a water edge. A
 * Catmull-Rom spline turns those anchors into cubic bezier segments that
 * pass through every anchor, so the caller keeps exact control over the
 * geometry while the output stays smooth.
 *
 * The conversion is closed-form, so the same anchors always give the same
 * path (specification section 10).
 */

import type { Path, Point } from "@hatch/core";

/** Options for {@link splineThroughPoints}. */
export interface SplineOptions {
  /** True closes the spline back to its first anchor. Default false. */
  closed?: boolean;
  /**
   * How strongly the curve follows the anchors. 1 is the standard
   * Catmull-Rom curve. 0 draws straight segments between the anchors.
   * Values above 1 overshoot. Default 1.
   */
  tension?: number;
}

/** Standard Catmull-Rom tension. */
const DEFAULT_TENSION = 1;

/** The tension factor between two anchors is tension / 6. */
const TENSION_TO_BEZIER = 1 / 6;

/**
 * Build one cubic bezier path that passes through every anchor point.
 *
 * The path holds one `move`, one `curve` per segment, and a `close` for a
 * closed spline. With `tension` 0 every segment is a straight `line`
 * command instead.
 */
export function splineThroughPoints(
  points: readonly Point[],
  options?: SplineOptions,
): Path {
  const closed = options?.closed ?? false;
  const tension = options?.tension ?? DEFAULT_TENSION;
  if (!Number.isFinite(tension) || tension < 0) {
    throw new Error(
      "spline tension must be a finite number of 0 or greater",
    );
  }
  const minimum = closed ? 3 : 2;
  if (points.length < minimum) {
    throw new Error(
      `a spline needs at least ${minimum} points, received ${points.length}`,
    );
  }
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(
        "spline points must be finite numbers in x and y",
      );
    }
  }

  const segmentCount = closed ? points.length : points.length - 1;
  if (tension === 0) {
    const commands: Path["commands"] = [
      { command: "move", to: asPoint(points[0]) },
    ];
    for (let index = 1; index <= segmentCount; index += 1) {
      commands.push({
        command: "line",
        to: asPoint(points[index % points.length]),
      });
    }
    if (closed) {
      commands.push({ command: "close" });
    }
    return { commands };
  }

  const commands: Path["commands"] = [
    { command: "move", to: asPoint(points[0]) },
  ];
  for (let index = 0; index < segmentCount; index += 1) {
    const from = asPoint(points[index]);
    const to = asPoint(points[(index + 1) % points.length]);
    // The neighbor anchors bend the curve. An open spline clamps the
    // missing ends, a closed spline wraps around.
    const previous = asPoint(
      points[
        closed
          ? (index - 1 + points.length) % points.length
          : Math.max(index - 1, 0)
      ],
    );
    const next = asPoint(
      points[
        closed
          ? (index + 2) % points.length
          : Math.min(index + 2, points.length - 1)
      ],
    );
    const factor = tension * TENSION_TO_BEZIER;
    commands.push({
      command: "curve",
      to,
      control1: {
        x: from.x + (to.x - previous.x) * factor,
        y: from.y + (to.y - previous.y) * factor,
      },
      control2: {
        x: to.x - (next.x - from.x) * factor,
        y: to.y - (next.y - from.y) * factor,
      },
    });
  }
  if (closed) {
    commands.push({ command: "close" });
  }
  return { commands };
}

/** Read one point from the anchor list. The length check ran before. */
function asPoint(point: Point | undefined): Point {
  if (point === undefined) {
    throw new Error("spline points must be present");
  }
  return point;
}
