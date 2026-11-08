/**
 * The spec panel (specification sections 5, 11, and 23).
 *
 * The structured scene language is the editing object, so the editor
 * keeps it visible and re-openable: the area holds the JSON of the spec
 * under edit, the Apply button loads what the area holds through the
 * same parse every spec passes, the file input opens a spec from disk,
 * and the download button saves the spec as the JSON a later session
 * re-opens. This is the round trip of the editor - load, edit, save -
 * in one panel.
 */

import { useEffect, useState, type ReactElement } from "react";

import type { SceneSpec } from "@hatch/core";

import { downloadText } from "../editor/download.js";
import type { EditorAction } from "../editor/state.js";

/** The props of the spec panel. */
export interface SpecPanelProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The spec view and import panel. */
export function SpecPanel({ spec, dispatch }: SpecPanelProps): ReactElement {
  const [draft, setDraft] = useState(() => JSON.stringify(spec, null, 2));
  const [error, setError] = useState<string | null>(null);

  // The draft follows the spec, because every other panel writes it.
  useEffect(() => {
    setDraft(JSON.stringify(spec, null, 2));
    setError(null);
  }, [spec]);

  const apply = (): void => {
    try {
      dispatch({ type: "loadSpec", input: JSON.parse(draft) });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const open = async (file: File): Promise<void> => {
    try {
      dispatch({ type: "loadSpec", input: JSON.parse(await file.text()) });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section className="panel" aria-label="Scene spec" data-testid="spec-panel">
      <h2>Spec</h2>
      <textarea
        data-testid="spec-json"
        className="spec-json"
        rows={12}
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="row">
        <button type="button" className="primary" data-testid="apply-spec" onClick={apply}>
          Apply spec
        </button>
        <label className="button-label">
          Open file
          <input
            type="file"
            accept="application/json,.json"
            data-testid="open-spec"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void open(file);
              }
              // Let the same file open twice in a row.
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          data-testid="download-spec"
          onClick={() =>
            downloadText(
              `${spec.meta.id}.json`,
              JSON.stringify(spec, null, 2),
              "application/json",
            )
          }
        >
          Download spec
        </button>
      </div>
      {error === null ? null : (
        <p className="error" data-testid="spec-error">
          {error}
        </p>
      )}
    </section>
  );
}
