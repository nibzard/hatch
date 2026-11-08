/**
 * The camera and composition controls (specification sections 5, 11, 23).
 *
 * One panel for the two blocks that drive the layout and the ink of the
 * render: the camera (framing, lens, horizon, tilt, perspective strength)
 * and the composition (balance, negative space, depth layers, focal
 * points). The camera fields and three of the composition fields drive the
 * planning stage; `negativeSpace` drives the style application stage,
 * which opens every hatch spacing by the distance from the floor of the
 * preset. These blocks carry scene language, not style, so specification
 * section 21 defines no edit operation for them; the panel patches the
 * spec blocks directly, which is the section 15 rule - edits patch the
 * spec - applied to the controls the section 23 list names.
 *
 * The focal points pick from the objects the spec carries. A name no
 * object carries is rejected by the schema, so the checkboxes can only
 * write names that parse.
 */

import type { ReactElement } from "react";

import {
  BalanceSchema,
  FramingSchema,
  LensSchema,
  type SceneSpec,
} from "@hatch/core";

import type { EditorAction } from "../editor/state.js";
import { NumberField } from "./NumberField.js";

/** The props of the composition controls. */
export interface CompositionControlsProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The camera and composition controls panel. */
export function CompositionControls({
  spec,
  dispatch,
}: CompositionControlsProps): ReactElement {
  const { camera, composition } = spec;

  return (
    <section
      className="panel"
      aria-label="Composition controls"
      data-testid="composition-controls"
    >
      <h2>Camera</h2>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">framing</span>
          <select
            data-testid="framing"
            value={camera.framing}
            onChange={(event) =>
              dispatch({
                type: "patchCamera",
                patch: { framing: event.target.value as (typeof FramingSchema.options)[number] },
              })
            }
          >
            {FramingSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">lens</span>
          <select
            data-testid="lens"
            value={camera.lens}
            onChange={(event) =>
              dispatch({
                type: "patchCamera",
                patch: { lens: event.target.value as (typeof LensSchema.options)[number] },
              })
            }
          >
            {LensSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-grid">
        <NumberField
          label="horizon y"
          testId="horizon-y"
          value={camera.horizonY}
          step={0.01}
          min={0}
          max={1}
          onCommit={(horizonY) =>
            dispatch({ type: "patchCamera", patch: { horizonY } })
          }
        />
        <NumberField
          label="tilt"
          testId="tilt"
          value={camera.tilt ?? 0}
          step={0.5}
          onCommit={(tilt) => dispatch({ type: "patchCamera", patch: { tilt } })}
        />
      </div>
      <NumberField
        label="perspective strength"
        testId="perspective-strength"
        value={camera.perspectiveStrength ?? 1}
        step={0.1}
        min={0}
        onCommit={(perspectiveStrength) =>
          dispatch({ type: "patchCamera", patch: { perspectiveStrength } })
        }
      />
      <h2>Composition</h2>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">balance</span>
          <select
            data-testid="balance"
            value={composition.balance}
            onChange={(event) =>
              dispatch({
                type: "patchComposition",
                patch: {
                  balance: event.target.value as (typeof BalanceSchema.options)[number],
                },
              })
            }
          >
            {BalanceSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="depth layers"
          testId="depth-layers"
          value={composition.depthLayers}
          step={1}
          min={0}
          max={4}
          onCommit={(depthLayers) =>
            dispatch({ type: "patchComposition", patch: { depthLayers } })
          }
        />
      </div>
      <NumberField
        label="negative space"
        testId="negative-space"
        value={composition.negativeSpace}
        step={0.05}
        min={0}
        max={1}
        onCommit={(negativeSpace) =>
          dispatch({ type: "patchComposition", patch: { negativeSpace } })
        }
      />
      <p className="hint">
        the share of the paper kept free of hatch ink: each 0.1 above the
        floor of the preset opens every hatch spacing by 12 percent, and each
        0.1 below tightens it
      </p>
      <fieldset className="field">
        <legend className="field-label">focal points</legend>
        {spec.objects.length === 0 ? (
          <p className="hint">the scene carries no object to focus on</p>
        ) : (
          spec.objects.map((object) => (
            <label key={object.id} className="check">
              <input
                type="checkbox"
                data-testid={`focal-${object.id}`}
                checked={composition.focalPoints.includes(object.id)}
                onChange={(event) => {
                  const focalPoints = event.target.checked
                    ? [...composition.focalPoints, object.id]
                    : composition.focalPoints.filter((id) => id !== object.id);
                  dispatch({ type: "patchComposition", patch: { focalPoints } });
                }}
              />
              {object.id}
            </label>
          ))
        )}
      </fieldset>
    </section>
  );
}
