/**
 * Scene spec diffing (specification sections 9, 15, and 24 V3).
 *
 * The edit model patches the spec, never the pixels (specification section
 * 15), so the question after every edit or replan is semantic: what changed
 * in the scene the spec describes? {@link diffSceneSpecs} answers it. Two
 * specs enter, one list of semantic changes leaves.
 *
 * The diff works at the level of meaning, not of bytes:
 *
 * - Objects are compared by id, so a moved object reads as one `moved`
 *   change instead of a text diff across the object list.
 * - Free-form blocks (`environment.sky`, `environment.ground`,
 *   `environment.atmosphere`, `styleOverrides`) are walked key by key, so
 *   one changed value reads as one change with the old and the new value.
 * - The `debug` block is a view switch, not scene content, so the diff
 *   ignores it - the same decision the spec hash makes. Two specs that
 *   differ only in their overlay flags describe the same scene.
 *
 * Every change is plain data: the section it belongs to, what happened, a
 * dotted path, the values on both sides, and one sentence a reader or an
 * agent can act on. {@link formatSceneDiff} renders the list as text. The
 * diff is deterministic: the same pair of specs always produces the same
 * changes in the same order.
 */

import { z } from "zod";

import {
  canonicalJson,
  JsonValueSchema,
  parseSceneSpec,
  sceneSpecHash,
  type JsonValue,
  type SceneObject,
  type SceneSpec,
} from "@hatch/core";

/**
 * The sections a change can belong to, in the order the diff reports them.
 */
export const SCENE_DIFF_SECTIONS = [
  "meta",
  "camera",
  "composition",
  "environment",
  "objects",
  "style",
] as const;

/** One section of the scene a change belongs to. */
export type SceneDiffSection = (typeof SCENE_DIFF_SECTIONS)[number];

/** What happened to one piece of the scene. */
export const SceneDiffChangeKindSchema = z.enum(["added", "removed", "changed"]);

/** One semantic change between two scene specs. */
export const SceneDiffChangeSchema = z.object({
  /** The section of the scene the change belongs to. */
  section: z.enum(SCENE_DIFF_SECTIONS),
  /** What happened: the value was added, removed, or changed. */
  kind: SceneDiffChangeKindSchema,
  /** Where: one dotted path, for example `objects.tree-1.position`. */
  path: z.string().min(1, { message: "a diff change needs a path" }),
  /** The value before the change, when one existed. */
  before: JsonValueSchema.optional(),
  /** The value after the change, when one exists. */
  after: JsonValueSchema.optional(),
  /** One sentence that states the change without repeating the path. */
  description: z.string().min(1, {
    message: "a diff change needs a description",
  }),
});

/** The diff of two scene specs. */
export const SceneDiffSchema = z.object({
  /** The spec hash of the `before` scene. */
  beforeHash: z.string().min(1),
  /** The spec hash of the `after` scene. */
  afterHash: z.string().min(1),
  /** True when the two specs describe the same scene. */
  equal: z.boolean(),
  /** Every semantic change, in section order. */
  changes: z.array(SceneDiffChangeSchema),
  /** One line that states how many changes and where they sit. */
  summary: z.string().min(1),
});

/** What happened to one piece of the scene. */
export type SceneDiffChangeKind = z.infer<typeof SceneDiffChangeKindSchema>;

/** One semantic change between two scene specs. */
export type SceneDiffChange = z.infer<typeof SceneDiffChangeSchema>;

/** The diff of two scene specs. */
export type SceneDiff = z.infer<typeof SceneDiffSchema>;

/** How many characters a value contributes to a description. */
const DESCRIPTION_VALUE_LIMIT = 60;

/** The ellipsis that marks a value cut short in a description. */
const ELLIPSIS = "…";

/**
 * One JSON value in its shortest readable form.
 *
 * Strings keep their quotes, because an id and a number must not read the
 * same. Values longer than the description limit are cut short; the full
 * value always travels in `before` and `after`.
 */
function describeValue(value: JsonValue): string {
  const text = typeof value === "string" ? JSON.stringify(value) : canonicalJson(value);
  return text.length > DESCRIPTION_VALUE_LIMIT
    ? `${text.slice(0, DESCRIPTION_VALUE_LIMIT - ELLIPSIS.length)}${ELLIPSIS}`
    : text;
}

