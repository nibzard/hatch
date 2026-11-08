/**
 * Deep freezing for preset constants.
 *
 * A preset is one shared object behind every render that names it. A stage
 * that mutates a preset in place changes every later render, which breaks
 * the determinism contract of specification section 10 in a way no test at
 * the call site explains. Frozen presets fail fast at the mutation instead.
 */

/**
 * Freeze a value and every object nested inside it, then return it.
 * The returned value keeps its input type; TypeScript has no readonly
 * deep modifier, so the freeze is enforced at runtime only.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
