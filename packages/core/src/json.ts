/**
 * JSON value schemas shared across the scene, style, and trace models.
 *
 * Scene objects carry free-form semantic parameters (specification section 5)
 * and trace events carry free-form payloads (specification section 9), so the
 * core model needs one recursive JSON value definition.
 */

import { z } from "zod";

/** Any value that survives JSON serialization. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Schema for {@link JsonValue}. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** A JSON object with string keys. */
export type JsonObject = { [key: string]: JsonValue };

/** Schema for {@link JsonObject}. */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
