/**
 * Vector graphics primitives for the PDF export (task T030).
 *
 * The PDF converter turns the markup of one SVG document into PDF path,
 * clipping, and painting operators. This module holds the three pure pieces
 * of that translation, each without knowledge of PDF itself:
 *
 * - {@link formatPdfNumber} writes one number the way the SVG writer of
 *   `@hatch/renderer-svg` writes its own numbers, so both formats round
 *   alike and stay byte-stable (specification section 10);
 * - {@link parsePathData} reads one `d` attribute into the core path
 *   commands, with every command letter of SVG path data, not only the
 *   four the renderer writes today;
 * - {@link parseTransform} reads one `transform` list into the six-number
 *   matrix both SVG and PDF use.
 *
 * Every helper is a pure function of its input, so the same attribute value
 * always yields the same operators.
 */

import type { CurveCommand, PathCommand, Point } from "@hatch/core";

/** Decimal places every emitted number is rounded to. */
const DECIMALS = 3;

/** 10 to the power of {@link DECIMALS}, computed once. */
const FACTOR = 10 ** DECIMALS;

/** Two times pi, the full turn in radians. */
const FULL_TURN = 2 * Math.PI;

/**
 * Format one number for a PDF operand.
 *
 * The rules match the SVG number writer: three decimals, trailing zeros
 * dropped, negative zero collapsed. Non-finite values throw, because
 * `NaN` or infinity in a path operand is a geometry bug, not a style
 * choice.
 */
export function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `PDF output needs finite numbers; received ${String(value)}`,
    );
  }
  const rounded = Math.round(value * FACTOR) / FACTOR;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (Math.abs(normalized) < 1 / FACTOR) {
    return "0";
  }
  const text = String(normalized);
  return text.includes("e") ? normalized.toFixed(DECIMALS) : text;
}

/** One color of the document, or an explicit `none`. */
export type SvgColor =
  | { readonly kind: "rgb"; readonly rgb: readonly [number, number, number] }
  | { readonly kind: "none" };

/** The named colors the palette grammar of the renderer can produce. */
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> =
  {
    black: [0, 0, 0],
    white: [1, 1, 1],
  };

/** Multiply one hexadecimal channel into the 0 to 1 range PDF wants. */
function channelOf(hex: string): number {
  return Number.parseInt(hex, 16) / 255;
}

/** Fold three channels into one color value. */
function rgbOf(
  channels: readonly [number, number, number],
): SvgColor {
  return { kind: "rgb", rgb: channels };
}

/**
 * Read one CSS color of the grammar the renderer emits: `#rgb`, `#rrggbb`,
 * `rgb(r g b)` with 0 to 255 channels, the two names `black` and `white`,
 * or `none`. Every other form fails with one named error, because a color
 * this converter cannot write must not quietly become black.
 */
export function parseColor(value: string): SvgColor {
  const text = value.trim();
  if (text === "none" || text === "transparent") {
    return { kind: "none" };
  }
  const hex3 = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(text);
  if (hex3) {
    const channel = (index: number): number => {
      const digit = hex3?.[index] ?? "0";
      return channelOf(digit + digit);
    };
    return rgbOf([channel(1), channel(2), channel(3)]);
  }
  const hex6 = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(text);
  if (hex6) {
    return rgbOf([
      channelOf(hex6?.[1] ?? "00"),
      channelOf(hex6?.[2] ?? "00"),
      channelOf(hex6?.[3] ?? "00"),
    ]);
  }
  const functional =
    /^rgb\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(text);
  if (functional) {
    const raw = functional.slice(1).map((part) => Number.parseFloat(part));
    if (raw.some((channel) => !(channel >= 0 && channel <= 255))) {
      throw new Error(
        `a color channel must sit between 0 and 255, got "${text}"`,
      );
    }
    return rgbOf([
      (raw[0] ?? 0) / 255,
      (raw[1] ?? 0) / 255,
      (raw[2] ?? 0) / 255,
    ]);
  }
  const named = NAMED_COLORS[text];
  if (named) {
    return rgbOf(named);
  }
  throw new Error(
    `the color "${text}" is outside the grammar of this converter: ` +
      "write it as #rgb, #rrggbb, rgb(r g b), black, white, or none",
  );
}

/** A 2 x 3 transformation matrix, laid out as PDF and SVG lay it out. */
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The identity matrix. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Multiply two matrices: `outer` applies after `inner`. */
export function composeMatrices(outer: Matrix, inner: Matrix): Matrix {
  const [oa, ob, oc, od, oe, of] = outer;
  const [ia, ib, ic, id, ie, if_] = inner;
  return [
    oa * ia + oc * ib,
    ob * ia + od * ib,
    oa * ic + oc * id,
    ob * ic + od * id,
    oa * ie + oc * if_ + oe,
    ob * ie + od * if_ + of,
  ];
}

