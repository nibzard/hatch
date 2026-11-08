/**
 * Path data: the core path model as one SVG `d` string (specification
 * sections 7 and 11).
 *
 * @hatch/core stores paths as JSON-safe pen commands. The renderer walks
 * them once and writes the SVG letter for each command. A compound path,
 * which the boolean helpers produce when a mask carves holes into a region,
 * keeps all its contours in one `d` value (specification section 22).
 *
 * Every command after the opening move is relative, because one hatch
 * stroke is a long chain of small steps along a line: the distance from one
 * sample to the next is a fraction of the distance from the origin, so the
 * delta costs a fraction of the digits (task T036). The numbers carry no
 * leading zero before the decimal point, and the separator between two
 * numbers drops away wherever the next one starts with a minus sign or a
 * dot, which the path grammar of SVG allows. Both forms parse in every
 * consumer of this document: the raster export, the PDF export, and a
 * browser.
 *
 * The writer rounds a delta, then moves its pen by the rounded value, so
 * the pen of a reader that adds the deltas up stays on the pen of the
 * writer. The rounding error of a whole path is bounded by half a step
 * quantum; it never accumulates along the chain.
 */

import type { Path } from "@hatch/core";

import { formatCompactNumber } from "./format.js";

/** Decimal places of the absolute opening pair of every subpath. */
const START_DECIMALS = 1;

/** Decimal places of every relative coordinate after the opening pair. */
const DELTA_DECIMALS = 1;

/** One `d` value under construction. */
class PathDataWriter {
  private readonly parts: string[] = [];
  /**
   * Decimal places of every relative coordinate this writer rounds to. The
   * opening pair of a subpath keeps at least one, so the value names where
   * the path sits on the canvas even when the deltas snap to whole units.
   */
  private readonly deltaDecimals: number;
  /** The command letter last written, which a repeat may leave out. */
  private letter = "";
  /**
   * The number text last written. A command letter resets it, because a
   * letter is a boundary no number can grow across.
   */
  private lastNumber = "";
  /** The pen of a reader that adds the emitted deltas up. */
  private x = 0;
  private y = 0;
  /** Where the current subpath opened, which a close returns the pen to. */
  private startX = 0;
  private startY = 0;

  constructor(deltaDecimals: number) {
    this.deltaDecimals = deltaDecimals;
  }

  /**
   * Write one command letter with its deltas, and report the deltas as the
   * reader reads them.
   *
   * A letter that repeats the previous one drops away, because the path
   * grammar repeats the last command for every further group of numbers.
   * Only the drawing letters repeat: a move that repeats would read as a
   * line, and a close takes no numbers at all.
   *
   * The separator between two numbers drops away only where a reader still
   * sees two numbers. A minus sign cannot open another number's digits, so
   * it always glues. A leading dot glues only behind a boundary or behind a
   * number that already carries a dot of its own, because `1` and `.3`
   * would read as the one number `1.3`, while `1.3` and `.5` stay two
   * numbers under the greedy reading the path grammar states.
   */
  private write(
    letter: string,
    deltas: readonly number[],
    decimals: number,
  ): number[] {
    if (letter !== this.letter) {
      this.parts.push(letter);
      this.letter = letter;
      this.lastNumber = "";
    }
    const read: number[] = [];
    for (const delta of deltas) {
      const text = formatCompactNumber(delta, decimals);
      const glue =
        text.startsWith("-") ||
        (text.startsWith(".") &&
          (this.lastNumber === "" || this.lastNumber.includes(".")));
      this.parts.push(glue ? "" : " ", text);
      read.push(Number.parseFloat(text));
      this.lastNumber = text;
    }
    return read;
  }

  /** Move the pen, as the opening pair of a subpath. */
  moveTo(x: number, y: number, opening: boolean): void {
    const read = this.write(
      opening ? "M" : "m",
      [x - this.x, y - this.y],
      Math.max(START_DECIMALS, this.deltaDecimals),
    );
    this.x += read[0] ?? 0;
    this.y += read[1] ?? 0;
    this.startX = this.x;
    this.startY = this.y;
  }

  /** Draw one straight step to a position relative to the pen. */
  lineTo(x: number, y: number): void {
    const read = this.write("l", [x - this.x, y - this.y], this.deltaDecimals);
    this.x += read[0] ?? 0;
    this.y += read[1] ?? 0;
  }

  /** Draw one cubic step, by the offsets of its two handles and its end. */
  curveTo(
    control1: { x: number; y: number },
    control2: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const read = this.write(
      "c",
      [
        control1.x - this.x,
        control1.y - this.y,
        control2.x - this.x,
        control2.y - this.y,
        to.x - this.x,
        to.y - this.y,
      ],
      this.deltaDecimals,
    );
    this.x += read[4] ?? 0;
    this.y += read[5] ?? 0;
  }

  /** Close the current subpath. Numbers cannot follow, so a letter must. */
  close(): void {
    this.parts.push("z");
    this.letter = "";
    this.lastNumber = "";
    this.x = this.startX;
    this.y = this.startY;
  }

  /** The finished `d` value. */
  toString(): string {
    return this.parts.join("");
  }
}

/**
 * Convert one path into its `d` attribute value.
 *
 * The first move is absolute, so the value names where the path sits on the
 * canvas. Every later command is relative to the one before it. Numbers
 * format through the shared writer, so the same path always yields the same
 * string.
 *
 * `deltaDecimals` sets the precision of every coordinate after the opening
 * pair. The default of one decimal place suits the drawn contours, whose
 * geometry is the picture; a caller that already holds an error budget,
 * like the hatch stroke writer of task T036, passes `0` to round its deltas
 * to whole units, which spends no digits on precision the budget already
 * writes off.
 */
export function pathData(path: Path, deltaDecimals: number = DELTA_DECIMALS): string {
  const writer = new PathDataWriter(deltaDecimals);
  let opening = true;
  for (const command of path.commands) {
    switch (command.command) {
      case "move":
        writer.moveTo(command.to.x, command.to.y, opening);
        opening = false;
        break;
      case "line":
        writer.lineTo(command.to.x, command.to.y);
        break;
      case "curve":
        writer.curveTo(command.control1, command.control2, command.to);
        break;
      case "close":
        writer.close();
        break;
    }
  }
  return writer.toString();
}
