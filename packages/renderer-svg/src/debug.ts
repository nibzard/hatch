/**
 * Debug overlays (specification sections 5, 9, and 11).
 *
 * One flag of the scene spec's `debug` block switches one overlay layer on.
 * The seven overlays are the debug outputs of specification section 9: a
 * region map, a depth layer overlay, a hatch direction map, object anchors, a
 * negative-space map, a contour-only preview, and the construction lines of
 * specification section 5.
 *
 * Every layer is a pure addition. It draws after the artwork, outside the
 * mask wrappers, and it changes no byte of what came before it, so a render
 * with the overlays on carries the identical hatch strokes as the plain
 * render it explains. That is the property that makes an overlay useful: a
 * reader compares the map against the drawing it describes, not against a
 * second drawing. The one exception in spirit is `showContourOnly`, which
 * hides the artwork under a paper wash inside its own layer rather than
 * dropping it from the document - the same rule the cloud cutouts follow,
 * where the mask covers ink at composite time and removes no geometry.
 *
 * Nothing here draws a random number. Colors come from fixed tables indexed
 * by region order, so the same intermediate representation always serializes
 * to the same overlay bytes (specification section 10).
 */

import {
  enabledDebugFlags,
  type DebugFlagName,
  type ObjectAnchor,
  type Path,
  type Point,
  regionsInDrawOrder,
  type RenderIR,
  type Region,
} from "@hatch/core";
import { pathBounds } from "@hatch/geometry";
import { angleDirection } from "@hatch/hatching";

import { pathData } from "./path-data.js";
import { element, type XmlAttribute, type XmlElement } from "./xml.js";

/**
 * The `data-layer` name each debug flag draws, keyed by flag.
 *
 * The names are part of the document contract: an agent or an editor finds
 * one overlay by this attribute, never by counting groups.
 */
export const DEBUG_LAYER_NAMES: Readonly<Record<DebugFlagName, string>> = {
  showContourOnly: "debug-contour-only",
  showRegions: "debug-regions",
  showDepthMap: "debug-depth",
  showHatchDirections: "debug-hatch-directions",
  showNegativeSpace: "debug-negative-space",
  showAnchors: "debug-anchors",
  showConstructionLines: "debug-construction",
};

/** The layer name one flag draws. */
export function debugLayerName(flag: DebugFlagName): string {
  return DEBUG_LAYER_NAMES[flag];
}

/** The shared attributes of every debug layer group. */
function layerAttributes(name: string): XmlAttribute[] {
  return [
    { name: "data-layer", value: name },
    { name: "fill", value: "none" },
    { name: "stroke-linecap", value: "round" },
    { name: "stroke-linejoin", value: "round" },
  ];
}

/**
 * Ink of the region map. One hue per region, cycling, so neighboring regions
 * stay distinguishable whatever the palette of the scene underneath.
 */
const REGION_INKS = [
  "#b0452e",
  "#1f6f8b",
  "#2e7d32",
  "#6a4c93",
  "#b07d00",
  "#0f8b8d",
] as const;

/** Ink of the depth overlay: one shade, darkening by depth rank. */
const DEPTH_INK = "#1f2933";

/** Ink of the hatch direction arrows. */
const HATCH_DIRECTION_INK = "#2e7d32";

/** Ink of the negative-space map. */
const NEGATIVE_SPACE_INK = "#6a4c93";

/** Ink of the object anchor markers. */
const ANCHOR_INK = "#b07d00";

/** Ink of the construction guides. */
const CONSTRUCTION_INK = "#8a8a8a";

/** Opacity a region map tint draws at. */
const REGION_TINT_OPACITY = 0.12;

/** Stroke weight of every debug outline. */
const OUTLINE_WEIGHT = 1;

/** How far a depth tint darkens per depth rank. */
const DEPTH_TINT_STEP = 0.07;

/** The deepest a depth tint draws, so the front layer stays see-through. */
const DEPTH_TINT_MAX = 0.42;

/** Radius of an anchor marker at object scale 1, in scene units. */
const ANCHOR_RADIUS_UNITS = 9;

