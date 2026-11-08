/**
 * The scene compiler pipeline and the engine facade (specification sections
 * 4, 9, 10, 21, and 22).
 *
 * The compiler runs one spec through the five stages of specification
 * section 4 and records one event per stage, in order:
 *
 * 1. `intent` - parse and validate the spec, hash it, resolve the style.
 * 2. `planning` - canvas, horizon, regions, depth order, cloud cutouts.
 * 3. `geometry` - the placed geometry of every object.
 * 4. `style` - hatch family per region, composed regions, contours.
 * 5. `render` - the intermediate representation as one SVG document.
 *
 * The intent stage draws nothing, because V1 input is structured; the four
 * stages that follow each draw from their own stream.
 *
 * Determinism (specification section 10) has two rules here. First, every
 * stage draws from its own stream, derived from the render identity alone
 * through {@link createStageRng}, so a draw in one stage never shifts the
 * numbers of another. Second, the trace holds no wall-clock value except
 * `exportDurationMs`, a measurement of the run rather than a fact of the
 * compile, so the same identity gives the same bytes and the same trace
 * up to that one number.
 *
 * The engine owns the orchestration and nothing else. The collaborators
 * that need other packages - the preset registry, the object generators,
 * boolean region composition, contour simplification, the SVG renderer -
 * enter through the constructor, which keeps @hatch/core free of imports
 * from the packages that depend on it. The V1 binding lives in
 * @hatch/renderer-svg and wires every stage to its real implementation.
 */

import type { PlacementCamera } from "./camera.js";
import { depthRampOf } from "./camera.js";
import { wobbleContour } from "./contour.js";
import {
  environmentFamilyMatches,
  fogInkShare,
  rainFillStyle,
  type EnvironmentType,
} from "./environment.js";
import { sceneSpecHash } from "./hash.js";
import type { ContourStroke, Mask, ObjectAnchor, RenderIR } from "./ir.js";
import { openFillStyle } from "./negative-space.js";
import type { Path, Point } from "./path.js";
import {
  planScene,
  rectanglePath,
  type ObjectPlacement,
  type ScenePlan,
} from "./plan.js";
import type { Region } from "./region.js";
import type { Geometry } from "./geometry.js";
import { createStageRng, type SceneSeedParts, type SeededRng } from "./rng.js";
import {
  enabledDebugFlags,
  parseSceneSpec,
  type SceneObject,
  type SceneSpec,
} from "./scene.js";
import { styleRoleFamily } from "./style-role.js";
import type { FillStyle } from "./fill.js";
import {
  ResolvedStyleSpecSchema,
  StyleOverridesSchema,
  type ObjectGrammar,
  type ResolvedStyleSpec,
  type StyleOverrides,
  type StyleSpec,
} from "./style.js";
import { formatIssues } from "./error.js";
import type { ObjectGrammarDetail } from "./object-grammar.js";
import type { OutputMetrics, RenderTrace, TraceEvent } from "./trace.js";

/**
 * The version of the compiler itself. It is one of the four identity inputs
 * of every render (specification section 10), recorded in the trace and the
 * embedded metadata, and it prefixes the seed key of every stage stream.
 */
export const COMPILER_VERSION = "0.1.0";

/**
 * Every hatch family a style preset defines, plus `none` for paper
 * (specification section 16D). The style application stage maps each region
 * role onto one of these.
 */
export type ZoneFamilyName =
  | "sky"
  | "field"
  | "foliage"
  | "mountain"
  | "water"
  | "cliff"
  | "none";

/**
 * The style zones the engine can fill: region role to hatch family. The V1
 * table is built from the role vocabulary of @hatch/objects, so the object
 * generators stay the one source of truth for the roles they emit.
 */
export type ZoneFamilyTable = Readonly<Record<string, ZoneFamilyName>>;

/** One preset inside the engine's style registry, with the id the spec names. */
export interface NamedStylePreset {
  /** The value a scene spec writes into `meta.stylePreset`. */
  readonly id: string;
  /** The preset itself. */
  readonly style: StyleSpec;
}

/**
 * Reads presets by the id a scene spec names. `@hatch/styles` satisfies this
 * interface with `listStylePresets` and `resolveStyle`.
 */
export interface StylePresetSource {
  /** Every registered preset id, in stable order. */
  listPresets(): string[];
  /** One resolved style: the preset with the spec overrides merged in. */
  resolve(presetId: string, overrides?: StyleOverrides): ResolvedStyleSpec;
}

/**
 * The style input of the engine: a preset source, or the presets themselves
 * as specification section 21 shows them, one array entry per preset.
 */
export type StylePresetInput = StylePresetSource | readonly NamedStylePreset[];

/** What one scene object needs from the geometry synthesis stage. */
export interface ObjectGeometryRequest {
  /** The scene object from the spec: id, kind, scale, rotation, params. */
  readonly object: SceneObject;
  /** Where the local origin of the object lands, in scene units. */
  readonly anchor: Point;
  /**
   * The placement transform the camera computed for the object: its scale
   * under the framing, the depth plane, and the focal emphasis, and its
   * rotation plus the camera roll. A source that ignores it draws the object
   * at the scale and the rotation the spec states alone.
   */
  readonly camera?: PlacementCamera;
  /** The seeded stream of the geometry stage. */
  readonly rng: SeededRng;
  /**
   * The object grammar of the resolved style (specification section 8),
   * carried inside the decision record of the plan: the four grammar fields
   * plus the detail budget the planner derived from them. The source
   * enforces it over the geometry it returns, so the level of detail the
   * style states reaches every object (specification section 18), and
   * reports what the enforcement dropped in the `grammarDetail` of its
   * answer, so the trace can state the omission (section 9B).
   */
  readonly objectGrammar: ObjectGrammar;
}

/**
 * What one object source returns for one request: the placed geometry, and
 * what the grammar of the request omitted from it.
 *
 * The detail travels on the geometry the source already returns, because
 * only the source sees the boundary count before the grammar runs. The
 * geometry synthesis stage lifts it off the object and records it in the
 * trace, so what the style simplified away stays readable (specification
 * section 9B). A source that counts no omission returns the geometry alone.
 */
export type GeneratedObjectGeometry = Geometry & {
  /**
   * What the object grammar of the request did to the internal boundaries
   * of this object. Present when the source enforced a grammar and counted
   * the marks it dropped.
   */
  readonly grammarDetail?: ObjectGrammarDetail;
};

/**
 * Builds the geometry of one placed scene object. `@hatch/objects` satisfies
 * this interface with `generateSceneObject`.
 */