/** One point at `x` and `y`. */
function at(x: number, y: number): Point {
  return { x, y };
}

/** Read one whitespace- or comma-separated number list. */
function parseNumbers(text: string): number[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const value = Number.parseFloat(part);
      if (!Number.isFinite(value)) {
        throw new Error(`"${part}" is not a finite number`);
      }
      return value;
    });
}

/** Degrees to radians. */
function radiansOf(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Read one `transform` attribute into a single matrix.
 *
 * The list applies left to right, so `translate(10 0) scale(2)` first
 * scales the coordinates it is given, then translates them. Every
 * transform function of SVG grammar is covered: `translate`, `scale`,
 * `rotate`, `matrix`, `skewX`, and `skewY`.
 */
export function parseTransform(list: string): Matrix {
  if (list.trim().length === 0) {
    return IDENTITY;
  }
  let matrix = IDENTITY;
  const functions =
    /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([^)]*)\)/g;
  // Text no function call covers is a grammar error, not a no-op.
  const remainder = list.replaceAll(functions, "");
  if (remainder.trim().replaceAll(",", "").length > 0) {
    throw new Error(
      `the transform "${list}" is outside the grammar: write it as a ` +
        "list of translate, scale, rotate, matrix, skewX, or skewY",
    );
  }
  for (let match = functions.exec(list); match; match = functions.exec(list)) {
    const name = match[1] ?? "";
    const args = parseNumbers(match[2] ?? "");
    let step: Matrix;
    switch (name) {
      case "translate": {
        step = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      }
      case "scale": {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        step = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case "rotate": {
        const angle = args[0] ?? 0;
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        const cos = Math.cos(radiansOf(angle));
        const sin = Math.sin(radiansOf(angle));
        const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
        step =
          cx === 0 && cy === 0
            ? rotation
            : composeMatrices(
                composeMatrices([1, 0, 0, 1, cx, cy], rotation),
                [1, 0, 0, 1, -cx, -cy],
              );
        break;
      }
      case "matrix": {
        if (args.length !== 6) {
          throw new Error(`matrix() needs six numbers, got "${list}"`);
        }
        step = [
          args[0] ?? 0,
          args[1] ?? 0,
          args[2] ?? 0,
          args[3] ?? 0,
          args[4] ?? 0,
          args[5] ?? 0,
        ];
        break;
      }
      case "skewX": {
        step = [1, 0, Math.tan(radiansOf(args[0] ?? 0)), 1, 0, 0];
        break;
      }
      case "skewY": {
        step = [1, Math.tan(radiansOf(args[0] ?? 0)), 0, 1, 0, 0];
        break;
      }
      default:
        throw new Error(`the transform "${name}" is outside the grammar`);
    }
    matrix = composeMatrices(matrix, step);
  }
  return matrix;
}

/** One command letter with its numbers, straight from the path data. */
interface PathToken {
  readonly letter: string;
  readonly args: number[];
}

/** One path-data token: a command letter or one number. */
type TokenPart =
  | { readonly letter: string; readonly number?: undefined }
  | { readonly letter?: undefined; readonly number: number };

/** Split one `d` attribute into letters and numbers, rejecting junk. */
function tokenizePathData(d: string): PathToken[] {
  const pattern =
    /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const parts: TokenPart[] = [];
  let cursor = 0;
  const gapIsBlank = (gap: string): boolean =>
    gap.trim().replaceAll(",", "").length === 0;
  for (let match = pattern.exec(d); match; match = pattern.exec(d)) {
    const before = d.slice(cursor, match.index);
    if (!gapIsBlank(before)) {
      throw new Error(
        `the path data carries "${before.trim()}", which is outside the grammar`,
      );
    }
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      parts.push({ letter: match[1] });
    } else {
      parts.push({ number: Number.parseFloat(match[2] ?? "") });
    }
  }
  if (!gapIsBlank(d.slice(cursor))) {
    throw new Error(
      `the path data carries "${d.slice(cursor).trim()}", which is outside ` +
        "the grammar",
    );
  }

  const tokens: PathToken[] = [];
  for (const part of parts) {
    if (part.letter !== undefined) {
      tokens.push({ letter: part.letter, args: [] });
      continue;
    }
    const last = tokens[tokens.length - 1];
    if (!last) {
      throw new Error(
        `the number ${part.number} carries no command letter in the path data`,
      );
    }
    if ("Zz".includes(last.letter)) {
      throw new Error("numbers cannot follow the close command");
    }
    last.args.push(part.number);
  }
  return tokens;
}