/** One change record, with a value only on the side that carried it. */
function change(
  section: SceneDiffSection,
  kind: SceneDiffChangeKind,
  path: string,
  description: string,
  before?: JsonValue,
  after?: JsonValue,
): SceneDiffChange {
  return {
    section,
    kind,
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    description,
  };
}

/**
 * Diff one field that exists on at most one side, or differs between them.
 *
 * A field both specs leave out is no change. A field one spec adds or drops
 * is an `added` or `removed` change, so an optional control that appears or
 * disappears reads as its own change, not as a value change against
 * `undefined`.
 */
function diffField(
  section: SceneDiffSection,
  path: string,
  label: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  changes: SceneDiffChange[],
): void {
  if (before === undefined && after !== undefined) {
    changes.push(
      change(section, "added", path, `${label} added: ${describeValue(after)}`, undefined, after),
    );
    return;
  }
  if (after === undefined && before !== undefined) {
    changes.push(
      change(section, "removed", path, `${label} removed (was ${describeValue(before)})`, before),
    );
    return;
  }
  if (before === undefined || after === undefined) {
    return;
  }
  if (canonicalJson(before) !== canonicalJson(after)) {
    changes.push(
      change(
        section,
        "changed",
        path,
        `${label} ${describeValue(before)} → ${describeValue(after)}`,
        before,
        after,
      ),
    );
  }
}

/** True when one JSON value is a plain object, not an array. */
function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk two JSON trees and report every leaf that differs.
 *
 * Plain objects are walked key by key, in sorted key order, so the change
 * list is stable whatever key order the specs arrived in. Every other
 * value - scalars and arrays - is a leaf: two arrays compare as wholes,
 * because their order is part of their meaning. A node that changes shape,
 * object against scalar, is one `changed` leaf.
 */
function diffJsonTree(
  section: SceneDiffSection,
  basePath: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  changes: SceneDiffChange[],
): void {
  if (before === undefined && after === undefined) {
    return;
  }
  if (before === undefined || after === undefined) {
    // Exactly one side carries the subtree, because the case where neither
    // does has returned already.
    const label = basePath.split(".").at(-1) ?? basePath;
    if (after !== undefined) {
      changes.push(
        change(
          section,
          "added",
          basePath,
          `${label} added: ${describeValue(after)}`,
          undefined,
          after,
        ),
      );
    } else if (before !== undefined) {
      changes.push(
        change(
          section,
          "removed",
          basePath,
          `${label} removed (was ${describeValue(before)})`,
          before,
        ),
      );
    }
    return;
  }
  if (canonicalJson(before) === canonicalJson(after)) {
    return;
  }
  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      diffJsonTree(
        section,
        `${basePath}.${key}`,
        before[key],
        after[key],
        changes,
      );
    }
    return;
  }
  const leafLabel = basePath.split(".").at(-1) ?? basePath;
  changes.push(
    change(
      section,
      "changed",
      basePath,
      `${leafLabel} ${describeValue(before)} → ${describeValue(after)}`,
      before,
      after,
    ),
  );
}

/** Diff the meta block: the four identity inputs plus the spec version. */
function diffMeta(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  diffField("meta", "meta.id", "scene id", before.meta.id, after.meta.id, changes);
  diffField("meta", "meta.seed", "seed", before.meta.seed, after.meta.seed, changes);
  diffField(
    "meta",
    "meta.stylePreset",
    "style preset",
    before.meta.stylePreset,
    after.meta.stylePreset,
    changes,
  );
  diffField(
    "meta",
    "meta.aspectRatio",
    "aspect ratio",
    before.meta.aspectRatio,
    after.meta.aspectRatio,
    changes,
  );
  diffField(
    "meta",
    "meta.version",
    "spec version",
    before.meta.version,
    after.meta.version,
    changes,
  );
  return changes;
}

