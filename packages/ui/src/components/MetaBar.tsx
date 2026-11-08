/**
 * The toolbar of the editor (specification sections 11 and 23).
 *
 * Three controls of the section 23 list live here because they own the
 * render identity as a whole (specification section 10): the starter
 * scene the page opens, the seed field, and the style preset picker. The
 * seed and the preset patch `meta` directly - specification section 21
 * defines no edit operation for them - and a preset switch clears the
 * style overrides, because their values belong to the preset that wrote
 * them.
 */

import type { ReactElement } from "react";

import type { SceneSpec } from "@hatch/core";

import { engine } from "../editor/engine.js";
import { STARTER_SCENES } from "../editor/starters.js";
import type { EditorAction } from "../editor/state.js";
import { NumberField } from "./NumberField.js";

/** The props of the toolbar. */
export interface MetaBarProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The toolbar with the starter picker, the seed field, and the preset picker. */
export function MetaBar({ spec, dispatch }: MetaBarProps): ReactElement {
  const starters = STARTER_SCENES.some((scene) => scene.id === spec.meta.id)
    ? spec.meta.id
    : "";
  const presets = engine.listPresets();

  return (
    <header className="meta-bar">
      <h1>hatch editor</h1>
      <label className="field">
        <span className="field-label">scene</span>
        <select
          data-testid="starter-select"
          value={starters}
          onChange={(event) => {
            const starter = STARTER_SCENES.find(
              (scene) => scene.id === event.target.value,
            );
            if (starter !== undefined) {
              dispatch({ type: "loadSpec", input: starter.spec });
            }
          }}
        >
          <option value="">imported</option>
          {STARTER_SCENES.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.label}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="seed"
        testId="seed-input"
        value={spec.meta.seed}
        step={1}
        onCommit={(seed) => dispatch({ type: "setSeed", seed })}
      />
      <label className="field">
        <span className="field-label">preset</span>
        <select
          data-testid="preset-select"
          value={spec.meta.stylePreset}
          onChange={(event) =>
            dispatch({ type: "setPreset", presetId: event.target.value })
          }
        >
          {presets.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