/** How many numbers one command letter consumes per repetition. */
const STRIDE: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** One quarter turn; the largest sweep one cubic segment approximates. */
const MAX_ARC_SWEEP = Math.PI / 2;

/** The control-point factor of one cubic that approximates an arc sweep. */
function arcKappa(sweep: number): number {
  return (4 / 3) * Math.tan(sweep / 4);
}

/**
 * Convert one elliptical arc into cubic curve commands.
 *
 * The endpoint-to-centre parameterization follows appendix F of the SVG
 * specification. Every arc splits into segments of at most a quarter turn,
 * each approximated by one cubic, which is how SVG arcs reach PDF: PDF
 * path grammar has no arc of its own.
 */
function arcToCurves(
  from: Point,
  rx: number,
  ry: number,
  xAxisRotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): CurveCommand[] {
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    return [{ command: "curve", control1: from, control2: to, to }];
  }
  const phi = radiansOf(xAxisRotationDegrees);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const half = at((from.x - to.x) / 2, (from.y - to.y) / 2);
  const x1 = cosPhi * half.x + sinPhi * half.y;
  const y1 = -sinPhi * half.x + cosPhi * half.y;

  const overshoot = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (overshoot > 1) {
    const scale = Math.sqrt(overshoot);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc !== sweep ? 1 : -1;
  const numerator =
    rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coefficient =
    sign * Math.sqrt(Math.max(0, numerator / denominator));
  const centreUnitX = (coefficient * (rx * y1)) / ry;
  const centreUnitY = (-coefficient * (ry * x1)) / rx;
  const centre = at(
    cosPhi * centreUnitX - sinPhi * centreUnitY + (from.x + to.x) / 2,
    sinPhi * centreUnitX + cosPhi * centreUnitY + (from.y + to.y) / 2,
  );

  const angleOf = (unitX: number, unitY: number): number => {
    const angle = Math.atan2(unitY, unitX);
    return angle < 0 ? angle + FULL_TURN : angle;
  };
  const theta1 = angleOf((x1 - centreUnitX) / rx, (y1 - centreUnitY) / ry);
  const theta2 = angleOf((-x1 - centreUnitX) / rx, (-y1 - centreUnitY) / ry);
  let sweepAngle = theta2 - theta1;
  if (sweep && sweepAngle < 0) {
    sweepAngle += FULL_TURN;
  }
  if (!sweep && sweepAngle > 0) {
    sweepAngle -= FULL_TURN;
  }

  const segments = Math.max(
    1,
    Math.ceil(Math.abs(sweepAngle) / MAX_ARC_SWEEP),
  );
  const delta = sweepAngle / segments;
  const kappa = arcKappa(delta);
  const pointAt = (theta: number): Point =>
    at(
      centre.x +
        cosPhi * rx * Math.cos(theta) -
        sinPhi * ry * Math.sin(theta),
      centre.y +
        sinPhi * rx * Math.cos(theta) +
        cosPhi * ry * Math.sin(theta),
    );
  const tangentAt = (theta: number): Point =>
    at(
      -cosPhi * rx * Math.sin(theta) - sinPhi * ry * Math.cos(theta),
      -sinPhi * rx * Math.sin(theta) + cosPhi * ry * Math.cos(theta),
    );

  const curves: CurveCommand[] = [];
  let theta = theta1;
  for (let index = 0; index < segments; index += 1) {
    const nextTheta = theta + delta;
    const start = pointAt(theta);
    const end = pointAt(nextTheta);
    const startTangent = tangentAt(theta);
    const endTangent = tangentAt(nextTheta);
    curves.push({
      command: "curve",
      control1: at(
        start.x + kappa * startTangent.x,
        start.y + kappa * startTangent.y,
      ),
      control2: at(
        end.x - kappa * endTangent.x,
        end.y - kappa * endTangent.y,
      ),
      // The last segment lands on the exact endpoint, so a long chain of
      // arcs cannot drift off it by rounding.
      to: index === segments - 1 ? to : end,
    });
    theta = nextTheta;
  }
  return curves;
}

/**
 * Read one `d` attribute into core path commands.
 *
 * The output uses the path model of `@hatch/core`, the same model the SVG
 * renderer writes from, so both exports share one geometry vocabulary.
 * Relative commands resolve against the current point, the shorthands `S`
 * and `T` reflect the previous control point, quadratics become cubics,
 * and elliptical arcs become chains of cubics, so every segment stays a
 * vector in the PDF.
 */
