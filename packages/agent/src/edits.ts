/**
 * Scene edit operations (specification sections 15 and 21).
 *
 * The primary editing object is the scene spec, never the pixels
 * (specification section 15): an edit states its change in the structured
 * language of the scene, and the caller re-renders the result. Every
 * operation here is one pure spec-to-spec function. It never mutates its
 * input, it re-validates what it writes, and it throws one readable error
 * that names the operation when an edit cannot apply.
 *
 * The five operations of specification section 21:
 *
 * - `moveObject` shifts one object by `dx` and `dy`, in the normalized
 *   [0, 1] scene space the spec's positions use.
 * - `setStyle` writes one value into the style grammar, addressed by a
 *   dotted path such as `hatchFamilies.sky.spacing`.
 * - `replaceObject` swaps one object for another kind. Fields the patch
 *   leaves out keep the placement of the object they replace.
 * - `addObject` appends one object under an id the scene does not use yet.
 * - `removeObject` drops one object and the focal-point references to it.
 *
 * `@hatch/core` cannot import this package, because this package depends
 * on it, so the engine receives these operations through the
 * `SceneEditSource` interface and the composition root of
 * `@hatch/renderer-svg` binds {@link sceneEditSource} into `createV1Engine`.
 */

import { z } from "zod";

import {
  canonicalJson,
  formatIssues,
  JsonValueSchema,
  SceneObjectSchema,
  parseSceneSpec,
  type JsonValue,
  type ResolvedStyleSpec,
  type SceneEditContext,
  type SceneEditSource,
  type SceneObject,
  type SceneSpec,
  type StyleOverrides,
  type StyleSpec,
} from "@hatch/core";

/** Move one object by a delta in normalized scene space. */
export const MoveObjectEditSchema = z.object({
  op: z.literal("moveObject"),
  id: z.string().min(1, { message: "moveObject needs an object id" }),
  dx: z.number().finite({ message: "moveObject dx must be a finite number" }),
  dy: z.number().finite({ message: "moveObject dy must be a finite number" }),
});

/**
 * Write one value into the style grammar.
 *
 * The path is dotted and addresses one field of the style preset, for
 * example `hatchFamilies.sky.spacing` or `contours.weight`. Section paths
 * of the grammar may address a whole section, for example `palette`.
 */
export const SetStyleEditSchema = z.object({
  op: z.literal("setStyle"),
  path: z.string().min(1, { message: "setStyle needs a dotted style path" }),
  value: JsonValueSchema,
});

/**
 * The fields a replacement object carries. Every field is optional except
 * the `kind`: the fields a patch leaves out keep their value from the
 * object the patch replaces, so `{ kind: "quarter-pipe" }` swaps the
 * generator and keeps the id, the position, and the scale.
 */
export const ObjectPatchSchema = SceneObjectSchema.omit({ id: true })
  .partial()
  .extend({
    kind: z
      .string()
      .min(1, { message: "a replacement object needs a kind" }),
    id: z.string().min(1).optional(),
  });

/** Replace one object with a patch that states its new kind. */
export const ReplaceObjectEditSchema = z.object({
  op: z.literal("replaceObject"),
  id: z.string().min(1, { message: "replaceObject needs an object id" }),
  with: ObjectPatchSchema,
});

/** Append one complete object to the scene. */
export const AddObjectEditSchema = z.object({
  op: z.literal("addObject"),
  object: SceneObjectSchema,
});

/** Drop one object from the scene. */
export const RemoveObjectEditSchema = z.object({
  op: z.literal("removeObject"),
  id: z.string().min(1, { message: "removeObject needs an object id" }),
});

/** Every edit operation of specification section 21, keyed by `op`. */
export const SceneEditOperationSchema = z.discriminatedUnion("op", [
  MoveObjectEditSchema,
  SetStyleEditSchema,
  ReplaceObjectEditSchema,
  AddObjectEditSchema,
  RemoveObjectEditSchema,
]);

/** One edit operation, validated. */
export type SceneEditOperation = z.infer<typeof SceneEditOperationSchema>;

/** The patch a `replaceObject` operation carries under `with`. */
export type ObjectPatch = z.infer<typeof ObjectPatchSchema>;

/** The `moveObject` operation. */
export type MoveObjectEdit = z.infer<typeof MoveObjectEditSchema>;
/** The `setStyle` operation. */
export type SetStyleEdit = z.infer<typeof SetStyleEditSchema>;
/** The `replaceObject` operation. */
export type ReplaceObjectEdit = z.infer<typeof ReplaceObjectEditSchema>;
/** The `addObject` operation. */
export type AddObjectEdit = z.infer<typeof AddObjectEditSchema>;
/** The `removeObject` operation. */
export type RemoveObjectEdit = z.infer<typeof RemoveObjectEditSchema>;

/**
 * Parse one unknown input as an edit operation. Throw one readable error
 * on failure. Use this at every entry point that accepts operations.
 */
