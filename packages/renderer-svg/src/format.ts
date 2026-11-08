/**
 * Deterministic number formatting for SVG output (specification section 10).
 *
 * Every number that reaches the SVG passes through {@link formatNumber}: the
 * same input value always renders as the same string, so two renders of one
 * intermediate representation are byte-identical. The rounding also keeps
 * the output small, because jitter works at a far finer resolution than a
 * printed line can show.
 */

/** Decimal places every emitted number is rounded to. */
const DECIMALS = 3;

/** 10 to the power of {@link DECIMALS}, computed once. */
const FACTOR = 10 ** DECIMALS;

/**
 * Format one number for an SVG attribute or path command.
 *
 * Trailing zeros drop away, negative zero collapses to `0`, and values too
 * small for fixed notation collapse to `0`. Non-finite values throw, because
 * `NaN` or infinity in a path command is a geometry bug, not a style choice.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `SVG output needs finite numbers; received ${String(value)}`,
    );
  }
  const rounded = Math.round(value * FACTOR) / FACTOR;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (Math.abs(normalized) < 1 / FACTOR) {
    return "0";
  }
  const text = String(normalized);
  // String switches to exponent notation below 1e-6 and above 1e21. The
  // first range is covered above; the second cannot appear in scene units.
  return text.includes("e") ? normalized.toFixed(DECIMALS) : text;
}

/**
 * Format one path-data number at `decimals` places, without the leading
 * zero of a fraction.
 *
 * `0.5` writes as `.5` and `-0.5` as `-.5`. Both are numbers of the SVG
 * path grammar, and neither can open a number that follows another one, so
 * the separator in front of them drops away. One path holds thousands of
 * these numbers, so the two saved characters each add up (task T036).
 *
 * The rounding rules match {@link formatNumber}; only the notation is
 * shorter. A caller that needs the exact value a reader parses back can
 * hand the result to `Number.parseFloat`, which reads this form.
 */
export function formatCompactNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `SVG output needs finite numbers; received ${String(value)}`,
    );
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > DECIMALS) {
    throw new Error(
      `a compact SVG number takes 0 to ${DECIMALS} decimal places, received ${decimals}`,
    );
  }
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (Math.abs(normalized) < 1 / factor) {
    return "0";
  }
  const text = String(normalized);
  const plain = text.includes("e") ? normalized.toFixed(decimals) : text;
  return plain.replace(/^(-?)0\./, "$1.");
}
