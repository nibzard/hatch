/**
 * Regions: the foundational render primitive (specification sections 7
 * and 16).
 *
 * Every scene is built as a stack of paper background, sky region, cloud
 * masks, terrain regions, object regions, and accent contours. Each region
 * carries its own fill style and draw order.
 */

import { z } from "zod";

import { FillStyleSchema } from "./fill.js";
import { PathSchema } from "./path.js";

/**
 * A drawable area filled with a line system.
 *
 * `role` names the region role from specification section 16C, for example
 * "sky", "field", "foliage", or "cloud-hole". It is a free string so plugin
 * objects can register new roles without a core change.
 */
export const RegionSchema = z.object({
  id: z.string().min(1, { message: "a region needs an id" }),
  role: z.string().min(1).optional(),
  path: PathSchema,
  fillStyle: FillStyleSchema,
  clip: PathSchema.optional(),
  zIndex: z.number().int({ message: "zIndex must be an integer" }),
});

export type Region = z.infer<typeof RegionSchema>;

/**
 * Regions in draw order: ascending `zIndex`, input order between equals.
 *
 * The renderer stacks its region layer this way, and every debug overlay that
 * walks regions must walk them the same way, or the overlay names a region
 * where the reader sees another one. The rule lives here so both read one
 * implementation.
 */
export function regionsInDrawOrder(regions: readonly Region[]): Region[] {
  return [...regions].sort((left, right) => left.zIndex - right.zIndex);
}