export function parseSceneEditOperation(input: unknown): SceneEditOperation {
  const result = SceneEditOperationSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `invalid edit operation: ${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

/** The object an edit addresses, or one readable error that names the ids. */
function requireObject(spec: SceneSpec, id: string, op: string): SceneObject {
  const target = spec.objects.find((object) => object.id === id);
  if (target === undefined) {
    throw new Error(
      `${op}: no object carries the id "${id}" in scene ` +
        `"${spec.meta.id}"; object ids: ` +
        (spec.objects.length === 0
          ? "(none)"
          : spec.objects.map((object) => object.id).join(", ")),
    );
  }
  return target;
}

/** One scene object from free input, or one readable error that names it. */
function parseSceneObject(input: unknown, op: string): SceneObject {
  const result = SceneObjectSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`${op}: ${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

/**
 * The fields a record states, without the keys that hold `undefined`.
 *
 * A spread of `{ ...object, ...patch }` must not overwrite a stated field
 * of the object with an absent field of the patch.
 */
function definedFields(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const stated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      stated[key] = value;
    }
  }
  return stated;
}

/**
 * `moveObject`: shift one object's position by `dx` and `dy`.
 *
 * Position is normalized scene space, so a delta of 0.1 moves the object a
 * tenth of the canvas. The planner clamps the result onto the canvas at
 * render time, so a move past the edge stays a valid spec.
 */
function applyMoveObject(spec: SceneSpec, operation: MoveObjectEdit): SceneSpec {
  requireObject(spec, operation.id, "moveObject");
  return {
    ...spec,
    objects: spec.objects.map((object) =>
      object.id === operation.id
        ? {
            ...object,
            position: {
              x: object.position.x + operation.dx,
              y: object.position.y + operation.dy,
            },
          }
        : object,
    ),
  };
}

/** The style grammar of one resolved style: the resolved style minus `preset`. */
function styleGrammarOf(style: ResolvedStyleSpec): StyleSpec {
  const { preset: _preset, ...grammar } = style;
  return grammar;
}

/** Split one dotted style path into its segments. */
function stylePathSegments(path: string): string[] {
  const segments = path.split(".").map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(
      `setStyle: the path "${path}" is empty or holds an empty segment`,
    );
  }
  return segments;
}

/**
 * Read one dotted path out of the style grammar.
 *
 * Every segment must name a field of the object it walks into, so a path
 * the grammar does not define fails here instead of writing a no-op. Array
 * elements are not addressable; set the array itself, for example
 * `compositionGrammar.preferredHorizonBand`.
 */
