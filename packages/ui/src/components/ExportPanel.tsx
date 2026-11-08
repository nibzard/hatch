/**
 * The export panel (specification sections 11, 12, and 23).
 *
 * Two buttons write the artifacts of the scene as files: the SVG button
 * saves the canonical document the engine produced, byte for byte, and
 * the PNG button rasterizes those same bytes through the browser canvas
 * at the pixel width the field names. The aspect ratio follows the
 * document, the way `@hatch/export` fits its rasters.
 *
 * A failure of the raster step - a document the browser will not decode -
 * shows beside the buttons instead of the page error bar, because it
 * concerns the export, not the spec.
 */

import { useState, type ReactElement } from "react";

import type { SceneSpec } from "@hatch/core";

import { downloadBlob, downloadText } from "../editor/download.js";
import { rasterizeSvgToPng } from "../editor/png.js";

/** The props of the export panel. */
export interface ExportPanelProps {
  /** The spec under edit, which names the exported files. */
  readonly spec: SceneSpec;
  /** The SVG document of the last render that compiled, or `null`. */
  readonly svg: string | null;
}

/** The export panel. */
export function ExportPanel({ spec, svg }: ExportPanelProps): ReactElement {
  const [width, setWidth] = useState(480);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exportPng = async (): Promise<void> => {
    if (svg === null) return;
    setBusy(true);
    setError(null);
    try {
      const png = await rasterizeSvgToPng(svg, { mode: "width", value: width });
      downloadBlob(`${spec.meta.id}.png`, png);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label="Export" data-testid="export-panel">
      <h2>Export</h2>
      <div className="row">
        <button
          type="button"
          className="primary"
          data-testid="export-svg"
          disabled={svg === null}
          onClick={() => {
            if (svg !== null) {
              downloadText(`${spec.meta.id}.svg`, svg, "image/svg+xml");
            }
          }}
        >
          Export SVG
        </button>
        <button
          type="button"
          className="primary"
          data-testid="export-png"
          disabled={svg === null || busy}
          onClick={() => {
            void exportPng();
          }}
        >
          Export PNG
        </button>
      </div>
      <label className="field">
        <span className="field-label">png pixel width</span>
        <input
          type="number"
          data-testid="png-width"
          value={width}
          min={1}
          step={1}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isInteger(parsed) && parsed >= 1) {
              setWidth(parsed);
            }
          }}
        />
      </label>
      <p className="hint">
        The SVG is the canonical document. The PNG is one raster of the same
        bytes; offline exports use @hatch/export.
      </p>
      {error === null ? null : (
        <p className="error" data-testid="export-error">
          {error}
        </p>
      )}
    </section>
  );
}
