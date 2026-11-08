/**
 * Object geometry output (specification sections 6 and 11).
 *
 * Object generators never emit SVG directly. They emit a Geometry: a
 * silhouette, contour lines, internal boundaries, and style zones. The style
 * application stage turns style zones into filled regions.
 */

import { z } from "zod";

import { PathSchema } from "./path.js";

/**
 * One area of an object that a hatch family fills. `role` names the region
 * role from specification section 16C, for example "foliage" or "rock".
 */
export const StyleZoneSchema = z.object({
  role: z
    .string()
    .min(1, { message: "a style zone needs a role, for example 'foliage'" }),
  path: PathSchema,
  zIndex: z.number().int().optional(),
});

/** What one object generator returns (specification section 6). */
export const GeometrySchema = z.object({
  silhouette: PathSchema,
  contours: z.array(PathSchema),
  internalBoundaries: z.array(PathSchema),
  styleZones: z.array(StyleZoneSchema),
});

export type StyleZone = z.infer<typeof StyleZoneSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
