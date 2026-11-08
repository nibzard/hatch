/**
 * Style zone roles (specification sections 6, 16C, and 16D).
 *
 * A style zone carries a role, and the style application stage resolves
 * the role to a fill. Specification section 16C names the base roles -
 * sky, ground, field, foliage, architecture, water, rock, shadow,
 * cloud-hole - and the core model keeps the role a free string, so an
 * object may add its own.
 *
 * Every generator lists the roles it emits together with the hatch family
 * the role resolves to. The list is documentation for the style stage and
 * a contract for tests: a zone role that no preset can fill is a bug.
 *
 * Round 2 adds the roles of the skatepark and urban objects, and the coastal
 * kinds add the roles of the coast. Each one maps onto a hatch family the V1
 * style grammar already defines, so the presets tune the families instead of
 * the core changing first.
 */

/** Every hatch family a style preset defines, plus `none` for paper. */
export type HatchFamilyName =
  | "sky"
  | "field"
  | "foliage"
  | "mountain"
  | "water"
  | "cliff"
  | "none";

/** One style zone role and the fill that resolves it. */
export interface StyleZoneRole {
  /** The `role` value the generator writes into its style zones. */
  readonly role: string;
  /** The hatch family of the style preset that fills the zone. */
  readonly family: HatchFamilyName;
  /** One line on what the zone covers. */
  readonly note: string;
}

/** The wall zone of the house: open field-angle hatch, architecture ink. */
export const ARCHITECTURE_ROLE: StyleZoneRole = {
  role: "architecture",
  family: "field",
  note: "built surfaces: cottage walls and the chimney, open even hatch",
};

/** The roof zone of the house: slanted hatch, denser than the walls. */
export const ROOF_ROLE: StyleZoneRole = {
  role: "roof",
  family: "mountain",
  note: "roof planes: slanted hatch, denser than the walls",
};

/** The canopy zone of the tree: crosshatch, the densest zone of the style. */
export const FOLIAGE_ROLE: StyleZoneRole = {
  role: "foliage",
  family: "foliage",
  note: "tree canopy: crosshatch, denser and more irregular than any field",
};

/** The hill zone: horizontal field hatch, the striped field of the style. */
export const FIELD_ROLE: StyleZoneRole = {
  role: "field",
  family: "field",
  note: "open ground: horizontal field hatch in evenly spaced strips",
};

/** The sunlit face of a mountain: slanted hatch of the mountain family. */
export const MOUNTAIN_ROLE: StyleZoneRole = {
  role: "mountain",
  family: "mountain",
  note: "the sunlit face of a mountain or the headland slope above a cliff: slanted hatch with strong density",
};

/** Hard rock: near-vertical strata of the cliff family. */
export const ROCK_ROLE: StyleZoneRole = {
  role: "rock",
  family: "cliff",
  note: "hard rock: the shaded face of a mountain, the wave-cut front of a cliff, a sea-worn boulder",
};

/** The water band: two diagonal systems that cross at a shallow angle. */
export const WATER_ROLE: StyleZoneRole = {
  role: "water",
  family: "water",
  note: "the water surface: crossing diagonal hatch, calm and even",
};

/** Snow and cloud masses: unfilled paper, the negative space of the style. */
export const SNOW_ROLE: StyleZoneRole = {
  role: "snow",
  family: "none",
  note: "a snow cap: unfilled paper, so the mass reads as light",
};

/**
 * Formed concrete: the transition walls of a bowl, the riding face of a
 * quarter pipe. The mountain family hatch is slanted and dense, which reads
 * as a hard poured surface.
 */
export const CONCRETE_ROLE: StyleZoneRole = {
  role: "concrete",
  family: "mountain",
  note: "formed skate surfaces: bowl walls and ramp faces, hard slanted hatch",
};

/**
 * Flat paved ground: the surface of a road, the deck pad around a bowl. The
 * field family hatch lies horizontal and even, the way flat ground reads.
 */
export const PAVEMENT_ROLE: StyleZoneRole = {
  role: "pavement",
  family: "field",
  note: "flat paved ground: road surface and deck pads, even horizontal hatch",
};

/**
 * Metalwork: handrail tubes, fence and bench frames, light poles. The cliff
 * family hatch runs near vertical and heavy, so a thin post reads as solid
 * metal instead of soil.
 */
export const METAL_ROLE: StyleZoneRole = {
  role: "metal",
  family: "cliff",
  note: "metalwork: rails, posts, poles, and wheel rims, hard vertical strokes",
};

/**
 * Glass: vehicle windows, building windows, lamp lenses. The water family
 * hatch crosses two calm diagonals, which reads as a reflective pane.
 */
export const GLASS_ROLE: StyleZoneRole = {
  role: "glass",
  family: "water",
  note: "window glass and lamp lenses: calm crossing diagonal hatch",
};

/**
 * Cast shadow: the ground shadow of a skater, a car, or a bench. The foliage
 * family crosshatch is the densest fill, so the shadow reads as the darkest
 * mass of the scene.
 */
export const SHADOW_ROLE: StyleZoneRole = {
  role: "shadow",
  family: "foliage",
  note: "a cast shadow on the ground: the densest crossing hatch mass",
};

/**
 * The body of a human figure: unfilled paper, so the figure reads from its
 * contour lines alone, the way snow and cloud masses read.
 */
export const FIGURE_ROLE: StyleZoneRole = {
  role: "figure",
  family: "none",
  note: "a human figure: unfilled paper, so the mass reads as light",
};

/**
 * The painted signal band of a lighthouse: the mark that identifies the
 * tower from the sea. The mountain family hatch runs denser than the
 * architecture wall it sits on, so the band reads as the strongest mark of
 * the tower without asking the palette for a second ink.
 */
export const SIGNAL_ROLE: StyleZoneRole = {
  role: "signal",
  family: "mountain",
  note: "the painted signal band of a lighthouse: denser hatch than the tower wall",
};

/** Every style zone role the V1 generators emit. */
export const V1_STYLE_ZONE_ROLES: readonly StyleZoneRole[] = [
  ARCHITECTURE_ROLE,
  ROOF_ROLE,
  FOLIAGE_ROLE,
  FIELD_ROLE,
  MOUNTAIN_ROLE,
  ROCK_ROLE,
  WATER_ROLE,
  SNOW_ROLE,
];

/** Every style zone role the round 2 generators emit. */
export const V2_STYLE_ZONE_ROLES: readonly StyleZoneRole[] = [
  CONCRETE_ROLE,
  PAVEMENT_ROLE,
  METAL_ROLE,
  GLASS_ROLE,
  SHADOW_ROLE,
  FIGURE_ROLE,
];

/** Every style zone role the coastal generators emit. */
export const COASTAL_STYLE_ZONE_ROLES: readonly StyleZoneRole[] = [
  SIGNAL_ROLE,
];

/** Every style zone role the shipped generators emit. */
export const STYLE_ZONE_ROLES: readonly StyleZoneRole[] = [
  ...V1_STYLE_ZONE_ROLES,
  ...V2_STYLE_ZONE_ROLES,
  ...COASTAL_STYLE_ZONE_ROLES,
];

/** Look up one role descriptor by role name. */
export function styleZoneRole(role: string): StyleZoneRole | undefined {
  return STYLE_ZONE_ROLES.find((entry) => entry.role === role);
}