export interface ObjectGeometrySource {
  /** One placed geometry, in scene units (specification section 6). */
  generateObject(request: ObjectGeometryRequest): GeneratedObjectGeometry;
}

/** What the render stage returns for one intermediate representation. */
export interface SvgRenderOutput {
  /** The SVG document, XML declaration included. */
  readonly svg: string;
  /** How many hatch strokes the document draws. */
  readonly strokeCount: number;
  /**
   * Total length of the hatch strokes the document draws, in user units.
   * The visual density score of the trace divides this by the canvas area
   * (specification section 9E).
   */
  readonly strokeLength: number;
}

/**
 * Draws one intermediate representation as SVG. `@hatch/renderer-svg`
 * satisfies this interface with `renderSvgDocument`.
 */
export interface SvgRenderer {
  render(ir: RenderIR, rng: SeededRng): SvgRenderOutput;
}

/** One region the style application stage composes (specification section 7). */
export interface RegionCompositionInput {
  /** Region id. */
  readonly id: string;
  /** Region role from specification section 16C. */
  readonly role?: string;
  /** The region area before clipping and masks. */
  readonly path: Path;
  /** The fill style the composed region carries. */
  readonly fillStyle: FillStyle;
  /** The extent of the region. Everything outside it is dropped. */
  readonly clip?: Path;
  /** Cutouts carved out of the region, for example object silhouettes. */
  readonly masks?: readonly Path[];
  /** Draw order. Regions with a lower zIndex draw first. */
  readonly zIndex: number;
}

/**
 * Applies one region composition: clip extent, cutouts, empty geometry.
 * `@hatch/geometry` satisfies this type with `composeRegion`.
 */
export type RegionComposer = (input: RegionCompositionInput) => Region[];

/**
 * Simplifies one contour inside a tolerance. `@hatch/geometry` satisfies
 * this type with `simplifyPath`.
 */
export type ContourSimplifier = (path: Path, tolerance: number) => Path;

/**
 * The render identity of one spec: compiler version, seed, preset, and spec
 * hash (specification section 10). This is what every stage stream derives
 * from, and what the trace and the embedded metadata record.
 */
export function renderIdentityOf(spec: SceneSpec): SceneSeedParts {
  return {
    compilerVersion: COMPILER_VERSION,
    seed: spec.meta.seed,
    stylePreset: spec.meta.stylePreset,
    specHash: sceneSpecHash(spec),
  };
}

/** The geometry of one placed object, kept beside its placement. */
export interface ObjectGeometry {
  /** Where and how the object sits in the scene. */
  readonly placement: ObjectPlacement;
  /** The placed geometry of the object, in scene units. */
  readonly geometry: Geometry;
  /**
   * What the object grammar of the style did to the internal boundaries of
   * this object (specification section 9B). Absent when the object source
   * reported no omission, either because it counted none or because no
   * grammar governed the object.
   */
  readonly grammarDetail?: ObjectGrammarDetail;
}

/** What the geometry synthesis stage produced for every object. */
export interface SceneGeometry {
  /** Every placed geometry, in depth order. */
  readonly objects: readonly ObjectGeometry[];
}

/**
 * The anchors of every placement, for the render stage (specification
 * sections 5 and 9).
 *
 * The zones and contours of an object carry geometry but no position of their
 * own, so a debug overlay that marks "where the spec put this object" needs
 * this record beside them. Each anchor carries the scale the camera computed,
 * so a marker sizes itself the way the object drew.
 */
export function anchorsOfPlan(plan: ScenePlan): ObjectAnchor[] {
  return plan.placements.map((placement) => ({
    objectId: placement.object.id,
    kind: placement.object.kind,
    ...(placement.object.role === undefined
      ? {}
      : { role: placement.object.role }),
    position: placement.anchor,
    scale: placement.camera.scale,
    depth: placement.depth,
    depthIndex: placement.depthIndex,
    positionClamped: placement.positionClamped,
  }));
}

/**
 * The geometry synthesis stage: ask the object source for the geometry of
 * every placement, in depth order.
 *
 * Each object receives the stage stream, the placement transform the
 * camera computed, and the object grammar of the style, so the detail the
 * style states reaches every object the source draws. The source forks one
 * stream per object under its id, so adding an object never shifts the
 * numbers another object draws (specification section 10).
 *
 * What the grammar omitted travels back beside the geometry, and this stage
 * keeps it there: the detail is a fact of the compile, not of the drawing,
 * so the trace states it (section 9B) while the geometry stays the four
 * fields every consumer reads.
 */
export function synthesizeSceneGeometry(
  plan: ScenePlan,
  objects: ObjectGeometrySource,
  rng: SeededRng,
): SceneGeometry {
  return {
    objects: plan.placements.map((placement) => {
      const { grammarDetail, ...generated } = objects.generateObject({
        object: placement.object,
        anchor: placement.anchor,
        camera: placement.camera,
        rng,
        objectGrammar: plan.objectGrammar,
      });
      return {
        placement,
        geometry: generated,
        ...(grammarDetail === undefined ? {} : { grammarDetail }),
      };
    }),
  };
}

/** One region of the styled scene, with the family that filled it. */
export interface RegionFill {
  /** The region id inside the intermediate representation. */
  readonly id: string;
  /** The region role the family was looked up by. */
  readonly role: string;
  /** What filled the region: a hatch family, or the rain the atmosphere asked for. */
  readonly family: RegionFillFamily;
}

/** What the style application stage produced (specification section 4D). */
export interface StyledScene {
  /** Every region, in draw order, fill styles applied. */
  readonly regions: readonly Region[];
  /** The contour strokes, simplified and humanized. */
  readonly contours: readonly ContourStroke[];
  /** The cloud cutouts of the plan, as negative space. */
  readonly masks: readonly Mask[];
  /** Which family filled which region, for the trace. */
  readonly fills: readonly RegionFill[];
}

/** The optional geometry tools the style application stage runs with. */
export interface StyleStageTools {
  /**
   * Composes the planned regions and the object style zones: applies the clip
   * extent, carves the object silhouettes out of the sky and the ground, and
   * carves the silhouettes of the objects in front of an object out of its
   * zones. Without a composer both pass through as authored, so the hatch
   * fields of the scene and of its objects overlap.
   */
  readonly composeRegion?: RegionComposer;
  /** Simplifies each contour within `contours.simplifyTolerance`. */
  readonly simplifyContour?: ContourSimplifier;
  /**
   * Clips one open contour line to a visible area, so a scene-level line
   * such as a ground strip stops at the objects that stand in front of it.
   * `@hatch/geometry` satisfies this type with `clipStroke`. Without it the
   * line draws as planned, unclipped.
   */
  readonly clipContour?: ContourClipper;
  /**
   * Carves the silhouettes of the objects in front of one object out of its
   * contour lines, the same cutouts the composer carves out of its zones.
   * `@hatch/geometry` satisfies this type with `carveStroke`. Without it the
   * lines draw whole, so the content lines of a background object cross the
   * objects that stand in front of it.
   */
  readonly carveContour?: ContourCarver;
}

