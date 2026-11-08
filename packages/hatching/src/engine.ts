/**
 * The region hatching engine (specification sections 7, 11, and 17).
 *
 * One region enters, one stroke set leaves. The engine reads the fill style
 * of the region, places one line system per hatch family, humanizes every
 * line from the `texture` values of the style, and clips each line to the
 * region. Nothing it emits leaves the region, not even by a user unit of
 * jitter, because the clip runs last (specification section 7).
 *
 * Determinism (specification section 10): every random value comes from the
 * seeded stream the caller passes in. The engine forks one stream per
 * region and one per family, so adding a region or changing one family
 * never shifts the numbers of another.
 */

import type {
  FillStyle,
  Path,
  Region,
  StyleSpec,
  Texture,
} from "@hatch/core";
import { formatIssues, RegionSchema } from "@hatch/core";
import type { SeededRng } from "@hatch/core";
import {
  clipStroke,
  composeRegion,
  pathArea,
  pathBounds,
  pathLength,
} from "@hatch/geometry";

import {
  driftDegrees,
  endTrim,
  familyAmplitude,
  pressureWeight,
  spacingStep,
  trimPolylineEnds,
  wavyStroke,
} from "./jitter.js";
import { extentLength, idealLine, lineFrame, polylineLength } from "./lines.js";
import type { HatchFamily, HatchKind, HatchSet, HatchStroke } from "./stroke.js";

/** Both ends of an ideal line grow past the extent by this much, plus the amplitude. */
const LINE_MARGIN = 1;

/**
 * The line ceiling of one family. A spacing this small on a region this
 * wide is a spec error, not a style choice. The engine refuses it with a
 * readable error instead of building millions of strokes.
 */
const MAX_LINES_PER_FAMILY = 20000;

/** One line system of a fill style, in one shape. */
interface FamilySpec {
  angle: number;
  spacing: number;
  jitter: number;
  weight: number;
  color: string;
}

/** Read the line systems of one fill style. A `none` fill has none. */
function familiesOf(fillStyle: FillStyle): FamilySpec[] {
  if (fillStyle.type === "none") {
    return [];
  }
  if (fillStyle.type === "hatch") {
    return [
      {
        angle: fillStyle.angle,
        spacing: fillStyle.spacing,
        jitter: fillStyle.jitter,
        weight: fillStyle.weight,
        color: fillStyle.stroke,
      },
    ];
  }
  return [
    {
      angle: fillStyle.angleA,
      spacing: fillStyle.spacingA,
      jitter: fillStyle.jitter,
      weight: fillStyle.weight,
      color: fillStyle.stroke,
    },
    {
      angle: fillStyle.angleB,
      spacing: fillStyle.spacingB,
      jitter: fillStyle.jitter,
      weight: fillStyle.weight,
      color: fillStyle.stroke,
    },
  ];
}

/** The kind label of a fill style. */
function kindOf(fillStyle: FillStyle): HatchKind {
  return fillStyle.type;
}

/** The shortest piece the engine keeps, so slivers at tangential crossings drop. */
function minPieceLength(spacing: number): number {
  return Math.min(1, spacing * 0.1);
}

/**
 * Assemble one stroke set. Both the filled and the empty result build here.
 *
 * The density is derived, never passed: the stroke length over the fill area
 * it was generated inside, and 0 for a set that kept no strokes.
 */
function buildSet(
  region: Region,
  kind: HatchKind,
  strokes: HatchStroke[],
  droppedStrokeCount: number,
  strokeLength: number,
  fillArea: number,
): HatchSet {
  return {
    regionId: region.id,
    ...(region.role === undefined ? {} : { role: region.role }),
    kind,
    zIndex: region.zIndex,
    strokes,
    droppedStrokeCount,
    strokeLength,
    fillArea,
    density: fillArea > 0 ? strokeLength / fillArea : 0,
  };
}

/**
 * The fill area of one region: its path with the clip extent applied.
 *
 * Composition runs through `composeRegion` of `@hatch/geometry`, so the
 * clip rule and the empty-region rule live in one place. A region that
 * clips away to nothing gives `null`.
 */
function fillAreaOf(region: Region): Path | null {
  const [composed] = composeRegion({
    id: region.id,
    ...(region.role === undefined ? {} : { role: region.role }),
    path: region.path,
    fillStyle: region.fillStyle,
    ...(region.clip === undefined ? {} : { clip: region.clip }),
    zIndex: region.zIndex,
  });
  return composed === undefined ? null : composed.path;
}

/** The length of one kept piece, without a Paper.js round trip when possible. */
function keptLength(piece: Path): number {
  return polylineLength(piece) ?? pathLength(piece);
}

/**
 * Generate the strokes of one line family inside one fill area.
 *
 * Lines run from one side of the area to the other, at the family angle
 * plus the angle drift of each line. The spacing varies line by line.
 * A dropped line counts and leaves no geometry.
 *
 * Random draws happen in one fixed order per line: angle drift, then
 * dropout, and for a kept line pressure, the three wave phases, then two
 * end trims per kept piece. The spacing step closes the line, because it
 * belongs to the gap that follows it.
 */