export function parsePathData(d: string): PathCommand[] {
  const tokens = tokenizePathData(d);
  const commands: PathCommand[] = [];
  let current = at(0, 0);
  let subpathStart = at(0, 0);
  let lastControl: Point | undefined;
  let curveFamily: "cubic" | "quadratic" | undefined;

  for (const token of tokens) {
    const relative = token.letter !== token.letter.toUpperCase();
    const letter = token.letter.toUpperCase();
    const stride = STRIDE[letter];
    if (stride === undefined) {
      throw new Error(
        `the path command "${token.letter}" is outside the grammar`,
      );
    }
    if (
      (stride > 0 && token.args.length % stride !== 0) ||
      (stride === 0 && token.args.length > 0)
    ) {
      throw new Error(
        `the path command "${token.letter}" takes ${stride} number(s) per ` +
          `step, got ${token.args.length}`,
      );
    }
    // A shorthand reflects the previous control point only when the
    // previous command was a curve of its own family. Every command
    // maintains the two fields below as it draws.
    const reflect = (): Point =>
      lastControl === undefined
        ? current
        : at(2 * current.x - lastControl.x, 2 * current.y - lastControl.y);

    // Close takes no numbers and no repetition: it draws once and moves
    // the pen back to the start of its subpath.
    if (letter === "Z") {
      commands.push({ command: "close" });
      current = subpathStart;
      lastControl = undefined;
      curveFamily = undefined;
      continue;
    }

    for (let index = 0; index < token.args.length; index += stride) {
      const arg = (offset: number): number => token.args[index + offset] ?? 0;
      const target = (x: number, y: number): Point =>
        relative ? at(current.x + x, current.y + y) : at(x, y);
      switch (letter) {
        case "M": {
          const next = target(arg(0), arg(1));
          commands.push({ command: "move", to: next });
          current = next;
          subpathStart = next;
          break;
        }
        case "L": {
          const next = target(arg(0), arg(1));
          commands.push({ command: "line", to: next });
          current = next;
          break;
        }
        case "H": {
          const next = at(
            relative ? current.x + arg(0) : arg(0),
            current.y,
          );
          commands.push({ command: "line", to: next });
          current = next;
          break;
        }
        case "V": {
          const next = at(
            current.x,
            relative ? current.y + arg(0) : arg(0),
          );
          commands.push({ command: "line", to: next });
          current = next;
          break;
        }
        case "C": {
          const control1 = target(arg(0), arg(1));
          const control2 = target(arg(2), arg(3));
          const next = target(arg(4), arg(5));
          commands.push({ command: "curve", control1, control2, to: next });
          current = next;
          lastControl = control2;
          curveFamily = "cubic";
          break;
        }
        case "S": {
          const control1 = curveFamily === "cubic" ? reflect() : current;
          const control2 = target(arg(0), arg(1));
          const next = target(arg(2), arg(3));
          commands.push({ command: "curve", control1, control2, to: next });
          current = next;
          lastControl = control2;
          curveFamily = "cubic";
          break;
        }
        case "Q": {
          const control = target(arg(0), arg(1));
          const next = target(arg(2), arg(3));
          commands.push({
            command: "curve",
            control1: at(
              current.x + (2 / 3) * (control.x - current.x),
              current.y + (2 / 3) * (control.y - current.y),
            ),
            control2: at(
              next.x + (2 / 3) * (control.x - next.x),
              next.y + (2 / 3) * (control.y - next.y),
            ),
            to: next,
          });
          current = next;
          lastControl = control;
          curveFamily = "quadratic";
          break;
        }
        case "T": {
          const control = curveFamily === "quadratic" ? reflect() : current;
          const next = target(arg(0), arg(1));
          commands.push({
            command: "curve",
            control1: at(
              current.x + (2 / 3) * (control.x - current.x),
              current.y + (2 / 3) * (control.y - current.y),
            ),
            control2: at(
              next.x + (2 / 3) * (control.x - next.x),
              next.y + (2 / 3) * (control.y - next.y),
            ),
            to: next,
          });
          current = next;
          lastControl = control;
          curveFamily = "quadratic";
          break;
        }
        case "A": {
          const next = target(arg(5), arg(6));
          commands.push(
            ...arcToCurves(
              current,
              Math.abs(arg(0)),
              Math.abs(arg(1)),
              arg(2),
              arg(3) === 1,
              arg(4) === 1,
              next,
            ),
          );
          current = next;
          lastControl = undefined;
          curveFamily = undefined;
          break;
        }
        default:
          break;
      }
    }
    if (letter !== "C" && letter !== "S" && letter !== "Q" && letter !== "T") {
      lastControl = undefined;
      curveFamily = undefined;
    }
  }
  if (commands.length > 0 && commands[0]?.command !== "move") {
    throw new Error("the path data must start with a move command");
  }
  return commands;
}