/**
 * Keeps the parts of one contour line that fall outside every mask.
 * `@hatch/geometry` satisfies this type with `carveStroke`.
 */
export type ContourCarver = (
  line: Path,
  masks: readonly Path[],
) => Path[];

/**
 * Clips one open line to one closed area. `@hatch/geometry` satisfies this
 * type with `clipStroke`.
 */
export type ContourClipper = (line: Path, area: Path) => Path[];

/**
 * The zIndex a style zone draws at inside its own object when its generator
 * set none.
 */
export const DEFAULT_OBJECT_ZONE_Z_INDEX = 10;

/**
 * The id of the rain region, the one region the atmosphere stage adds. It
 * names the hatch stream of the region, so it must stay unique against
 * every planned region and object zone id.
 */
export const RAIN_REGION_ID = "atmosphere-rain";

/**
 * The width of one object's band in the region stack.
 *
 * The renderer stacks regions by `zIndex` alone, and the carve of
 * specification section 7 follows the depth order of the plan, so the two
 * orders must agree. They do, because the style application stage paints the
 * zones of one object inside one band per object, in the depth order of the
 * plan: an object that stands in front draws its whole band above every band
 * behind it, whatever layer the two generators authored. The authored
 * `zIndex` of a zone orders the zones of its own object alone, so the band
 * width is the ceiling of that authored layer.
 */
export const OBJECT_ZONE_BAND_STRIDE = 100;

/**
 * The zIndex one style zone paints at: the band of its object in the depth
 * order of the plan, plus the layer its generator authored inside the
 * object.
 *
 * This is the one place the paint order and the depth order meet. Without
 * it, the authored layers of two generators decide which object paints
 * above, and a foreground road that authored 6 draws under a midground wall
 * that authored 10 while the carve of the same scene treats the road as the
 * object in front.
 */
export function objectZoneZIndex(depthIndex: number, zoneZIndex: number): number {
  return OBJECT_ZONE_BAND_STRIDE * depthIndex + zoneZIndex;
}

/**
 * The zIndex the rain region draws at: one band above every object, because
 * rain falls in front of the scene.
 */
export function rainZoneZIndex(objectCount: number): number {
  return OBJECT_ZONE_BAND_STRIDE * objectCount;
}

/**
 * The layer one style zone paints at inside its object's band, read from the
 * authored `zIndex` of the zone.
 *
 * The authored layer orders the zones of one object and nothing else, so a
 * value outside the band would leak into the band of a neighbour object and
 * the stack would disagree with the depth order again. The style stage
 * states that contract out loud instead of drawing a scene whose stacking
 * contradicts its own carving.
 */
function objectZoneLayer(
  objectId: string,
  zoneIndex: number,
  authored: number,
): number {
  if (authored < 1 || authored >= OBJECT_ZONE_BAND_STRIDE) {
    throw new Error(
      `the style zone ${objectId}:z${zoneIndex} authored zIndex ${authored}, ` +
        `which falls outside the 1 to ${OBJECT_ZONE_BAND_STRIDE - 1} band of ` +
        `one object; a zone zIndex orders the zones of its own object alone, ` +
        `and the depth order of the plan places one object against another`,
    );
  }
  return authored;
}

/**
 * What filled one composed region: the hatch family a preset carries, or
 * the rain the atmosphere asked for, which no preset defines.
 */
export type RegionFillFamily = ZoneFamilyName | "rain";

/** The hatch family of one region role, from the table the engine holds. */
function familyOfRole(zoneFamilies: ZoneFamilyTable, role: string): ZoneFamilyName {
  const family = zoneFamilies[role];
  if (family === undefined) {
    throw new Error(
      `no hatch family is registered for the style zone role "${role}"; ` +
        `known roles: ${Object.keys(zoneFamilies).sort().join(", ")}`,
    );
  }
  return family;
}

/** The fill style of one hatch family under one resolved style. */
function fillOfFamily(
  style: ResolvedStyleSpec,
  family: ZoneFamilyName,
): FillStyle {
  if (family === "none") {
    return { type: "none" };
  }
  const spec = style.hatchFamilies[family];
  return "angleA" in spec
    ? {
        type: "crosshatch",
        angleA: spec.angleA,
        angleB: spec.angleB,
        spacingA: spec.spacingA,
        spacingB: spec.spacingB,
        stroke: spec.stroke,
        weight: spec.weight,
        jitter: spec.jitter,
      }
    : {
        type: "hatch",
        angle: spec.angle,
        spacing: spec.spacing,
        stroke: spec.stroke,
        weight: spec.weight,
        jitter: spec.jitter,
      };
}

/**
 * Scale one fill by the ink share fog leaves an object.
 *
 * A faded fill draws thinner and sparser: the weight falls by the share and
 * the spacing grows by it, which is how a distant mass reads lighter in ink
 * without changing colour. A share of 1 returns the fill unchanged.
 */
function fadeFillStyle(fillStyle: FillStyle, share: number): FillStyle {
  if (share === 1 || fillStyle.type === "none") {
    return fillStyle;
  }
  if (fillStyle.type === "hatch") {
    return {
      ...fillStyle,
      spacing: fillStyle.spacing / share,
      weight: fillStyle.weight * share,
    };
  }
  return {
    ...fillStyle,
    spacingA: fillStyle.spacingA / share,
    spacingB: fillStyle.spacingB / share,
    weight: fillStyle.weight * share,
  };
}

/**
 * The visible ground area: the planned ground region with every object
 * silhouette carved out.
 *
 * A ground strip draws inside this area, so it stops at the objects that
 * stand on the ground instead of crossing them. Without a composer there is
 * no carving, and the strips draw across the whole ground as planned.
 */
function visibleGroundArea(
  plan: ScenePlan,
  silhouettes: readonly Path[],
  tools: StyleStageTools,
): Path | null {
  const ground = plan.regions.find((region) => region.role === "ground");
  if (ground === undefined) {
    return null;
  }
  if (tools.composeRegion === undefined || silhouettes.length === 0) {
    return ground.path;
  }
  const [composed] = tools.composeRegion({
    id: `${ground.id}:strips`,
    role: ground.role,
    path: ground.path,
    fillStyle: { type: "none" },
    masks: silhouettes,
    zIndex: ground.zIndex,
  });
  return composed === undefined ? null : composed.path;
}