function hatchFamily(
  area: Path,
  spec: FamilySpec,
  family: HatchFamily,
  texture: Texture,
  rng: SeededRng,
): { strokes: HatchStroke[]; dropped: number; totalLength: number } {
  const amplitude = familyAmplitude(spec.jitter, texture);
  const frame = lineFrame(pathBounds(area), spec.angle);
  const margin = amplitude + LINE_MARGIN;
  const floor = minPieceLength(spec.spacing);

  const strokes: HatchStroke[] = [];
  let dropped = 0;
  let totalLength = 0;
  let placed = 0;
  // The first line of a family has no incoming gap, so it reports the
  // nominal spacing. Every later line reports the step that placed it.
  let step = spec.spacing;
  let offset = frame.nMin + rng.float(0, spec.spacing);

  while (offset <= frame.nMax) {
    placed += 1;
    if (placed > MAX_LINES_PER_FAMILY) {
      throw new Error(
        `region fill needs more than ${MAX_LINES_PER_FAMILY} lines in one ` +
          `family; raise the spacing of the fill style (angle ${spec.angle}, ` +
          `spacing ${spec.spacing})`,
      );
    }

    const angle = spec.angle + driftDegrees(amplitude, extentLength(frame, margin), rng);
    if (rng.chance(texture.dropout)) {
      dropped += 1;
    } else {
      const weight = pressureWeight(spec.weight, texture.pressureVariance, rng);
      const line = idealLine(frame, offset, angle, margin);
      const wavy = wavyStroke(line, amplitude, texture.paperNoise, rng);

      const commands: Path["commands"] = [];
      let strokeLength = 0;
      for (const piece of clipStroke(wavy, area)) {
        const pieceLength = pathLength(piece);
        const trimmed = trimPolylineEnds(
          piece,
          endTrim(pieceLength, amplitude, rng),
          endTrim(pieceLength, amplitude, rng),
        );
        if (trimmed === null) {
          continue;
        }
        // The sliver floor holds after the trim, not before it. A piece
        // that survives only half trimmed is still a sliver.
        const kept = keptLength(trimmed);
        if (kept < floor) {
          continue;
        }
        commands.push(...trimmed.commands);
        strokeLength += kept;
      }
      if (commands.length > 0) {
        strokes.push({
          path: { commands },
          weight,
          color: spec.color,
          family,
          angle,
          spacing: step,
        });
        totalLength += strokeLength;
      }
    }
    step = spacingStep(spec.spacing, amplitude, rng);
    offset += step;
  }

  return { strokes, dropped, totalLength };
}

/**
 * Generate the stroke set of one region.
 *
 * The region parses against the `Region` schema of `@hatch/core`. Its fill
 * area is its path, clipped to `region.clip` when it carries one. A `none`
 * fill, an empty clip result, or a degenerate area gives an empty set, so a
 * negative-space region keeps its place in the trace.
 *
 * The stream forks under the region id. The fork escapes its label, so no
 * id can collide with the fork label of another stream, whatever characters
 * it holds. The same region under the same parent stream always draws the
 * same numbers.
 */
export function hatchRegion(
  region: Region,
  style: StyleSpec,
  rng: SeededRng,
): HatchSet {
  const parsed = RegionSchema.safeParse(region);
  if (!parsed.success) {
    throw new Error(
      `hatchRegion needs a valid region: ${formatIssues(parsed.error.issues)}`,
    );
  }
  const kind = kindOf(region.fillStyle);
  const specs = familiesOf(region.fillStyle);
  if (specs.length === 0) {
    return buildSet(region, kind, [], 0, 0, 0);
  }

  const area = fillAreaOf(region);
  if (area === null) {
    return buildSet(region, kind, [], 0, 0, 0);
  }
  const fillArea = pathArea(area);
  if (fillArea <= 0) {
    return buildSet(region, kind, [], 0, 0, 0);
  }

  // The fork escapes the label, so the id needs no quoting here: two
  // regions whose ids collide with the fork format stay two streams.
  const stream = rng.fork(`hatch:${region.id}`);
  const strokes: HatchStroke[] = [];
  let droppedStrokeCount = 0;
  let totalLength = 0;
  specs.forEach((spec, index) => {
    const family: HatchFamily = index === 0 ? "a" : "b";
    const result = hatchFamily(
      area,
      spec,
      family,
      style.texture,
      stream.fork(family),
    );
    strokes.push(...result.strokes);
    droppedStrokeCount += result.dropped;
    totalLength += result.totalLength;
  });

  return buildSet(
    region,
    kind,
    strokes,
    droppedStrokeCount,
    totalLength,
    fillArea,
  );
}

/**
 * Generate the stroke sets of many regions, in draw order.
 *
 * Regions draw in ascending `zIndex`, with the input order kept between
 * equals. Every region forks its own stream, so the sets do not depend on
 * each other. Region ids must be unique, because the fork label of a
 * region is its id.
 */
export function hatchRegions(
  regions: readonly Region[],
  style: StyleSpec,
  rng: SeededRng,
): HatchSet[] {
  const seen = new Set<string>();
  for (const region of regions) {
    if (seen.has(region.id)) {
      throw new Error(
        `region ids must be unique, because they name the hatch stream of ` +
          `their region; duplicate id: ${region.id}`,
      );
    }
    seen.add(region.id);
  }
  return regions
    .map((region) => hatchRegion(region, style, rng))
    .sort((left, right) => left.zIndex - right.zIndex);
}
