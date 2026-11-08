/**
 * The canvas preview (specification sections 11 and 23).
 *
 * The panel injects the SVG document the engine produced straight into
 * the page - the same bytes the export button writes - scaled by CSS to
 * the space the panel has. The footer shows the output metrics of the
 * trace (specification section 9E): the size of the document, the strokes
 * it draws, the regions they fill, the visual density score, the export
 * timing, and the spec hash that names the render identity (specification
 * sections 9 and 10). The hash is the panel's own determinism check: two
 * edits that claim to change the scene must move it, and an edit that
 * changes nothing must not.
 */

import type { ReactElement } from "react";

import type { OutputMetrics } from "@hatch/core";

/** The props of the canvas panel. */
export interface CanvasProps {
  /** The SVG document of the last render that compiled, or `null`. */
  readonly svg: string | null;
  /** The metrics of the same render, or `null`. */
  readonly metrics: OutputMetrics | null;
  /** The spec hash of the same render, or `null`. */
  readonly specHash: string | null;
}

/** The canvas preview with its metrics footer. */
export function Canvas({ svg, metrics, specHash }: CanvasProps): ReactElement {
  return (
    <section className="panel canvas-panel" aria-label="Canvas preview">
      <h2>Canvas</h2>
      <div
        className="canvas-frame"
        data-testid="canvas"
        // The engine owns every byte of this document: it draws no script
        // and references no resource outside itself, so it enters the
        // page as the markup it is.
        dangerouslySetInnerHTML={svg === null ? undefined : { __html: svg }}
      />
      <p className="canvas-metrics" data-testid="metrics">
        {metrics === null || specHash === null
          ? "no render yet"
          : `${metrics.svgSizeBytes} bytes · ${metrics.strokeCount} strokes · ` +
            `${metrics.regionCount} regions · density ` +
            `${metrics.visualDensityScore.toFixed(3)} · ` +
            `${metrics.exportDurationMs.toFixed(1)} ms · spec hash `}
        {specHash === null ? null : <code data-testid="spec-hash">{specHash}</code>}
      </p>
    </section>
  );
}