/**
 * The style application stage: fill every region, compose the scene regions,
 * and draw the contours.
 *
 * Each scene region - the sky, the ground - carries the silhouettes of every
 * object as cutouts, so the hatch of the scene stops where an object stands
 * instead of crossing under it. Each object zone becomes one region under
 * `${objectId}:z${index}`, which keeps region ids unique whatever roles two
 * zones share, and carries the silhouettes of the objects that draw after it
 * in depth order as its cutouts, so the hatch of a background object stops at
 * the silhouette of the object in front of it (specification section 7: no
 * line system crosses an object that covers it). The silhouette of the object
 * itself never carves its own zones, and an object's own zIndex layering -
 * wall under roof, roof under glass - keeps drawing inside one silhouette.
 *
 * The stack paints the zones of one object inside one band per object, in
 * the same depth order the cutouts above carve with ({@link
 * objectZoneZIndex}). The authored zIndex of a zone orders the zones of its
 * own object alone; the depth order of the plan decides which object paints
 * above another, so the renderer that stacks by zIndex alone never paints
 * the object in front under the object behind it.
 *
 * The environment reaches this stage through the plan (specification section
 * 5). A `styleRole` on an object replaces the family every zone of that
 * object resolves to, so one object can read as a distant silhouette or as
 * unfilled paper. The fog of the atmosphere scales the fills and the contour
 * weight of every object by its draw depth, and its rain adds one region
 * over the whole scene, above every object zone. The negative space of the
 * composition reaches this stage through the plan too: it opens the spacing
 * of every hatch fill the scene draws, scene regions and object zones
 * alike, while the weight of every stroke stays what the style states. The
 * rain keeps the density its own count names, because `rain` states its
 * stroke count instead of its spacing. The object grammar of the style
 * reaches the negative space of the scene here the same way: the cloud
 * cutouts stay masks only while `keepNegativeSpace` holds, and a style
 * that fills its paper drops them.
 *
 * The contours of every object, plus its internal boundaries and the ground
 * strips of the environment, draw in the contour ink and weight of the
 * style, simplified within the tolerance the style states, then humanized
 * within its wobble budget. Each contour forks the style stream under its
 * object id and line index, so adding a detail line to one object never
 * shifts the wobble of another. A line the objects in front cover carves at
 * their silhouettes after it humanizes, so the drawn ink stops where the
 * covering object starts, the same cut its object's hatch already takes.
 */
export function applySceneStyle(
  plan: ScenePlan,
  geometry: SceneGeometry,
  style: ResolvedStyleSpec,
  zoneFamilies: ZoneFamilyTable,
  tools: StyleStageTools,
  rng: SeededRng,
): StyledScene {
  const atmosphere = plan.environment.atmosphere;
  const negativeSpace = plan.negativeSpace;
  const silhouettes: Path[] = geometry.objects.map(
    (entry) => entry.geometry.silhouette,
  );

  const entries: { region: Region; family: RegionFillFamily }[] = [];
  const pushRegion = (region: Region, family: RegionFillFamily): void => {
    entries.push({ region, family });
  };

  for (const planned of plan.regions) {
    const family = familyOfRole(zoneFamilies, planned.role);
    const fillStyle = openFillStyle(
      fillOfFamily(style, family),
      negativeSpace.spacingMultiplier,
    );
    if (tools.composeRegion === undefined) {
      pushRegion(
        {
          id: planned.id,
          role: planned.role,
          path: planned.path,
          fillStyle,
          zIndex: planned.zIndex,
        },
        family,
      );
      continue;
    }
    const composed = tools.composeRegion({
      id: planned.id,
      role: planned.role,
      path: planned.path,
      fillStyle,
      masks: silhouettes,
      zIndex: planned.zIndex,
    });
    for (const region of composed) {
      pushRegion(region, family);
    }
  }

  geometry.objects.forEach(({ placement, geometry: objectGeometry }, index) => {
    // The objects that draw after this one in depth order stand in front of
    // it, so their silhouettes carve every zone of this object. The list
    // starts after this object, which keeps an object from carving its own
    // zones away.
    const occluders = silhouettes.slice(index + 1);
    // A style role overrides the family every zone of the object resolves
    // to, and the fog scales whatever fill the object draws with.
    const roleFamily = placement.object.styleRole === undefined
      ? undefined
      : styleRoleFamily(placement.object.styleRole);
    const inkShare = fogInkShare(atmosphere.fog, placement.depth);
    objectGeometry.styleZones.forEach((zone, zoneIndex) => {
      const family = roleFamily ?? familyOfRole(zoneFamilies, zone.role);
      const fillStyle = fadeFillStyle(
        openFillStyle(
          fillOfFamily(style, family),
          negativeSpace.spacingMultiplier,
        ),
        inkShare,
      );
      const id = `${placement.object.id}:z${zoneIndex}`;
      // The band of the object in depth order plus the layer its generator
      // authored inside it, so the stack the renderer paints by zIndex
      // alone holds the same front-to-back order the masks above carve.
      const zIndex = objectZoneZIndex(
        placement.depthIndex,
        objectZoneLayer(
          placement.object.id,
          zoneIndex,
          zone.zIndex ?? DEFAULT_OBJECT_ZONE_Z_INDEX,
        ),
      );
      if (tools.composeRegion === undefined) {
        pushRegion(
          {
            id,
            role: zone.role,
            path: zone.path,
            fillStyle,
            zIndex,
          },
          family,
        );
        return;
      }
      const composed = tools.composeRegion({
        id,
        role: zone.role,
        path: zone.path,
        fillStyle,
        masks: occluders,
        zIndex,
      });
      for (const region of composed) {
        pushRegion(region, family);
      }
    });
  });

  // The rain the atmosphere asks for: one region over the whole scene, in
  // the contour ink of the style, above every object zone. Its band sits one
  // stride above the band of the last object, so the authored layer of no
  // generator can paint its zone over the rain.
  if (atmosphere.rain > 0) {
    pushRegion(
      {
        id: RAIN_REGION_ID,
        role: "rain",
        path: rectanglePath(0, 0, plan.canvas.width, plan.canvas.height),
        fillStyle: rainFillStyle(style, plan.canvas, atmosphere.rain),
        zIndex: rainZoneZIndex(geometry.objects.length),
      },
      "rain",
    );
  }

  const contours: ContourStroke[] = [];

  // The ground strips of the environment draw first, under the contours of
  // every object, and inside the visible ground alone.
  if (plan.groundStrips.length > 0) {
    const area = visibleGroundArea(plan, silhouettes, tools);
    for (const strip of plan.groundStrips) {
      const pieces = area === null
        ? []
        : tools.clipContour === undefined
          ? [strip.path]
          : tools.clipContour(strip.path, area);
      for (const [index, piece] of pieces.entries()) {
        const stream = rng.fork(`contour:${strip.id}:${index}`);
        const simplified =
          tools.simplifyContour === undefined
            ? piece
            : tools.simplifyContour(piece, style.contours.simplifyTolerance);
        contours.push({
          path: wobbleContour(
            simplified,
            style.contours.wobble,
            style.texture,
            stream,
          ),
          weight: style.contours.weight,
          color: style.contours.color,
          role: "contour",
        });
      }
    }
  }

  geometry.objects.forEach(({ placement, geometry: objectGeometry }, index) => {
    const lines = [
      ...objectGeometry.contours,
      ...objectGeometry.internalBoundaries,
    ];
    // The same objects that carve this object's zones stand in front of its
    // lines: every contour and internal boundary stops at their silhouettes,
    // so no content line of a background object draws through an object in
    // front of it (specification section 7: no line system crosses an object
    // that covers it).
    const occluders = silhouettes.slice(index + 1);
    // The same fog that faded the fills thins the contour weight, so the
    // whole object reads lighter, not only its hatch.
    const weight = style.contours.weight *
      fogInkShare(atmosphere.fog, placement.depth);
    for (const [lineIndex, line] of lines.entries()) {
      // One stream per contour, under the object id and the line index, so
      // a generator that adds or drops one detail line never shifts the
      // wobble of any other contour in the scene. The fork escapes the
      // label, so the id needs no quoting here.
      const stream = rng.fork(`contour:${placement.object.id}:${lineIndex}`);
      const simplified =
        tools.simplifyContour === undefined
          ? line
          : tools.simplifyContour(line, style.contours.simplifyTolerance);
      const wobbled = wobbleContour(
        simplified,
        style.contours.wobble,
        style.texture,
        stream,
      );
      // The carve runs after the wobble, so the ink the document draws stops
      // at the front silhouette. Carving the ideal line instead would let
      // the humanized ink cross it by the wobble budget.
      const pieces =
        tools.carveContour === undefined || occluders.length === 0
          ? [wobbled]
          : tools.carveContour(wobbled, occluders);
      for (const piece of pieces) {
        contours.push({
          path: piece,
          weight,
          color: style.contours.color,
          role: "contour",
          objectId: placement.object.id,
        });
      }
    }
  });

  // The cloud cutouts are the negative space of the scene (specification
  // section 3C: clouds are negative space cutouts), so the object grammar
  // of the style governs them: a style that keeps no negative space drops
  // the masks, and the hatch of the sky runs unbroken through the clouds.
  const masks: Mask[] = plan.objectGrammar.keepNegativeSpace
    ? plan.masks.map((mask) => ({
        id: mask.id,
        path: mask.path,
        invert: true,
      }))
    : [];

  const ordered = [...entries].sort(
    (left, right) => left.region.zIndex - right.region.zIndex,
  );
  return {
    regions: ordered.map((entry) => entry.region),
    contours,
    masks,
    fills: ordered.map((entry) => ({
      id: entry.region.id,
      role: entry.region.role ?? "",
      family: entry.family,
    })),
  };
}

