/**
 * The debug toggles (specification sections 5, 9, 11, and 23).
 *
 * One checkbox per debug flag, in the draw order the overlays stack in.
 * Each toggle patches the `debug` block of the spec, and the renderer
 * adds one overlay layer per enabled flag; with every flag off the spec
 * carries no debug block at all, which keeps the three spellings of
 * "every overlay off" byte-identical (specification section 9).
 */

import type { ReactElement } from "react";

import { DEBUG_FLAG_NAMES, type SceneSpec } from "@hatch/core";

import type { EditorAction } from "../editor/state.js";

/** The props of the debug toggles. */
export interface DebugTogglesProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The debug toggles panel. */
export function DebugToggles({ spec, dispatch }: DebugTogglesProps): ReactElement {
  return (
    <section className="panel" aria-label="Debug toggles" data-testid="debug-toggles">
      <h2>Debug</h2>
      {DEBUG_FLAG_NAMES.map((flag) => (
        <label key={flag} className="check">
          <input
            type="checkbox"
            data-testid={`debug-${flag}`}
            checked={spec.debug?.[flag] === true}
            onChange={(event) =>
              dispatch({
                type: "setDebugFlag",
                flag,
                on: event.target.checked,
              })
            }
          />
          {flag}
        </label>
      ))}
    </section>
  );
}
