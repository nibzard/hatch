/**
 * Tests for path data conversion: the core path model as one `d` value.
 */

import { describe, expect, it } from "vitest";

import { pathData } from "../src/path-data.js";

import { circlePath, linePath, rectPath } from "./fixtures.js";

describe("pathData", () => {
  it("writes move, line, and close commands", () => {
    expect(pathData(rectPath(10, 20, 30, 40))).toBe("M 10 20l 30 0 0 40-30 0z");
  });

  it("writes an open polyline without a close command", () => {
    expect(
      pathData(linePath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])),
    ).toBe("M 0 0l 5 5 5-5");
  });

  it("writes curve commands with relative deltas", () => {
    expect(
      pathData({
        commands: [
          { command: "move", to: { x: 1, y: 2 } },
          {
            command: "curve",
            to: { x: 7, y: 8 },
            control1: { x: 3, y: 4 },
            control2: { x: 5, y: 6 },
          },
        ],
      }),
    ).toBe("M 1 2c 2 2 4 4 6 6");
  });

  it("keeps every contour of a compound path in one value", () => {
    const compound = {
      commands: [
        ...rectPath(0, 0, 10, 10).commands,
        ...circlePath(5, 5, 2, 4).commands,
      ],
    };
    const d = pathData(compound);
    // One absolute move per value, every later contour a relative one
    // (specification section 22).
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d.match(/m /g)).toHaveLength(1);
    expect(d).toContain("z");
    expect(d.endsWith("z")).toBe(true);
  });

  it("rounds coordinates through the shared number writer", () => {
    expect(
      pathData(linePath([{ x: 0.1 + 0.2, y: 5.00004 }, { x: -0, y: 1.9996 }])),
    ).toBe("M.3 5l-.3-3");
  });

  it("drops only the separators a reader still sees through", () => {
    // A minus sign always glues. A leading dot glues behind the letter or
    // behind a number that carries a dot of its own, but not behind an
    // integer, where `3` and `.5` would read as the one number `3.5`.
    expect(
      pathData(linePath([{ x: 0, y: 0 }, { x: 3, y: 0.5 }, { x: 6, y: 0 }])),
    ).toBe("M 0 0l 3 .5 3-.5");
    expect(pathData(linePath([{ x: 0, y: 0 }, { x: 3.5, y: 0.5 }]))).toBe(
      "M 0 0l 3.5.5",
    );
  });

  it("rounds deltas to whole units when the caller asks for them", () => {
    expect(
      pathData(
        {
          commands: [
            { command: "move", to: { x: 10, y: 20 } },
            { command: "line", to: { x: 40, y: 19 } },
            { command: "line", to: { x: 41, y: 60 } },
          ],
        },
        0,
      ),
    ).toBe("M 10 20l 30-1 1 41");
  });

  it("keeps at least one decimal on the opening pair at whole-unit deltas", () => {
    expect(
      pathData(
        {
          commands: [
            { command: "move", to: { x: 10.4, y: 20.6 } },
            { command: "line", to: { x: 40.6, y: 60.2 } },
          ],
        },
        0,
      ),
    ).toBe("M 10.4 20.6l 30 40");
  });
});