/**
 * What one edit run needs from the engine (specification sections 15 and
 * 21). `setStyle` reads the resolved style of the spec's preset, so the
 * override it writes back is complete whatever the preset holds.
 */
export interface SceneEditContext {
  /**
   * The resolved style of one preset under one override set. Throws when
   * the preset is unknown or the overrides do not parse.
   */
  resolveStyle(presetId: string, overrides?: StyleOverrides): ResolvedStyleSpec;
}

/**
 * Applies the edit operations of specification section 21 to one scene
 * spec. The operations patch the spec and never the pixels (specification
 * section 15), so their result is one updated spec the caller re-renders.
 *
 * `@hatch/core` cannot import the package that owns the operations,
 * `@hatch/agent`, because that package depends on this one. So the engine
 * receives the operations through this interface, the same inversion every
 * other collaborator uses, and the composition root of @hatch/renderer-svg
 * binds {@link SceneEditSource} to `sceneEditSource` from `@hatch/agent`.
 */
export interface SceneEditSource {
  /**
   * Apply every operation, in order, to one spec. The result parses
   * against the `SceneSpec` schema, and the input spec is never mutated.
   */
  applyEdits(
    spec: SceneSpec,
    operations: readonly unknown[],
    context: SceneEditContext,
  ): SceneSpec;
}

/** Every collaborator and tool the engine runs with. */
export interface HatchEngineOptions {
  /** The style presets the engine resolves `meta.stylePreset` against. */
  readonly styles: StylePresetInput;
  /** The object generator facade of the geometry stage. */
  readonly objects: ObjectGeometrySource;
  /** The SVG renderer of the render stage. */
  readonly renderer: SvgRenderer;
  /** Which hatch family fills which region role. */
  readonly zoneFamilies: ZoneFamilyTable;
  /** The optional geometry tools of the style stage. */
  readonly tools?: StyleStageTools;
  /** The edit operations of specification section 21, when this engine accepts edits. */
  readonly edits?: SceneEditSource;
}

/** What one render returns (specification section 21, V1 scope). */
export interface RenderResult {
  /** The SVG document, XML declaration included. */
  readonly svg: string;
  /** The parsed scene spec the render compiled. */
  readonly sceneSpec: SceneSpec;
  /** The style-aware intermediate representation (specification section 22). */
  readonly ir: RenderIR;
  /** The trace of the compilation run (specification section 9). */
  readonly trace: RenderTrace;
}