/** Shortest and longest anchor radius, so markers stay visible when zoomed. */
const ANCHOR_RADIUS_RANGE: readonly [number, number] = [5, 36];

/** Shortest and longest hatch direction arrow, in scene units. */
const ARROW_LENGTH_RANGE: readonly [number, number] = [14, 90];

/** Share of a region's smaller bounds edge an arrow covers. */
const ARROW_LENGTH_SHARE = 0.4;

/** Clamp one value into an inclusive range. */
function clamp(value: number, [low, high]: readonly [number, number]): number {
  return Math.min(Math.max(value, low), high);
}

/** The open polyline through the given points, as path commands. */
function lineCommands(points: readonly Point[]): Path["commands"] {
  const [first, ...rest] = points;
  if (first === undefined) {
    throw new Error("lineCommands needs at least one point");
  }
  return [
    { command: "move", to: first },
    ...rest.map((to) => ({ command: "line" as const, to })),
  ];
}

/** One closed polygon around a circle. */
function circleCommands(center: Point, radius: number, segments = 32): Path["commands"] {
  const commands: Path["commands"] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const to: Point = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
    commands.push(
      index === 0
        ? { command: "move", to }
        : { command: "line" as const, to },
    );
  }
  commands.push({ command: "close" });
  return commands;
}

/**
 * One arrow from `center` along `angleDegrees`, as one compound path.
 *
 * The angle follows the style convention of the hatch strokes: 0 is
 * horizontal, values grow counter-clockwise, and the direction vector lands
 * in SVG user space through the same {@link angleDirection} call the hatching
 * engine places its lines with. The two head lines sit at the tip.
 */
function arrowPath(center: Point, angleDegrees: number, length: number): Path {
  const direction = angleDirection(angleDegrees);
  const half = length / 2;
  const tip: Point = {
    x: center.x + direction.x * half,
    y: center.y + direction.y * half,
  };
  const tail: Point = {
    x: center.x - direction.x * half,
    y: center.y - direction.y * half,
  };
  const headLength = Math.max(4, length * 0.22);
  // The head legs point back from the tip at 30 degrees off the shaft.
  const leg = (sign: number): Point => ({
    x: tip.x - (direction.x * Math.cos(sign * Math.PI / 6) - direction.y * Math.sin(sign * Math.PI / 6)) * headLength,
    y: tip.y - (direction.y * Math.cos(sign * Math.PI / 6) + direction.x * Math.sin(sign * Math.PI / 6)) * headLength,
  });
  return {
    commands: [
      ...lineCommands([tail, tip]),
      ...lineCommands([leg(1), tip]),
      ...lineCommands([leg(-1), tip]),
    ],
  };
}

/** One anchor marker: a circle sized by object scale, crossed by two axes. */
function anchorMarkerPath(anchor: ObjectAnchor): Path {
  const radius = clamp(
    ANCHOR_RADIUS_UNITS * anchor.scale,
    ANCHOR_RADIUS_RANGE,
  );
  const arm = radius * 1.6;
  const { x, y } = anchor.position;
  return {
    commands: [
      ...circleCommands(anchor.position, radius),
      ...lineCommands([
        { x: x - arm, y },
        { x: x + arm, y },
      ]),
      ...lineCommands([
        { x, y: y - arm },
        { x, y: y + arm },
      ]),
    ],
  };
}

/** The attributes that name one region on an overlay element. */
function regionAttributes(region: Region, index: number): XmlAttribute[] {
  return [
    { name: "data-region-id", value: region.id },
    ...(region.role === undefined
      ? []
      : [{ name: "data-role", value: region.role }]),
    { name: "data-zindex", value: region.zIndex },
    { name: "data-order", value: index },
  ];
}

/** One outlined and tinted region path, the shape of a region map entry. */
function regionMapEntry(region: Region, index: number): XmlElement {
  const ink = REGION_INKS[index % REGION_INKS.length]!;
  return element("path", [
    ...regionAttributes(region, index),
    { name: "d", value: pathData(region.path) },
    { name: "fill", value: ink },
    { name: "fill-opacity", value: REGION_TINT_OPACITY },
    { name: "stroke", value: ink },
    { name: "stroke-width", value: OUTLINE_WEIGHT },
    { name: "stroke-dasharray", value: "7 5" },
  ]);
}