function readStylePath(grammar: StyleSpec, segments: readonly string[]): unknown {
  let node: unknown = grammar;
  for (const segment of segments) {
    if (
      node === null ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      !(segment in node)
    ) {
      throw new Error(
        `setStyle: the path "${segments.join(".")}" names no field of the ` +
          `style grammar; segment "${segment}" does not resolve`,
      );
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Write one value at a dotted path and return the copied grammar.
 *
 * The nodes along the path are copied, never mutated, so the style the
 * engine resolved stays the engine's own.
 */
function writeStylePath(
  node: Record<string, unknown>,
  segments: readonly string[],
  value: JsonValue,
): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (head === undefined) {
    throw new Error("setStyle: the path cannot be empty");
  }
  if (rest.length === 0) {
    return { ...node, [head]: value };
  }
  const child = node[head];
  if (child === null || typeof child !== "object" || Array.isArray(child)) {
    throw new Error(
      `setStyle: the path "${segments.join(".")}" walks into the value at ` +
        `"${head}", which is not a section`,
    );
  }
  return {
    ...node,
    [head]: writeStylePath(child as Record<string, unknown>, rest, value),
  };
}

/**
 * Resolve one style under one override set, or throw with the `setStyle`
 * prefix, so a value the grammar refuses names the operation that sent it.
 */
function resolveForSetStyle(
  context: SceneEditContext,
  presetId: string,
  overrides?: StyleOverrides,
): ResolvedStyleSpec {
  try {
    return context.resolveStyle(presetId, overrides);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `setStyle: the patched style does not resolve under preset ` +
        `"${presetId}": ${reason}`,
    );
  }
}

/**
 * `setStyle`: write one value into the style grammar of the spec's preset.
 *
 * The write lands in `styleOverrides`, the one style input a scene spec
 * owns. `StyleOverridesSchema` accepts whole sections only, so the
 * operation writes the complete section it touched: the resolved preset
 * values with the one field changed. A second `setStyle` on the same
 * section composes, because the resolved style it starts from already
 * carries the first override.
 *
 * The patched overrides resolve again before the edit returns. That parse
 * rejects a value of the wrong type, and the resolved value is read back
 * and compared, so a path or value the grammar drops cannot apply as a
 * silent no-op.
 */
function applySetStyle(
  spec: SceneSpec,
  operation: SetStyleEdit,
  context: SceneEditContext,
): SceneSpec {
  const segments = stylePathSegments(operation.path);
  const grammar = styleGrammarOf(
    resolveForSetStyle(context, spec.meta.stylePreset, spec.styleOverrides),
  );
  readStylePath(grammar, segments);

  const section = segments[0]!;
  const patched = writeStylePath(
    grammar as unknown as Record<string, unknown>,
    segments,
    operation.value,
  );
  const overrides: StyleOverrides = {
    ...spec.styleOverrides,
    [section]: patched[section],
  };

  const resolved = styleGrammarOf(
    resolveForSetStyle(context, spec.meta.stylePreset, overrides),
  );
  const applied = readStylePath(resolved, segments) as JsonValue;
  if (canonicalJson(applied) !== canonicalJson(operation.value)) {
    throw new Error(
      `setStyle: the preset did not keep "${operation.path}" as written; ` +
        `resolved ${canonicalJson(applied)}, asked for ` +
        `${canonicalJson(operation.value)}`,
    );
  }

  return { ...spec, styleOverrides: overrides };
}

/**
 * `replaceObject`: swap one object for the patch under `with`.
 *
 * The patch states at least the new `kind`. Every field it leaves out
 * keeps its value from the replaced object, so a plain kind swap keeps the
 * id, the position, the scale, and the parameters. A patch that carries
 * its own `id` renames the object and the focal points that name it.
 */
function applyReplaceObject(
  spec: SceneSpec,
  operation: ReplaceObjectEdit,
): SceneSpec {
  const target = requireObject(spec, operation.id, "replaceObject");
  const patch = definedFields(operation.with);
  const replacement = parseSceneObject(
    { ...definedFields(target), ...patch },
    "replaceObject",
  );

  if (
    replacement.id !== target.id &&
    spec.objects.some((object) => object.id === replacement.id)
  ) {
    throw new Error(
      `replaceObject: the new id "${replacement.id}" already names ` +
        `another object of scene "${spec.meta.id}"`,
    );
  }

  return {
    ...spec,
    objects: spec.objects.map((object) =>
      object.id === target.id ? replacement : object,
    ),
    composition:
      replacement.id === target.id
        ? spec.composition
        : {
            ...spec.composition,
            focalPoints: spec.composition.focalPoints.map((id) =>
              id === target.id ? replacement.id : id,
            ),
          },
  };
}

/** `addObject`: append one complete object under an id the scene does not use. */
function applyAddObject(spec: SceneSpec, operation: AddObjectEdit): SceneSpec {
  if (spec.objects.some((object) => object.id === operation.object.id)) {
    throw new Error(
      `addObject: the id "${operation.object.id}" already names an object ` +
        `of scene "${spec.meta.id}"`,
    );
  }
  return { ...spec, objects: [...spec.objects, operation.object] };
}

/**
 * `removeObject`: drop one object and the focal points that name it.
 *
 * A focal point that names a dropped object would dangle in the spec, so
 * the edit prunes those references in the same patch.
 */
function applyRemoveObject(
  spec: SceneSpec,
  operation: RemoveObjectEdit,
): SceneSpec {
  requireObject(spec, operation.id, "removeObject");
  return {
    ...spec,
    objects: spec.objects.filter((object) => object.id !== operation.id),
    composition: {
      ...spec.composition,
      focalPoints: spec.composition.focalPoints.filter(
        (id) => id !== operation.id,
      ),
    },
  };
}

/**
 * Apply one edit operation to one scene spec (specification section 21).
 *
 * The input spec is never mutated. Each operation validates what it
 * writes, so the returned spec parses against the `SceneSpec` schema.
 */
export function applySceneEdit(
  spec: SceneSpec,
  operation: SceneEditOperation,
  context: SceneEditContext,
): SceneSpec {
  switch (operation.op) {
    case "moveObject":
      return applyMoveObject(spec, operation);
    case "setStyle":
      return applySetStyle(spec, operation, context);
    case "replaceObject":
      return applyReplaceObject(spec, operation);
    case "addObject":
      return applyAddObject(spec, operation);
    case "removeObject":
      return applyRemoveObject(spec, operation);
  }
}

/**
 * Apply a list of edit operations, in order, to one scene spec
 * (specification sections 15 and 21).
 *
 * Every operation parses before the first one applies, so a malformed
 * operation list fails without running partway. The folded result parses
 * against the `SceneSpec` schema before it returns, so the caller hands a
 * valid spec to `renderScene`.
 */
export function applySceneEdits(
  spec: SceneSpec,
  operations: readonly unknown[],
  context: SceneEditContext,
): SceneSpec {
  const parsed = operations.map((operation, index) => {
    const result = SceneEditOperationSchema.safeParse(operation);
    if (!result.success) {
      throw new Error(
        `edit operations[${index}]: ${formatIssues(result.error.issues)}`,
      );
    }
    return result.data;
  });

  let current = spec;
  for (const operation of parsed) {
    current = applySceneEdit(current, operation, context);
  }
  return parseSceneSpec(current);
}

/**
 * The edit operations of `@hatch/agent` as one {@link SceneEditSource} for
 * the engine facade. `createV1Engine` of `@hatch/renderer-svg` wires this
 * source into `HatchEngine`, which is what makes `engine.editScene` work.
 */
export const sceneEditSource: SceneEditSource = {
  applyEdits: (spec, operations, context) =>
    applySceneEdits(spec, operations, context),
};
