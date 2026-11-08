/**
 * The stroke records the hatching engine emits (specification sections 7
 * and 11).
 *
 * The engine turns one region into a set of strokes. One stroke is one
 * generated line of the region fill: its geometry, its ink, and the
 * placement facts a trace or a debug overlay wants (specification section
 * 9D). The SVG renderer draws one stroke set as one group of paths.
 *
 * All records are plain data. They hold no methods, so a trace, a test, or
 * the renderer can walk them without the engine.
 */

import type { Path } from "@hatch/core";

/** The line system a stroke belongs to. A crosshatch fills two of them. */
export type HatchFamily = "a" | "b";

/** The fill kinds the engine generates strokes for. */
export type HatchKind = "hatch" | "crosshatch" | "none";

/** One generated hatch stroke, ready for the renderer. */
export interface HatchStroke {
  /**
   * The stroke geometry. It is open and it stays inside its region. A line
   * that crosses a hole of the region keeps one contour per kept piece.
   */
  path: Path;
  /** Stroke width in user units, after pressure variance. */
  weight: number;
  /** Stroke color, from the fill style. */
  color: string;
  /** The line system the stroke belongs to. */
  family: HatchFamily;
  /**
   * The angle of this stroke in degrees, after angle drift. Angles follow
   * the style convention: 0 is horizontal and values grow counter-clockwise.
   */
  angle: number;
  /**
   * The local spacing step that placed this stroke, after spacing variance.
   * The first line of a family reports the nominal spacing, because the
   * random phase placed it.
   */
  spacing: number;
}

/** The strokes generated for one region. */
export interface HatchSet {
  /** The id of the region this set fills. */
  regionId: string;
  /** The role of the region, when the region carries one. */
  role?: string;
  /** The fill kind that produced this set. */
  kind: HatchKind;
  /** The draw order of the source region. Sets with a lower zIndex draw first. */
  zIndex: number;
  /**
   * The strokes, family A first and family B second, each in placement
   * order from one side of the region to the other.
   */
  strokes: HatchStroke[];
  /** The lines the engine dropped through `texture.dropout`. */
  droppedStrokeCount: number;
  /** Total length of the kept strokes, in user units. */
  strokeLength: number;
  /**
   * The fill area the strokes were generated inside, in square user units.
   */
  fillArea: number;
  /**
   * Total stroke length divided by the region area. A higher value is a
   * denser fill. This feeds the visual density score of the render trace
   * (specification section 9E).
   */
  density: number;
}