/** Diff the camera block, including the optional tilt and perspective. */
function diffCamera(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  diffField(
    "camera",
    "camera.framing",
    "framing",
    before.camera.framing,
    after.camera.framing,
    changes,
  );
  diffField("camera", "camera.lens", "lens", before.camera.lens, after.camera.lens, changes);
  diffField(
    "camera",
    "camera.horizonY",
    "horizonY",
    before.camera.horizonY,
    after.camera.horizonY,
    changes,
  );
  diffField("camera", "camera.tilt", "tilt", before.camera.tilt, after.camera.tilt, changes);
  diffField(
    "camera",
    "camera.perspectiveStrength",
    "perspective strength",
    before.camera.perspectiveStrength,
    after.camera.perspectiveStrength,
    changes,
  );
  return changes;
}

/** Diff the composition block: balance, negative space, depth, focal points. */
function diffComposition(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  diffField(
    "composition",
    "composition.balance",
    "balance",
    before.composition.balance,
    after.composition.balance,
    changes,
  );
  diffField(
    "composition",
    "composition.negativeSpace",
    "negative space",
    before.composition.negativeSpace,
    after.composition.negativeSpace,
    changes,
  );
  diffField(
    "composition",
    "composition.depthLayers",
    "depth layers",
    before.composition.depthLayers,
    after.composition.depthLayers,
    changes,
  );

  // Focal points name objects, so they compare as a set: an id that moved
  // inside the list still marks the same object as focal.
  const beforeFocal = new Set(before.composition.focalPoints);
  const afterFocal = new Set(after.composition.focalPoints);
  for (const id of after.composition.focalPoints) {
    if (!beforeFocal.has(id)) {
      changes.push(
        change(
          "composition",
          "added",
          `composition.focalPoints.${id}`,
          `focal point "${id}" added`,
          undefined,
          id,
        ),
      );
    }
  }
  for (const id of before.composition.focalPoints) {
    if (!afterFocal.has(id)) {
      changes.push(
        change(
          "composition",
          "removed",
          `composition.focalPoints.${id}`,
          `focal point "${id}" removed`,
          id,
        ),
      );
    }
  }
  return changes;
}

/**
 * Diff the environment block: the type plus the three free-form blocks the
 * environment model owns (specification section 5).
 */
function diffEnvironment(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  diffField(
    "environment",
    "environment.type",
    "environment type",
    before.environment.type,
    after.environment.type,
    changes,
  );
  for (const block of ["sky", "ground", "atmosphere"] as const) {
    diffJsonTree(
      "environment",
      `environment.${block}`,
      before.environment[block],
      after.environment[block],
      changes,
    );
  }
  return changes;
}

/** One placed object in one short phrase: kind, position, scale. */
function objectSummary(object: SceneObject): string {
  const parts = [
    `${describeValue(object.kind)} at (${object.position.x}, ${object.position.y})`,
    `scale ${object.scale}`,
  ];
  if (object.role !== undefined) {
    parts.push(`role ${describeValue(object.role)}`);
  }
  return parts.join(", ");
}

/** Diff one object both specs keep: every placement and parameter field. */
function diffObject(
  before: SceneObject,
  after: SceneObject,
  changes: SceneDiffChange[],
): void {
  const path = (field: string): string => `objects.${after.id}.${field}`;
  diffField("objects", path("kind"), "kind", before.kind, after.kind, changes);
  diffField("objects", path("role"), "role", before.role, after.role, changes);
  diffField("objects", path("scale"), "scale", before.scale, after.scale, changes);
  diffField("objects", path("rotation"), "rotation", before.rotation, after.rotation, changes);
  diffField(
    "objects",
    path("styleRole"),
    "style role",
    before.styleRole,
    after.styleRole,
    changes,
  );
  if (canonicalJson(before.position) !== canonicalJson(after.position)) {
    changes.push(
      change(
        "objects",
        "changed",
        path("position"),
        `moved from (${before.position.x}, ${before.position.y}) to ` +
          `(${after.position.x}, ${after.position.y})`,
        before.position,
        after.position,
      ),
    );
  }
  diffJsonTree("objects", path("params"), before.params, after.params, changes);
}