/**
 * The region map: every region tinted and outlined, in draw order.
 *
 * Each entry carries the region's identity as data attributes, so an agent
 * reads which region a shape belongs to without a legend.
 */
function regionMapLayer(ir: RenderIR): XmlElement {
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showRegions),
    ...regionsInDrawOrder(ir.regions).map(regionMapEntry),
  );
}

/**
 * The depth layer overlay: one shade over every region, darker the further
 * forward the region draws.
 *
 * Regions that share a zIndex share a rank and therefore a tint, because they
 * are one depth layer. The rank, not the raw zIndex, drives the shade: a
 * scene whose zones all draw at zIndex 10 still shows its two scene layers as
 * two steps.
 */
function depthLayer(ir: RenderIR): XmlElement {
  const regions = regionsInDrawOrder(ir.regions);
  const ranks = new Map(
    [...new Set(regions.map((region) => region.zIndex))]
      .sort((left, right) => left - right)
      .map((zIndex, rank) => [zIndex, rank]),
  );
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showDepthMap),
    ...regions.map((region, index) => {
      const rank = ranks.get(region.zIndex) ?? 0;
      return element("path", [
        ...regionAttributes(region, index),
        { name: "data-depth-rank", value: rank },
        { name: "d", value: pathData(region.path) },
        { name: "fill", value: DEPTH_INK },
        {
          name: "fill-opacity",
          value: Math.min(DEPTH_TINT_MAX, 0.05 + rank * DEPTH_TINT_STEP),
        },
        { name: "stroke", value: DEPTH_INK },
        { name: "stroke-width", value: OUTLINE_WEIGHT },
      ]);
    }),
  );
}

/** One line system of a region fill, as the overlay draws it. */
interface HatchDirection {
  /** The family letter, `a` or `b`, matching the hatch stroke records. */
  family: "a" | "b";
  /** The angle in degrees, straight from the fill style. */
  angle: number;
  /** The spacing in scene units, straight from the fill style. */
  spacing: number;
}

/** The line systems of one region fill, in family order. */
function hatchDirectionsOf(region: Region): HatchDirection[] {
  if (region.fillStyle.type === "hatch") {
    return [{ family: "a", angle: region.fillStyle.angle, spacing: region.fillStyle.spacing }];
  }
  if (region.fillStyle.type === "crosshatch") {
    return [
      { family: "a", angle: region.fillStyle.angleA, spacing: region.fillStyle.spacingA },
      { family: "b", angle: region.fillStyle.angleB, spacing: region.fillStyle.spacingB },
    ];
  }
  return [];
}

/**
 * The hatch direction map: one arrow per line system of every filled region,
 * drawn at the center of the region's extent.
 *
 * The arrow points along the angle the strokes actually run, so a reader sees
 * at a glance which family filled which region, and where a crosshatch
 * crosses. An unfilled region draws nothing here: it has no direction to
 * show, and the negative-space map is the overlay that covers it.
 */
function hatchDirectionLayer(ir: RenderIR): XmlElement {
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showHatchDirections),
    ...regionsInDrawOrder(ir.regions).flatMap((region, index) => {
      const directions = hatchDirectionsOf(region);
      if (directions.length === 0) {
        return [];
      }
      const bounds = pathBounds(region.path);
      const length = clamp(
        Math.min(bounds.width, bounds.height) * ARROW_LENGTH_SHARE,
        ARROW_LENGTH_RANGE,
      );
      const center: Point = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
      return directions.map((direction) =>
        element("path", [
          ...regionAttributes(region, index),
          { name: "data-family", value: direction.family },
          { name: "data-angle", value: direction.angle },
          { name: "data-spacing", value: direction.spacing },
          { name: "d", value: pathData(arrowPath(center, direction.angle, length)) },
          { name: "stroke", value: HATCH_DIRECTION_INK },
          { name: "stroke-width", value: 1.4 },
        ]),
      );
    }),
  );
}

