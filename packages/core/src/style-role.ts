/**
 * The style role vocabulary (specification sections 5 and 16D).
 *
 * Specification section 16D names the style roles of the illustration:
 * sky hatch, field hatch, water hatch, foliage crosshatch, contour, accent
 * line, and construction/debug. The hatch ones name fills, so
 * `SceneObject.styleRole` borrows them: a style role on an object fills
 * every style zone of that object with the hatch family the role names,
 * instead of the family each zone's own role resolves to. A tree that
 * carries `styleRole: "sky hatch"` draws its canopy and its trunk in the
 * open sky hatch, which is how one object reads as a distant silhouette.
 *
 * The stroke roles of the same section - contour, accent line,
 * construction - name no fill, so they are not values of the field. The
 * scene schema rejects them at parse time with the list below, and this
 * module rejects them again when a caller hands the engine an object the
 * schema never parsed.
 *
 * The type import below is types-only on purpose: {@link ZoneFamilyName}
 * lives beside the zone family table that consumes it, and importing it as
 * a type keeps this module free of a runtime cycle with the engine.
 */

import type { ZoneFamilyName } from "./engine.js";

/**
 * Every fill style role of specification section 16D, mapped to the hatch
 * family of a preset that fills it. `paper` names the negative space of
 * the style: an object that carries it draws its contours over unfilled
 * paper.
 */
export const STYLE_ROLE_FAMILIES: Readonly<Record<string, ZoneFamilyName>> = {
  "sky hatch": "sky",
  "field hatch": "field",
  "foliage crosshatch": "foliage",
  "mountain hatch": "mountain",
  "water hatch": "water",
  "cliff hatch": "cliff",
  paper: "none",
};

/** Every style role a `SceneObject.styleRole` may carry, in list order. */
export const STYLE_ROLE_NAMES: readonly string[] = Object.keys(
  STYLE_ROLE_FAMILIES,
);

/** True when `styleRole` names a style role the compiler reads. */
export function isStyleRole(styleRole: string): boolean {
  return styleRole in STYLE_ROLE_FAMILIES;
}

/**
 * The hatch family one style role fills with.
 *
 * Throws one readable error for any other value, naming the roles the
 * field accepts. The scene schema already rejects those values at parse
 * time, so this is the backstop for a caller that builds a spec by hand.
 */
export function styleRoleFamily(styleRole: string): ZoneFamilyName {
  const family = STYLE_ROLE_FAMILIES[styleRole];
  if (family === undefined) {
    throw new Error(
      `styleRole "${styleRole}" names no fill of the style; ` +
        `the style roles are: ${STYLE_ROLE_NAMES.join(", ")}`,
    );
  }
  return family;
}