/** The UTF-8 size of one string, in bytes. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Resolve one preset of a registry, with the spec overrides merged in. */
function resolveFromRegistry(
  registry: ReadonlyMap<string, StyleSpec>,
  presetId: string,
  overrides?: StyleOverrides,
): ResolvedStyleSpec {
  const base = registry.get(presetId);
  if (base === undefined) {
    throw new Error(
      `unknown style preset '${presetId}'; available presets: ` +
        `${[...registry.keys()].sort().join(", ")}`,
    );
  }
  if (overrides !== undefined) {
    const overrideResult = StyleOverridesSchema.safeParse(overrides);
    if (!overrideResult.success) {
      throw new Error(
        `invalid style overrides for preset '${presetId}': ` +
          `${formatIssues(overrideResult.error.issues)}`,
      );
    }
  }
  const merged = structuredClone({ ...base, ...(overrides ?? {}), preset: presetId });
  const result = ResolvedStyleSpecSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `could not resolve style preset '${presetId}': ${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

/** Turn any valid style input into one preset source. */
function normalizeStylePresets(input: StylePresetInput): StylePresetSource {
  const source = input as StylePresetSource | null;
  if (
    typeof source?.listPresets === "function" &&
    typeof source.resolve === "function"
  ) {
    return source;
  }
  if (!Array.isArray(input)) {
    throw new Error(
      "HatchEngine styles must be a preset source or an array of named presets",
    );
  }

  const registry = new Map<string, StyleSpec>();
  for (const entry of input) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.style !== "object" ||
      entry.style === null
    ) {
      throw new Error(
        "every preset passed to HatchEngine needs an id and a style",
      );
    }
    if (registry.has(entry.id)) {
      throw new Error(`two presets share the id "${entry.id}"`);
    }
    registry.set(entry.id, structuredClone(entry.style));
  }
  if (registry.size === 0) {
    throw new Error("HatchEngine needs at least one style preset");
  }
  return {
    listPresets: () => [...registry.keys()].sort(),
    resolve: (presetId, overrides) =>
      resolveFromRegistry(registry, presetId, overrides),
  };
}

/** The trace event of the intent stage. */
function intentEvent(
  spec: SceneSpec,
  style: ResolvedStyleSpec,
  specHash: string,
): TraceEvent {
  return {
    stage: "intent",
    name: "spec accepted",
    message:
      `scene "${spec.meta.id}" parsed: ${spec.objects.length} object(s), ` +
      `preset "${spec.meta.stylePreset}", seed ${spec.meta.seed}`,
    data: {
      specId: spec.meta.id,
      specVersion: spec.meta.version,
      aspectRatio: spec.meta.aspectRatio,
      seed: spec.meta.seed,
      preset: spec.meta.stylePreset,
      objectCount: spec.objects.length,
      specHash,
      // The environment family the scene names and the family the resolved
      // preset draws. The intent stage checks the pair, so these two values
      // are the decision `environment.type` owns. "undeclared" means the
      // preset states no family and draws every environment.
      environmentType: spec.environment.type,
      presetEnvironmentType: style.environmentType ?? "undeclared",
      // The overlays the render will draw. The block never enters the spec
      // hash, so the trace is the one place a reader sees which were on.
      debugOverlays: enabledDebugFlags(spec.debug),
    },
  };
}

/**
 * Check the environment family of one spec against the family of the style
 * that renders it, the decision `environment.type` owns.
 *
 * The check runs in the intent stage, right after the style resolves, so a
 * scene that names a world its preset does not draw fails before any stage
 * runs. The error names both sides, the presets that draw the family the
 * scene asked for, and the two ways to fix the pair.
 */
function assertEnvironmentFamily(
  spec: SceneSpec,
  style: ResolvedStyleSpec,
  presets: StylePresetSource,
): void {
  const asked = spec.environment.type;
  const family = style.environmentType;
  if (environmentFamilyMatches(asked, family)) {
    return;
  }
  const drawing = presets
    .listPresets()
    .filter((id) => presets.resolve(id).environmentType === asked);
  throw new Error(
    `environment.type "${asked}" does not match the style preset ` +
      `"${style.preset}", which draws "${family}" environments; ` +
      (drawing.length > 0
        ? `the presets that draw "${asked}" are: ${drawing.join(", ")}`
        : `no registered preset draws "${asked}" environments yet`) +
      `. Set environment.type to "${family}" to render this scene under ` +
      `"${style.preset}", or to "custom" to keep the preset.`,
  );
}

/** The trace event of the planning stage (specification section 9B). */
function planningEvent(
  plan: ScenePlan,
  spec: SceneSpec,
  style: ResolvedStyleSpec,
): TraceEvent {
  const { horizon, camera } = plan;
  const band = `[${horizon.preferredHorizonBand[0]}, ${horizon.preferredHorizonBand[1]}]`;
  return {
    stage: "planning",
    name: "scene planned",
    message: horizon.wasClamped
      ? `horizon moved from ${horizon.requestedHorizonY} into the preferred band ${band}`
      : `horizon ${horizon.horizonY} sits inside the preferred band ${band}`,
    data: {
      canvasWidth: plan.canvas.width,
      canvasHeight: plan.canvas.height,
      horizonY: plan.horizonY,
      requestedHorizonY: horizon.requestedHorizonY,
      horizonClamped: horizon.wasClamped,
      regionIds: plan.regions.map((region) => region.id),
      cloudCount: plan.masks.length,
      // What the environment asked the render for, and what the planner
      // did with it. The strips are planned here; the fog and the rain
      // are applied by the style stage, which reads the same decision
      // back from the plan.
      environment: {
        type: spec.environment.type,
        groundStrips: plan.groundStrips.length,
        fog: plan.environment.atmosphere.fog,
        fogClamped: plan.environment.atmosphere.fogClamped,
        rain: plan.environment.atmosphere.rain,
      },
      depthOrder: [...plan.depthOrder],
      clampedObjectIds: [...plan.clampedObjectIds],
      focalObjectCount: plan.focalObjectCount,
      focalObjectLimit: style.compositionGrammar.focalObjectCount,
      // What the composition asked the paper to keep empty, the floor of
      // the style it is measured against, and the multiplier the style
      // stage opens every hatch spacing by.
      negativeSpace: {
        goal: plan.negativeSpace.goal,
        floor: plan.negativeSpace.floor,
        spacingMultiplier: plan.negativeSpace.spacingMultiplier,
        spacingMultiplierClamped: plan.negativeSpace.spacingMultiplierClamped,
      },
      // What the object grammar of the style allows every object: the
      // level and the ceiling it states, the detail budget the geometry
      // stage enforces over the internal boundaries, and the two answers
      // that act directly, the corner rounding and the kept paper
      // (specification section 18: the planner knows what level of detail
      // is acceptable).
      objectGrammar: {
        abstractionLevel: plan.objectGrammar.abstractionLevel,
        maxDetailPerObject: plan.objectGrammar.maxDetailPerObject,
        detailBudget: plan.objectGrammar.detailBudget,
        edgeRoundnessBias: plan.objectGrammar.edgeRoundnessBias,
        keepNegativeSpace: plan.objectGrammar.keepNegativeSpace,
      },
      // The camera and the composition the layout followed, so a reader of
      // the trace sees what each control did to the scene (section 9B).
      camera: {
        framing: camera.framing,
        framingScale: camera.framingScale,
        lens: camera.lens,
        perspective: camera.perspective,
        perspectiveStrength: camera.perspectiveStrength,
        perspectiveStrengthClamped: camera.perspectiveStrengthClamped,
        tiltDegrees: camera.tiltDegrees,
        tiltClamped: camera.tiltClamped,
        balance: camera.balance,
        balanceShift: camera.balanceShift,
        balanceSpread: camera.balanceSpread,
        depthLayers: camera.depthLayers,
        depthLayersClamped: camera.depthLayersClamped,
        depthRamp: depthRampOf(camera),
        focalPointIds: [...camera.focalPointIds],
      },
      focalPlacementIds: plan.placements
        .filter((placement) => placement.focal)
        .map((placement) => placement.object.id),
      placementCameras: plan.placements.map((placement) => ({
        id: placement.object.id,
        scale: placement.camera.scale,
        rotation: placement.camera.rotation,
      })),
    },
  };
}

/**
 * The trace event of the geometry stage (specification sections 9B and 9C).
 *
 * Beside the geometry facts of section 9C, the event states what the object
 * grammar of the style omitted (section 9B): per object, the internal
 * boundaries the generator emitted and the ones the grammar kept, so a
 * reader sees how many marks the style dropped and not only the ceiling it
 * enforced. Objects whose source reported no omission keep their record
 * without the counts.
 */
function geometryEvent(geometry: SceneGeometry): TraceEvent {
  const contours = geometry.objects.reduce(
    (total, entry) => total + entry.geometry.contours.length,
    0,
  );
  const boundaries = geometry.objects.reduce(
    (total, entry) => total + entry.geometry.internalBoundaries.length,
    0,
  );
  const zones = geometry.objects.reduce(
    (total, entry) => total + entry.geometry.styleZones.length,
    0,
  );
  const omitted = geometry.objects.reduce(
    (total, entry) =>
      total + (entry.grammarDetail?.droppedInternalBoundaries ?? 0),
    0,
  );
  return {
    stage: "geometry",
    name: "geometry synthesized",
    message: `${geometry.objects.length} object(s) placed: ` +
      `${contours} contour line(s), ${boundaries} internal boundary(ies), ` +
      `${zones} style zone(s)` +
      (omitted === 0
        ? ""
        : `, ${omitted} internal boundary(ies) dropped by the object grammar`),
    data: {
      objectCount: geometry.objects.length,
      contourCount: contours,
      internalBoundaryCount: boundaries,
      styleZoneCount: zones,
      // What the object grammar of the style dropped across the scene, the
      // sum of the per-object counts below (specification section 9B).
      omittedInternalBoundaries: omitted,
      objects: geometry.objects.map(
        ({ placement, geometry: placed, grammarDetail }) => ({
          id: placement.object.id,
          kind: placement.object.kind,
          depthIndex: placement.depthIndex,
          contours: placed.contours.length,
          internalBoundaries: placed.internalBoundaries.length,
          // What the grammar of the style did to this object's marks
          // (section 9B): emitted, kept, dropped, and the budget that
          // drew the line.
          ...(grammarDetail === undefined
            ? {}
            : {
                emittedInternalBoundaries:
                  grammarDetail.emittedInternalBoundaries,
                keptInternalBoundaries: grammarDetail.keptInternalBoundaries,
                droppedInternalBoundaries:
                  grammarDetail.droppedInternalBoundaries,
                detailBudget: grammarDetail.detailBudget,
              }),
          styleZones: placed.styleZones.length,
        }),
      ),
    },
  };
}

/** The trace event of the style stage (specification section 9D). */
function styleEvent(scene: StyledScene, style: ResolvedStyleSpec): TraceEvent {
  return {
    stage: "style",
    name: "style applied",
    message:
      `preset "${style.preset}" filled ${scene.regions.length} region(s): ` +
      `${scene.contours.length} contour stroke(s), ${scene.masks.length} cutout(s)`,
    data: {
      preset: style.preset,
      regionCount: scene.regions.length,
      contourCount: scene.contours.length,
      maskCount: scene.masks.length,
      regions: scene.regions.map((region, index) => ({
        id: region.id,
        role: scene.fills[index]?.role ?? region.role ?? "",
        family: scene.fills[index]?.family ?? "none",
        zIndex: region.zIndex,
        fill: region.fillStyle,
      })),
    },
  };
}

/**
 * The trace event of the render stage (specification sections 9D and 9E).
 *
 * The `durationMs` of the event is the export timing of the metrics: the
 * wall-clock time the one stage ran for. Everything in `data` is a compile
 * fact, so two renders of one identity produce identical event data.
 */
function renderEvent(metrics: OutputMetrics): TraceEvent {
  return {
    stage: "render",
    name: "svg rendered",
    message:
      `${metrics.svgSizeBytes} byte(s) of SVG drawing ` +
      `${metrics.strokeCount} stroke(s) in ${metrics.regionCount} region(s)`,
    durationMs: metrics.exportDurationMs,
    data: {
      svgSizeBytes: metrics.svgSizeBytes,
      strokeCount: metrics.strokeCount,
      regionCount: metrics.regionCount,
      visualDensityScore: metrics.visualDensityScore,
    },
  };
}

/**
 * The hatch engine facade (specification section 21).
 *
 * ```ts
 * const engine = new HatchEngine({
 *   styles: [{ id: "pastoral-v1", style: pastoralV1 }],
 *   objects: { generateObject: generateSceneObject },
 *   renderer: { render: renderSvgDocument },
 *   zoneFamilies: V1_ZONE_FAMILIES,
 * });
 * const result = engine.renderScene(spec);
 * ```
 *
 * The structured entry of specification section 21 is {@link renderScene}.
 * The edit entry of the same section is {@link editScene}, which the
 * operations of `@hatch/agent` back through the injected edit source. The
 * high-level prompt entry arrives with the round that owns it.
 */
export class HatchEngine {
  private readonly presets: StylePresetSource;
  private readonly objects: ObjectGeometrySource;
  private readonly renderer: SvgRenderer;
  private readonly zoneFamilies: ZoneFamilyTable;
  private readonly tools: StyleStageTools;
  private readonly edits: SceneEditSource | undefined;

  constructor(options: HatchEngineOptions) {
    this.presets = normalizeStylePresets(options.styles);
    this.objects = options.objects;
    this.renderer = options.renderer;
    this.zoneFamilies = options.zoneFamilies;
    this.tools = options.tools ?? {};
    this.edits = options.edits;
  }

  /** Every registered preset id, in stable alphabetical order. */
  listPresets(): string[] {
    return this.presets.listPresets();
  }

  /** True when `presetId` names a registered preset. */
  hasPreset(presetId: string): boolean {
    return this.presets.listPresets().includes(presetId);
  }

  /**
   * The environment family one registered preset draws, when it declares
   * one. The intent stage checks this against `environment.type`, and the
   * editor reads it to keep that pair valid when the picker moves. Throws
   * one readable error for an unknown id, the way `resolve` does.
   */
  presetEnvironmentType(presetId: string): EnvironmentType | undefined {
    return this.presets.resolve(presetId).environmentType;
  }

  /**
   * Compile one scene spec into SVG.
   *
   * The input parses against the `SceneSpec` schema first, so an invalid
   * spec fails before any stage runs. The result carries the four artifacts
   * of specification section 21 that V1 owns: the SVG document, the parsed
   * spec, the intermediate representation, and the trace.
   *
   * Two calls with the same spec return byte-identical SVG and identical
   * intermediate representations, because every stage draws from a stream
   * derived from the render identity alone (specification section 10). The
   * trace is identical too, with one exception: `exportDurationMs` times
   * the run on the host clock (specification section 9E), so two renders of
   * one identity share every trace byte except that number.
   */
  renderScene(input: unknown): RenderResult {
    const spec = parseSceneSpec(input);
    const identity = renderIdentityOf(spec);

    // Intent: the spec is accepted, the style resolves. The style resolves
    // here because planning reads its composition grammar, and because the
    // preset name belongs to the render identity. The environment family of
    // the spec is checked against the family of that style in the same
    // place, so `environment.type` owns one decision instead of moving the
    // spec hash alone. The intent stage draws nothing: V1 input is
    // structured, so parsing needs no random numbers and the stage records
    // its event without a stream.
    const style = this.presets.resolve(
      spec.meta.stylePreset,
      spec.styleOverrides,
    );
    assertEnvironmentFamily(spec, style, this.presets);
    const events: TraceEvent[] = [intentEvent(spec, style, identity.specHash)];

    // Planning: canvas, horizon, regions, depth order, cloud cutouts.
    const plan = planScene(
      spec,
      style,
      createStageRng(identity, "planning"),
    );
    events.push(planningEvent(plan, spec, style));

    // Geometry synthesis: one placed geometry per object.
    const geometry = synthesizeSceneGeometry(
      plan,
      this.objects,
      createStageRng(identity, "geometry"),
    );
    events.push(geometryEvent(geometry));

    // Style application: families, composed regions, contours.
    const styled = applySceneStyle(
      plan,
      geometry,
      style,
      this.zoneFamilies,
      this.tools,
      createStageRng(identity, "style"),
    );
    events.push(styleEvent(styled, style));

    // The intermediate representation of the render stage. The trace
    // travels inside it; the renderer embeds only its identity block, so
    // the bytes stay the same whatever the events hold.
    const ir: RenderIR = {
      canvas: plan.canvas,
      horizonY: plan.horizonHeights.center,
      // The roll the framing carries, so a construction guide can draw the
      // horizon where the artwork holds it. Absent means a level horizon.
      ...(plan.camera.tiltDegrees === 0
        ? {}
        : { horizonTilt: plan.camera.tiltDegrees }),
      regions: [...styled.regions],
      contours: [...styled.contours],
      symbols: [],
      symbolLibrary: [],
      masks: [...styled.masks],
      anchors: anchorsOfPlan(plan),
      style,
      // The debug block reaches the renderer through the intermediate
      // representation, so the overlays draw beside the artwork they explain.
      ...(spec.debug === undefined ? {} : { debug: spec.debug }),
      trace: {
        specHash: identity.specHash,
        preset: spec.meta.stylePreset,
        seed: spec.meta.seed,
        compilerVersion: COMPILER_VERSION,
        events,
      },
    };
    // Render: the intermediate representation becomes one SVG document.
    // The wall clock times this one stage, because it is the export the
    // metrics of section 9E name: everything before it compiles, this
    // writes the document.
    const exportStartedAt = performance.now();
    const rendered = this.renderer.render(ir, createStageRng(identity, "render"));
    const exportDurationMs = performance.now() - exportStartedAt;

    // The visual density score divides the ink the hatch strokes carry by
    // the paper it covers, so the same scene scores the same on every host.
    const canvasArea = ir.canvas.width * ir.canvas.height;
    const metrics: OutputMetrics = {
      regionCount: ir.regions.length,
      strokeCount: rendered.strokeCount,
      svgSizeBytes: utf8Bytes(rendered.svg),
      exportDurationMs,
      visualDensityScore: canvasArea > 0 ? rendered.strokeLength / canvasArea : 0,
    };
    const trace: RenderTrace = {
      ...ir.trace,
      events: [...events, renderEvent(metrics)],
      metrics,
    };

    return {
      svg: rendered.svg,
      sceneSpec: spec,
      ir: { ...ir, trace },
      trace,
    };
  }

  /**
   * Apply the edit operations of specification section 21 to one scene
   * spec and return the updated spec.
   *
   * ```ts
   * const updated = engine.editScene(spec, [
   *   { op: "moveObject", id: "tree-1", dx: -0.1, dy: 0 },
   *   { op: "setStyle", path: "hatchFamilies.sky.spacing", value: 8 },
   * ]);
   * const result = engine.renderScene(updated);
   * ```
   *
   * Edits patch the spec, never the pixels (specification section 15): the
   * operations describe the scene in its structured language, and the
   * caller re-renders the result. The input parses first, so an invalid
   * spec fails before any operation runs; the patched spec parses again
   * before it returns, so every result is a spec {@link renderScene}
   * accepts.
   *
   * The input spec is never mutated, and an operation list that fails
   * midway returns nothing: the caller's spec is the one they passed in.
   */
  editScene(input: unknown, operations: readonly unknown[]): SceneSpec {
    if (this.edits === undefined) {
      throw new Error(
        "this engine accepts no scene edits; build it with the edit " +
          "operations of @hatch/agent, for example createV1Engine()",
      );
    }
    const spec = parseSceneSpec(input);
    const updated = this.edits.applyEdits(spec, operations, {
      resolveStyle: (presetId, overrides) =>
        this.presets.resolve(presetId, overrides),
    });
    return parseSceneSpec(updated);
  }
}
