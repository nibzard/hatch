/**
 * The building block generator (specification sections 6, 11, and 24).
 *
 * A building block is one city slab: a lower block, a narrower tower on top
 * when the mass steps back, a window grid per tier, and a parapet band at
 * the roof line. The facade is built surface, the window grid is glass, and
 * the parapet carries the roof role, so a street of blocks reads as three
 * tones.
 *
 * Local frame: the block stands on the line `y = 0`, centered on `x = 0`,
 * and rises towards negative y.
 *
 * Buildings stay controlled (specification section 17), so this generator
 * draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { ARCHITECTURE_ROLE, GLASS_ROLE, ROOF_ROLE } from "./roles.js";
import { clamp, compoundPath, polylinePath, rectanglePath } from "./shapes.js";

/** One tier of the mass: its width share and its height share. */
interface Tier {
  /** Half width of the tier. */
  readonly halfWidth: number;
  /** Y of the tier base. */
  readonly base: number;
  /** Y of the tier roof. */
  readonly top: number;
  /** Floor rows the tier spans. */
  readonly rows: number;
}

/** The semantic parameters of a building block (specification section 6). */
export const buildingBlockParameterSchema = z.object({
  /** Width of the lower block. */
  width: z.number().finite().min(60).max(900),
  /** Total height from the street to the top of the mass. */
  height: z.number().finite().min(80).max(1600),
  /** Window rows, shared between the tiers. */
  floors: z.number().int().min(1).max(14),
  /** Window columns across the lower block. */
  columns: z.number().int().min(1).max(6),
  /** How far the upper tier steps back: 0 is one plain slab. */
  setback: z.number().finite().min(0).max(1),
});

/** The building block parameters. */
export type BuildingBlockParameters = z.infer<
  typeof buildingBlockParameterSchema
>;

/** The range and the default of every building block parameter. */
export const buildingBlockParameterSpace: ParameterSpace = {
  width: numberField(60, 900, 240),
  height: numberField(80, 1600, 520),
  floors: integerField(1, 14, 6),
  columns: integerField(1, 6, 4),
  setback: numberField(0, 1, 0.3),
};

/** The default building block parameters. */
export const defaultBuildingBlockParameters: BuildingBlockParameters =
  buildingBlockParameterSchema.parse(spaceDefaults(buildingBlockParameterSpace));

/** The share of the height the upper tier covers when it steps back. */
const TOWER_SHARE = 0.4;

/** The two tiers of the mass: the lower block and the stepping tower. */
function tiersOf(parameters: BuildingBlockParameters): {
  lower: Tier;
  tower: Tier;
} {
  const halfWidth = parameters.width / 2;
  const towerHeight = parameters.height * TOWER_SHARE * parameters.setback;
  const towerRows = Math.max(
    1,
    Math.round(parameters.floors * TOWER_SHARE * parameters.setback),
  );
  return {
    lower: {
      halfWidth,
      base: 0,
      top: -parameters.height + towerHeight,
      rows: Math.max(1, parameters.floors - towerRows),
    },
    tower: {
      halfWidth: halfWidth * (1 - 0.45 * parameters.setback),
      base: -parameters.height + towerHeight,
      top: -parameters.height,
      rows: towerRows,
    },
  };
}

/** The window grid of one tier, one rectangle per pane. */
function tierWindows(tier: Tier, columns: number): Path[] {
  const panes: Path[] = [];
  const margin = Math.max(3, tier.halfWidth * 0.08);
  const cell = ((tier.halfWidth - margin) * 2) / columns;
  const rowHeight = (tier.base - tier.top) / tier.rows;
  // A tier narrower than two units per cell or per row drops its grid: a
  // stepped mass that thin reads as a wall, not as windows.
  if (cell <= 2 || rowHeight <= 2) {
    return panes;
  }
  const paneWidth = cell * 0.6;
  const paneHeight = rowHeight * 0.5;
  for (let row = 0; row < tier.rows; row += 1) {
    const cellTop = tier.base - rowHeight * (row + 0.28);
    for (let column = 0; column < columns; column += 1) {
      const centerX = -tier.halfWidth + margin + cell * (column + 0.5);
      panes.push(
        rectanglePath(
          centerX - paneWidth / 2,
          cellTop - paneHeight,
          centerX + paneWidth / 2,
          cellTop,
        ),
      );
    }
  }
  return panes;
}

/**
 * Build the geometry of one building block.
 *
 * The block draws no random number: buildings stay controlled
 * (specification section 17).
 */
export function generateBuildingBlock(
  parameters: BuildingBlockParameters,
): Geometry {
  const halfWidth = parameters.width / 2;
  const { lower, tower } = tiersOf(parameters);
  const slab = rectanglePath(-lower.halfWidth, lower.top, lower.halfWidth, 0);
  const towerSlab =
    parameters.setback > 0
      ? rectanglePath(-tower.halfWidth, tower.top, tower.halfWidth, tower.base)
      : null;
  const parapetHeight = clamp(parameters.height * 0.012, 3, 10);
  const parapetTop = rectanglePath(
    -tower.halfWidth,
    tower.top - parapetHeight,
    tower.halfWidth,
    tower.top,
  );

  const silhouette = unitePaths(
    towerSlab === null ? [slab, parapetTop] : [slab, towerSlab, parapetTop],
  );
  if (silhouette === null) {
    throw new Error("the building block generator could not unite its silhouette");
  }

  const contours: Path[] = [
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: -halfWidth, y: lower.top },
    ]),
    polylinePath([
      { x: halfWidth, y: lower.top },
      { x: halfWidth, y: 0 },
    ]),
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: halfWidth, y: 0 },
    ]),
    polylinePath([
      { x: -tower.halfWidth, y: tower.top },
      { x: tower.halfWidth, y: tower.top },
    ]),
  ];

  // The floor lines divide the facade, and the window grid is one boundary
  // compound, so the whole grid counts as one line of the trace.
  const boundaries: Path[] = [];
  for (let row = 1; row < lower.rows; row += 1) {
    const y = lower.base + (lower.top - lower.base) * (row / lower.rows);
    boundaries.push(
      polylinePath([
        { x: -lower.halfWidth, y },
        { x: lower.halfWidth, y },
      ]),
    );
  }
  if (towerSlab !== null) {
    boundaries.push(
      polylinePath([
        { x: -lower.halfWidth, y: tower.base },
        { x: lower.halfWidth, y: tower.base },
      ]),
    );
  }
  const columns = Math.max(
    1,
    Math.round(parameters.columns * (tower.halfWidth / lower.halfWidth)),
  );
  const panes = [
    ...tierWindows(lower, parameters.columns),
    ...tierWindows(tower, columns),
  ];
  const grid = compoundPath(panes);
  if (grid !== null) {
    boundaries.push(grid);
  }

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: silhouette, zIndex: 10 },
    { role: ROOF_ROLE.role, path: parapetTop, zIndex: 12 },
  ];
  if (grid !== null) {
    styleZones.push({ role: GLASS_ROLE.role, path: grid, zIndex: 13 });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The building block generator of the round 2 object registry. */
export const buildingBlockGenerator: ObjectGenerator = {
  kind: "building-block",
  title: "A building block: stepped mass, window grid, and a parapet band.",
  zoneRoles: [ARCHITECTURE_ROLE, GLASS_ROLE, ROOF_ROLE],
  parameterSpace: buildingBlockParameterSpace,
  defaultParameters: spaceDefaults(buildingBlockParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "building-block",
      buildingBlockParameterSchema,
      buildingBlockParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateBuildingBlock(buildingBlockParameterSchema.parse(parameters)),
};
