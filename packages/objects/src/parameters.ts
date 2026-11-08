/**
 * Semantic parameter spaces (specification section 6).
 *
 * Specification section 6 gives every object type semantic parameters: roof
 * pitch and window count for a house, canopy size and trunk bend for a tree.
 * Each generator states them twice:
 *
 * - one typed Zod schema, which validates the `params` block of a scene
 *   object, and
 * - one parameter space, a plain table of the range and the default of
 *   every knob.
 *
 * The space is the readable reference of each knob and it drives the seeded
 * parameter sweep of the test suite. One probe test per generator proves
 * the two agree: a value outside the table fails the schema, and both
 * boundaries of the table pass it.
 */

import { z } from "zod";

import { formatIssues, JsonObjectSchema, type JsonObject } from "@hatch/core";

/** One continuous parameter with its range and its default. */
export interface NumberSpaceField {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** One count parameter with its range and its default. */
export interface IntegerSpaceField {
  readonly kind: "integer";
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** One on or off parameter with its default. */
export interface BooleanSpaceField {
  readonly kind: "boolean";
  readonly default: boolean;
}

/** One field of a parameter space. */
export type ParameterSpaceField =
  | NumberSpaceField
  | IntegerSpaceField
  | BooleanSpaceField;

/** The parameter space of one generator: field name to field description. */
export type ParameterSpace = Readonly<Record<string, ParameterSpaceField>>;

/** Reject a malformed numeric field declaration at module load. */
function checkRange(
  kind: "number" | "integer",
  min: number,
  max: number,
  fallback: number,
): void {
  const integer = kind === "integer";
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    (integer && (!Number.isInteger(min) || !Number.isInteger(max)))
  ) {
    throw new Error(
      `a ${kind} parameter range needs ${integer ? "integer" : "finite"} ` +
        `bounds, received ${min} to ${max}`,
    );
  }
  if (min >= max) {
    throw new Error(
      `a parameter range needs min below max, received ${min} to ${max}`,
    );
  }
  if (
    !Number.isFinite(fallback) ||
    fallback < min ||
    fallback > max ||
    (integer && !Number.isInteger(fallback))
  ) {
    throw new Error(
      `a parameter default must sit inside its range, received ${fallback} ` +
        `outside ${min} to ${max}`,
    );
  }
}

/** Declare one continuous parameter. */
export function numberField(
  min: number,
  max: number,
  fallback: number,
): NumberSpaceField {
  checkRange("number", min, max, fallback);
  return { kind: "number", min, max, default: fallback };
}

/** Declare one count parameter. */
export function integerField(
  min: number,
  max: number,
  fallback: number,
): IntegerSpaceField {
  checkRange("integer", min, max, fallback);
  return { kind: "integer", min, max, default: fallback };
}

/** Declare one on or off parameter. */
export function booleanField(fallback: boolean): BooleanSpaceField {
  return { kind: "boolean", default: fallback };
}

/** The default parameter object of one space. */
export function spaceDefaults(space: ParameterSpace): JsonObject {
  const defaults: JsonObject = {};
  for (const [name, field] of Object.entries(space)) {
    defaults[name] = field.default;
  }
  return defaults;
}

/**
 * Read the raw `params` block of a scene object as a JSON object.
 *
 * A missing block reads as an empty object, so a scene object without
 * parameters falls back to every default. Any other shape throws one
 * readable error.
 */
export function paramsRecord(kind: string, raw: unknown): JsonObject {
  if (raw === undefined) {
    return {};
  }
  const parsed = JsonObjectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `the ${kind} generator needs its params as a JSON object, ` +
        `received ${typeof raw}`,
    );
  }
  return parsed.data;
}

/**
 * Parse the parameters of one generator: its defaults merged with the raw
 * scene params, then validated against the schema.
 *
 * A field the scene does not state keeps its default. A field outside its
 * range throws one readable error that names it. Unknown fields are
 * dropped, so a caller may pass hints this version does not know.
 */
export function parseParametersWith<T>(
  kind: string,
  schema: z.ZodType<T>,
  space: ParameterSpace,
  raw: unknown,
): T {
  const merged = { ...spaceDefaults(space), ...paramsRecord(kind, raw) };
  const result = schema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `invalid ${kind} parameters: ${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}