/**
 * The negative-space map: every carved mask and every unfilled region,
 * tinted.
 *
 * A mask with `invert` true - a cloud cutout - erases the hatching under its
 * path, so the paper shows through inside it. A mask that keeps only its
 * inside does the opposite, and the overlay marks the two senses apart,
 * because they read as opposite shapes of emptiness.
 */
function negativeSpaceLayer(ir: RenderIR): XmlElement {
  const tint = (extra: readonly XmlAttribute[], path: Path): XmlElement =>
    element("path", [
      ...extra,
      { name: "d", value: pathData(path) },
      { name: "fill", value: NEGATIVE_SPACE_INK },
      { name: "fill-opacity", value: 0.18 },
      { name: "stroke", value: NEGATIVE_SPACE_INK },
      { name: "stroke-width", value: OUTLINE_WEIGHT },
      { name: "stroke-dasharray", value: "4 3" },
    ]);
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showNegativeSpace),
    ...ir.masks.map((mask) =>
      tint(
        [
          { name: "data-mask-id", value: mask.id },
          { name: "data-invert", value: String(mask.invert) },
        ],
        mask.path,
      ),
    ),
    ...regionsInDrawOrder(ir.regions)
      .filter((region) => region.fillStyle.type === "none")
      .map((region, index) =>
        tint(
          [
            { name: "data-region-id", value: region.id },
            ...(region.role === undefined
              ? []
              : [{ name: "data-role", value: region.role }]),
            { name: "data-unfilled", value: "true" },
            { name: "data-order", value: index },
          ],
          region.path,
        ),
      ),
  );
}

/**
 * The object anchors: one marker per placement, at the point the spec
 * positioned, sized by the object scale.
 *
 * A clamped object - one the planner had to move back onto the canvas -
 * carries the fact on its marker, because that is the anchor a reader cannot
 * explain from the spec alone.
 */
function anchorLayer(ir: RenderIR): XmlElement {
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showAnchors),
    ...ir.anchors.map((anchor) =>
      element("path", [
        { name: "data-object-id", value: anchor.objectId },
        { name: "data-kind", value: anchor.kind },
        ...(anchor.role === undefined
          ? []
          : [{ name: "data-role", value: anchor.role }]),
        { name: "data-depth", value: anchor.depth },
        { name: "data-depth-index", value: anchor.depthIndex },
        ...(anchor.positionClamped
          ? [{ name: "data-position-clamped", value: "true" }]
          : []),
        { name: "d", value: pathData(anchorMarkerPath(anchor)) },
        { name: "stroke", value: ANCHOR_INK },
        { name: "stroke-width", value: 1.3 },
      ]),
    ),
  );
}

/** One dashed guide line across the whole canvas width at one height. */
function horizontalGuide(y: number, width: number): Path {
  return {
    commands: lineCommands([
      { x: 0, y },
      { x: width, y },
    ]),
  };
}

/**
 * The horizon guide, level or rolled.
 *
 * The horizon the plan recorded holds `horizonY` at the center column. A
 * rolled framing slopes it away from there by `horizonTilt` degrees, so the
 * guide follows the same slope and lands on the edge the sky and ground
 * regions share.
 */
function horizonGuide(
  horizonY: number,
  width: number,
  tiltDegrees: number,
): Path {
  if (tiltDegrees === 0) {
    return horizontalGuide(horizonY, width);
  }
  const slope = -Math.tan((tiltDegrees * Math.PI) / 180);
  const half = width / 2;
  return {
    commands: lineCommands([
      { x: 0, y: horizonY - slope * half },
      { x: width, y: horizonY + slope * half },
    ]),
  };
}

/**
 * The construction lines: the canvas frame, the horizon, every region clip
 * extent, and one guide axis pair per object anchor.
 *
 * These are the lines the scene was built on. The horizon comes from the
 * plan, the clip extents from the style stage, and the anchor guides from the
 * placements, so the overlay shows the skeleton every stage agreed on.
 */