/** Diff the object list: additions, removals, field changes, and reorders. */
function diffObjects(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  const beforeById = new Map(before.objects.map((object) => [object.id, object]));
  const afterById = new Map(after.objects.map((object) => [object.id, object]));

  for (const object of after.objects) {
    if (!beforeById.has(object.id)) {
      changes.push(
        change(
          "objects",
          "added",
          `objects.${object.id}`,
          `object "${object.id}" added: ${objectSummary(object)}`,
          undefined,
          object as unknown as JsonValue,
        ),
      );
    }
  }
  for (const object of before.objects) {
    if (!afterById.has(object.id)) {
      changes.push(
        change(
          "objects",
          "removed",
          `objects.${object.id}`,
          `object "${object.id}" removed: ${objectSummary(object)}`,
          object as unknown as JsonValue,
        ),
      );
    }
  }
  for (const object of before.objects) {
    const kept = afterById.get(object.id);
    if (kept !== undefined) {
      diffObject(object, kept, changes);
    }
  }

  // Spec order breaks depth ties (specification section 5), so a reorder
  // with no field change is still a semantic change: it can move which
  // object draws in front. Only the objects both specs keep count here;
  // additions and removals already reported themselves.
  const beforeOrder = before.objects
    .filter((object) => afterById.has(object.id))
    .map((object) => object.id);
  const afterOrder = after.objects
    .filter((object) => beforeById.has(object.id))
    .map((object) => object.id);
  if (canonicalJson(beforeOrder) !== canonicalJson(afterOrder)) {
    changes.push(
      change(
        "objects",
        "changed",
        "objects",
        `object order ${beforeOrder.join(", ")} → ${afterOrder.join(", ")}`,
        beforeOrder,
        afterOrder,
      ),
    );
  }
  return changes;
}

/** Diff the style overrides: what the after scene asks the preset to change. */
function diffStyle(before: SceneSpec, after: SceneSpec): SceneDiffChange[] {
  const changes: SceneDiffChange[] = [];
  diffJsonTree(
    "style",
    "styleOverrides",
    before.styleOverrides,
    after.styleOverrides,
    changes,
  );
  return changes;
}

/** One line that counts the changes per section, in section order. */
function summarize(changes: SceneDiffChange[]): string {
  if (changes.length === 0) {
    return "no semantic changes: the two specs describe the same scene";
  }
  const perSection = SCENE_DIFF_SECTIONS.map((section) => {
    const count = changes.filter((entry) => entry.section === section).length;
    return count === 0 ? null : `${section} ${count}`;
  }).filter((entry): entry is string => entry !== null);
  return `${changes.length} semantic change(s): ${perSection.join(", ")}`;
}

/**
 * Diff two scene specs at the semantic level.
 *
 * Both inputs parse against the `SceneSpec` schema first, so an invalid
 * spec fails with one readable error before any comparison runs. The result
 * lists every semantic change between the two scenes; two specs that
 * describe the same scene - whatever their key order, their whitespace, or
 * their debug flags - diff as equal.
 *
 * ```ts
 * const diff = diffSceneSpecs(before, engine.editScene(before, edits));
 * if (!diff.equal) {
 *   console.log(formatSceneDiff(diff));
 * }
 * ```
 */
export function diffSceneSpecs(before: unknown, after: unknown): SceneDiff {
  const beforeSpec = parseSceneSpec(before);
  const afterSpec = parseSceneSpec(after);
  const changes = [
    ...diffMeta(beforeSpec, afterSpec),
    ...diffCamera(beforeSpec, afterSpec),
    ...diffComposition(beforeSpec, afterSpec),
    ...diffEnvironment(beforeSpec, afterSpec),
    ...diffObjects(beforeSpec, afterSpec),
    ...diffStyle(beforeSpec, afterSpec),
  ];
  return {
    beforeHash: sceneSpecHash(beforeSpec),
    afterHash: sceneSpecHash(afterSpec),
    equal: changes.length === 0,
    changes,
    summary: summarize(changes),
  };
}

/**
 * Render one scene diff as a text listing, one line per change.
 *
 * The first line states how many changes there are; every change that
 * follows names its section, its path, and what happened.
 */
export function formatSceneDiff(diff: SceneDiff): string {
  const header = diff.equal
    ? "scene diff: no semantic changes"
    : `scene diff: ${diff.changes.length} semantic change(s)`;
  return [
    header,
    ...diff.changes.map(
      (entry) => `- [${entry.section}] ${entry.path} — ${entry.description}`,
    ),
  ].join("\n");
}
