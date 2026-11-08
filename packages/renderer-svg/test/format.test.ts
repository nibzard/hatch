/**
 * Tests for the compact path-data number writer (task T036).
 */

import { describe, expect, it } from "vitest";

import { formatCompactNumber, formatNumber } from "../src/format.js";

describe("formatCompactNumber", () => {
  it("drops the leading zero of a fraction", () => {
    expect(formatCompactNumber(0.5, 1)).toBe(".5");
    expect(formatCompactNumber(-0.5, 1)).toBe("-.5");
    expect(formatCompactNumber(0.25, 2)).toBe(".25");
  });

  it("rounds to the asked places like the shared writer", () => {
    expect(formatCompactNumber(0.1 + 0.2, 1)).toBe(formatCompactNumber(0.3, 1));
    expect(formatCompactNumber(1.25, 1)).toBe("1.3");
    expect(formatCompactNumber(-1.24, 1)).toBe("-1.2");
  });

  it("writes whole numbers without a decimal point", () => {
    expect(formatCompactNumber(70.2, 0)).toBe("70");
    expect(formatCompactNumber(-70.7, 0)).toBe("-71");
    expect(formatCompactNumber(2, 1)).toBe("2");
  });

  it("folds a rounded zero and negative zero into 0", () => {
    expect(formatCompactNumber(0.04, 1)).toBe("0");
    expect(formatCompactNumber(-0.04, 1)).toBe("0");
    expect(formatCompactNumber(-0, 2)).toBe("0");
  });

  it("agrees with the shared writer on the digits it keeps", () => {
    // The compact form is the shared form minus the leading zero, so the
    // two differ by at most the rounding of one decimal place.
    for (const value of [0.5, -3.25, 12, 408.6, -0.75]) {
      const compact = Number.parseFloat(formatCompactNumber(value, 1));
      const shared = Number.parseFloat(formatNumber(value));
      expect(Math.abs(compact - shared)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("refuses values and precisions it cannot write", () => {
    expect(() => formatCompactNumber(Number.NaN, 1)).toThrow(/finite/);
    expect(() => formatCompactNumber(1, -1)).toThrow(/decimal places/);
    expect(() => formatCompactNumber(1, 4)).toThrow(/decimal places/);
  });
});
