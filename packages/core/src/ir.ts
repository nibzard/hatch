/**
 * The style-aware intermediate representation (specification section 22).
 *
 * The RenderIR sits between the spec and the SVG. It is what makes the
 * compiler inspectable and extensible: every stage reads and writes plain
 * data that a test, a debugger overlay, or an agent can walk.
 */

import { z } from "zod";

import { PathSchema, PointSchema } from "./path.js";
import { RegionSchema } from "./region.js";
import { DebugFlagsSchema, SceneObjectRoleSchema } from "./scene.js";
import { ResolvedStyleSpecSchema } from "./style.js";
import { RenderTraceSchema } from "./trace.js";

/** Output canvas in SVG user units. */
export const CanvasSchema = z.object({
  width: z
    .number()
    .finite()
    .positive({ message: "canvas width must be greater than 0" }),
  height: z
    .number()
    .finite()
    .positive({ message: "canvas height must be greater than 0" }),
});

/**
 * One contour or accent stroke, drawn on top of the region stack
 * (specification sections 7 and 16D).
 */
export const ContourStrokeSchema = z.object({
  path: PathSchema,
  weight: z
    .number()
    .finite()
    .positive({ message: "contour weight must be greater than 0" }),
  color: z.string().min(1, { message: "color must be a CSS color name or hex value" }),
  role: z.enum(["contour", "accent", "construction"]).optional(),
  /**
   * The `id` of the scene object whose line this stroke draws. Scene-level
   * lines, for example the ground strips of the environment, carry none.
   */
  objectId: z.string().min(1).optional(),
});

/** One placement of a reusable symbol mark, for example a bird or grass tuft. */
export const SymbolPlacementSchema = z.object({
  symbolId: z.string().min(1, { message: "a symbol placement needs a symbolId" }),
  position: PointSchema,
  scale: z
    .number()
    .finite()
    .positive({ message: "scale must be greater than 0" }),
  rotation: z.number().finite().optional(),
});

/** One stroke of a symbol mark, drawn in the mark's local units. */
export const SymbolStrokeSchema = z.object({
  path: PathSchema,
  weight: z
    .number()
    .finite()
    .positive({ message: "symbol stroke weight must be greater than 0" }),
  color: z.string().min(1, { message: "color must be a CSS color name or hex value" }),
});

/**
 * One reusable symbol mark: its `id` is the `symbolId` a placement names.
 *
 * The strokes live in the mark's own local units around its origin, so a
 * placement's transform alone decides where and how large the mark draws. An
 * empty mark would render nothing, so it carries at least one stroke.
 */
export const SymbolDefinitionSchema = z.object({
  id: z.string().min(1, { message: "a symbol definition needs an id" }),
  strokes: z
    .array(SymbolStrokeSchema)
    .min(1, { message: "a symbol definition needs at least one stroke" }),
});

/**
 * One mask path. With `invert` true the mask erases strokes inside its path,
 * which carves negative space out of a hatched region. That is how cloud
 * cutouts work (specification sections 7 and 24).
 */
export const MaskSchema = z.object({
  id: z.string().min(1, { message: "a mask needs an id" }),
  path: PathSchema,
  invert: z.boolean().default(true),
});

/**
 * Where one placed object landed: its anchor in scene units and its place in
 * the depth order (specification sections 5 and 9).
 *
 * The style zones of an object carry no position of their own, and neither
 * do its contours, so the render stage needs this record to draw an object
 * anchor or a construction guide at the point the spec positioned.
 */
export const ObjectAnchorSchema = z.object({
  /** The `id` of the scene object this anchor places. */
  objectId: z.string().min(1, { message: "an anchor needs the object id" }),
  /** The `kind` of the scene object, for example "tree". */
  kind: z.string().min(1, { message: "an anchor needs the object kind" }),
  role: SceneObjectRoleSchema.optional(),
  /** Where the local origin of the object landed, in scene units. */
  position: PointSchema,
  /**
   * The scale the object drew at, which sizes the anchor marker: the scale
   * of the spec under the framing, the depth plane, and the focal emphasis
   * the camera applied.
   */
  scale: z
    .number()
    .finite()
    .positive({ message: "anchor scale must be greater than 0" }),
  /** The draw depth of the object role; a higher value draws in front. */
  depth: z.number().finite(),
  /** The index of the object in depth order, 0 for the furthest back. */
  depthIndex: z.number().int().min(0),
  /** True when a position outside the canvas was clamped onto it. */
  positionClamped: z.boolean(),
});

/** The intermediate representation one render produces (section 22). */
export const RenderIRSchema = z
  .object({
    canvas: CanvasSchema,
    /**
     * The horizon line, in scene units from the top edge. The value is the
     * height the horizon holds at the center column, which is also where it
     * sits when the framing is level.
     */
    horizonY: z
      .number()
      .finite()
      .min(0, { message: "horizonY is a height from the top edge" })
      .optional(),
    /**
     * The camera roll of the framing, in degrees. A rolled horizon slopes
     * away from `horizonY`, so a construction guide draws it through the
     * center height at this angle. Absent means a level horizon.
     */
    horizonTilt: z.number().finite().optional(),
    regions: z.array(RegionSchema),
    contours: z.array(ContourStrokeSchema),
    symbols: z.array(SymbolPlacementSchema),
    symbolLibrary: z.array(SymbolDefinitionSchema).default([]),
    masks: z.array(MaskSchema),
    /** Where every scene object landed, in depth order. */
    anchors: z.array(ObjectAnchorSchema).default([]),
    style: ResolvedStyleSpecSchema,
    /**
     * The debug block of the spec, which picks the overlays a render draws
     * (specification sections 5 and 9). Absent means no overlay at all.
     */
    debug: DebugFlagsSchema.optional(),
    trace: RenderTraceSchema,
  })
  .superRefine((ir, ctx) => {
    // The library is the one definition source: two entries that share an
    // id leave every reference to that id ambiguous, so the schema rejects
    // the library instead of picking one entry.
    const seen = new Set<string>();
    ir.symbolLibrary.forEach((definition, index) => {
      if (seen.has(definition.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["symbolLibrary", index, "id"],
          message: `two symbol definitions share the id "${definition.id}"`,
        });
      }
      seen.add(definition.id);
    });
    // Every placement must resolve to a defined mark. Without this check a
    // scene that carries symbols silently loses them, because a `use`
    // element that names no definition draws nothing.
    ir.symbols.forEach((placement, index) => {
      if (!seen.has(placement.symbolId)) {
        ctx.addIssue({
          code: "custom",
          path: ["symbols", index, "symbolId"],
          message:
            `no symbol definition owns the id "${placement.symbolId}"; ` +
            `add one to symbolLibrary or drop the placement`,
        });
      }
    });
  });

export type Canvas = z.infer<typeof CanvasSchema>;
export type ContourStroke = z.infer<typeof ContourStrokeSchema>;
export type SymbolPlacement = z.infer<typeof SymbolPlacementSchema>;
export type SymbolStroke = z.infer<typeof SymbolStrokeSchema>;
export type SymbolDefinition = z.infer<typeof SymbolDefinitionSchema>;
export type Mask = z.infer<typeof MaskSchema>;
export type ObjectAnchor = z.infer<typeof ObjectAnchorSchema>;
export type RenderIR = z.infer<typeof RenderIRSchema>;
