/**
 * Module entry for @hatch/styles.
 *
 * Scope from specification section 11: style presets: pastoral-v1,
 * coastal-v1, urban-v1, skatepark-v1, interior-v1.
 *
 * Round 1 ships pastoral-v1. Round 2 adds coastal-v1, urban-v1, and
 * skatepark-v1 (specification section 24). The registry below maps the
 * `meta.stylePreset` string of a scene spec to its StyleSpec, and
 * {@link resolveStyle} layers the `styleOverrides` of the spec on top of
 * it (specification sections 5 and 8).
 *
 * See README.md in this package for the field-by-field documentation of
 * every preset.
 */

import {
  formatIssues,
  ResolvedStyleSpecSchema,
  StyleOverridesSchema,
} from "@hatch/core";
import type {
  EnvironmentType,
  ResolvedStyleSpec,
  StyleOverrides,
  StyleSpec,
} from "@hatch/core";

import { coastalV1, COASTAL_V1_PRESET_ID } from "./coastal-v1.js";
import { pastoralV1, PASTORAL_V1_PRESET_ID } from "./pastoral-v1.js";
import { skateparkV1, SKATEPARK_V1_PRESET_ID } from "./skatepark-v1.js";
import { urbanV1, URBAN_V1_PRESET_ID } from "./urban-v1.js";

/** Package name inside the pnpm workspace. */
export const packageName = "@hatch/styles" as const;

/** One-line role of this package. */
export const packageRole = "Style presets, for example pastoral-v1 and urban-v1.";

// The first style preset (specification section 8).
export { pastoralV1, PASTORAL_V1_PRESET_ID } from "./pastoral-v1.js";

// The round 2 presets (specification sections 11 and 24).
export { coastalV1, COASTAL_V1_PRESET_ID } from "./coastal-v1.js";
export { skateparkV1, SKATEPARK_V1_PRESET_ID } from "./skatepark-v1.js";
export { urbanV1, URBAN_V1_PRESET_ID } from "./urban-v1.js";

// Deep freezing for the shared preset constants.
export * from "./freeze.js";

/**
 * Every preset by id. The key is the value a scene spec names in
 * `meta.stylePreset`. Later rounds append presets here; they never change
 * an entry that shipped, because that would change renders that already
 * exist (specification section 10).
 */
export const STYLE_PRESETS: Readonly<Record<string, StyleSpec>> = Object.freeze({
  [PASTORAL_V1_PRESET_ID]: pastoralV1,
  [COASTAL_V1_PRESET_ID]: coastalV1,
  [URBAN_V1_PRESET_ID]: urbanV1,
  [SKATEPARK_V1_PRESET_ID]: skateparkV1,
});

/** Every registered preset id, in stable alphabetical order. */
export function listStylePresets(): string[] {
  return Object.keys(STYLE_PRESETS).sort();
}

/** True when `presetId` names a registered preset. */
export function hasStylePreset(presetId: string): boolean {
  return Object.hasOwn(STYLE_PRESETS, presetId);
}

/**
 * The environment family one registered preset draws, when it declares one.
 *
 * Every preset of this package declares its family, so a caller that knows
 * the world a scene lives in - the prompt-to-spec planner of round 3, for
 * example - can check the pair before it renders. Throws one readable
 * error for an unknown id, the way {@link getStylePreset} does.
 */
export function environmentTypeOfPreset(
  presetId: string,
): EnvironmentType | undefined {
  return getStylePreset(presetId).environmentType;
}

/**
 * Every registered preset that draws one environment family, in stable
 * alphabetical order.
 *
 * The family `custom` names no world, so every preset pairs with it and
 * the function returns the whole registry. A family no preset draws yet -
 * `interior`, until `interior-v1` ships - returns an empty list, which is
 * the answer a planner needs before it writes the pair into a spec.
 */
export function presetIdsForEnvironment(type: EnvironmentType): string[] {
  if (type === "custom") {
    return listStylePresets();
  }
  return listStylePresets().filter(
    (id) => STYLE_PRESETS[id]!.environmentType === type,
  );
}

/**
 * Return one deep copy of a preset. The copy is safe to mutate: the
 * registry entry stays untouched, so two renders that ask for the same
 * preset never share state.
 *
 * Throws one readable error when the id is unknown.
 */
export function getStylePreset(presetId: string): StyleSpec {
  const preset = hasStylePreset(presetId) ? STYLE_PRESETS[presetId] : undefined;
  if (preset === undefined) {
    throw new Error(
      `unknown style preset '${presetId}'; available presets: ${listStylePresets().join(", ")}`,
    );
  }
  return structuredClone(preset);
}

/**
 * Merge style overrides over a preset and return the resolved style the
 * style application stage consumes (specification sections 5, 8, and 22).
 *
 * An override replaces one whole top-level section, because
 * `StyleOverrides` is a partial of the top-level fields only. To change a
 * single value, spread the section first:
 *
 * ```ts
 * const preset = getStylePreset("pastoral-v1");
 * resolveStyle("pastoral-v1", {
 *   hatchFamilies: {
 *     ...preset.hatchFamilies,
 *     sky: { ...preset.hatchFamilies.sky, spacing: 4 },
 *   },
 * });
 * ```
 *
 * The merged style validates against `ResolvedStyleSpecSchema`. Invalid
 * overrides, or an invalid merged result, throw one readable error that
 * names the failing fields.
 */
export function resolveStyle(
  presetId: string,
  overrides?: StyleOverrides,
): ResolvedStyleSpec {
  const base = getStylePreset(presetId);

  if (overrides !== undefined) {
    const overrideResult = StyleOverridesSchema.safeParse(overrides);
    if (!overrideResult.success) {
      throw new Error(
        `invalid style overrides for preset '${presetId}': ${formatIssues(overrideResult.error.issues)}`,
      );
    }
  }

  const merged = structuredClone({
    ...base,
    ...(overrides ?? {}),
    preset: presetId,
  });
  const result = ResolvedStyleSpecSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `could not resolve style preset '${presetId}': ${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}