function constructionLayer(ir: RenderIR): XmlElement {
  const guide = (extra: readonly XmlAttribute[], path: Path): XmlElement =>
    element("path", [
      ...extra,
      { name: "d", value: pathData(path) },
      { name: "stroke", value: CONSTRUCTION_INK },
      { name: "stroke-width", value: 0.8 },
      { name: "stroke-dasharray", value: "3 4" },
    ]);
  const frame: XmlElement = element("rect", [
    { name: "data-guide", value: "canvas" },
    { name: "x", value: 0 },
    { name: "y", value: 0 },
    { name: "width", value: ir.canvas.width },
    { name: "height", value: ir.canvas.height },
    { name: "fill", value: "none" },
    { name: "stroke", value: CONSTRUCTION_INK },
    { name: "stroke-width", value: 0.8 },
    { name: "stroke-dasharray", value: "3 4" },
  ]);
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showConstructionLines),
    frame,
    ...(ir.horizonY === undefined
      ? []
      : [
          guide(
            [{ name: "data-guide", value: "horizon" }],
            horizonGuide(
              ir.horizonY,
              ir.canvas.width,
              ir.horizonTilt ?? 0,
            ),
          ),
        ]),
    ...ir.regions
      .filter((region) => region.clip !== undefined)
      .map((region) =>
        guide(
          [
            { name: "data-guide", value: "clip-extent" },
            { name: "data-region-id", value: region.id },
          ],
          region.clip!,
        ),
      ),
    ...ir.anchors.flatMap((anchor) => {
      const { x, y } = anchor.position;
      const attributes: readonly XmlAttribute[] = [
        { name: "data-guide", value: "anchor-axis" },
        { name: "data-object-id", value: anchor.objectId },
      ];
      return [
        guide(attributes, horizontalGuide(y, ir.canvas.width)),
        guide(attributes, {
          commands: lineCommands([
            { x, y: 0 },
            { x, y: ir.canvas.height },
          ]),
        }),
      ];
    }),
  );
}

/**
 * The contour-only preview: the artwork under a paper wash, with the contour
 * strokes redrawn on top.
 *
 * The wash lives inside this layer, so the flag stays a pure addition: the
 * region stack, its masks, and the symbol placements stay in the document,
 * exactly as the cloud cutouts leave their ink in place and hide it at
 * composite time. A reader who strips the layer gets the full render back.
 */
function contourOnlyLayer(ir: RenderIR): XmlElement {
  return element(
    "g",
    layerAttributes(DEBUG_LAYER_NAMES.showContourOnly),
    element("rect", [
      { name: "data-wash", value: "paper" },
      { name: "x", value: 0 },
      { name: "y", value: 0 },
      { name: "width", value: ir.canvas.width },
      { name: "height", value: ir.canvas.height },
      { name: "fill", value: ir.style.palette.paper },
    ]),
    ...ir.contours.map((contour) =>
      element("path", [
        ...(contour.role === undefined
          ? []
          : [{ name: "data-role", value: contour.role }]),
        { name: "d", value: pathData(contour.path) },
        { name: "stroke", value: contour.color },
        { name: "stroke-width", value: contour.weight },
      ]),
    ),
  );
}

/** One overlay layer, by flag. */
function overlayLayer(ir: RenderIR, flag: DebugFlagName): XmlElement {
  switch (flag) {
    case "showContourOnly":
      return contourOnlyLayer(ir);
    case "showRegions":
      return regionMapLayer(ir);
    case "showDepthMap":
      return depthLayer(ir);
    case "showHatchDirections":
      return hatchDirectionLayer(ir);
    case "showNegativeSpace":
      return negativeSpaceLayer(ir);
    case "showAnchors":
      return anchorLayer(ir);
    case "showConstructionLines":
      return constructionLayer(ir);
  }
}

/**
 * The debug overlay layers of one render, in draw order.
 *
 * An intermediate representation without a debug block, or with every flag
 * off, returns no layer at all, so the document keeps the bytes of a plain
 * render. `showContourOnly` draws first, because the paper wash of its layer
 * is what the later overlays sit on.
 */
export function debugOverlayLayers(ir: RenderIR): XmlElement[] {
  return enabledDebugFlags(ir.debug).map((flag) => overlayLayer(ir, flag));
}
