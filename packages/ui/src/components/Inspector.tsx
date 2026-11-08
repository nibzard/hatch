/**
 * The property inspector (specification sections 11 and 23).
 *
 * The inspector edits one selected object, and every field goes through
 * the edit operations of specification section 21:
 *
 * - the position fields commit one `moveObject`, with the delta between
 *   the authored position and the confirmed number;
 * - the kind, the role, the scale, the rotation, and the params commit
 *   one `replaceObject` patch that keeps every field it leaves out;
 * - the remove button commits one `removeObject`.
 *
 * The panel never writes the objects array itself. Edits patch the spec,
 * never the pixels (specification section 15), so the canvas re-renders
 * from the updated scene language.
 */

import { useEffect, useState, type ReactElement } from "react";

import {
  SceneObjectRoleSchema,
  type JsonValue,
  type SceneObject,
  type SceneObjectRole,
} from "@hatch/core";
import { OBJECT_KINDS } from "@hatch/objects";

import type { EditorAction } from "../editor/state.js";
import { NumberField } from "./NumberField.js";

/** The props of the inspector. */
export interface InspectorProps {
  /** The selected object, or `null` when the selection is empty. */
  readonly object: SceneObject | null;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The inspector panel. */
export function Inspector({ object, dispatch }: InspectorProps): ReactElement {
  const [paramsDraft, setParamsDraft] = useState<string>("");

  // The draft follows the selected object: another panel can replace the
  // object, and the params area must show what the spec now holds.
  useEffect(() => {
    setParamsDraft(JSON.stringify(object?.params ?? {}, null, 2));
  }, [object]);

  if (object === null) {
    return (
      <section className="panel" aria-label="Inspector">
        <h2>Inspector</h2>
        <p className="hint" data-testid="inspector-empty">
          Select one object in the list to edit it.
        </p>
      </section>
    );
  }

  const applyParams = (): void => {
    try {
      // The draft parses as JSON; a value that is no object fails the
      // schema of the operation that carries it, with a readable error.
      const params = JSON.parse(paramsDraft) as Record<string, JsonValue>;
      dispatch({
        type: "applyEdits",
        operations: [
          { op: "replaceObject", id: object.id, with: { kind: object.kind, params } },
        ],
      });
    } catch (error) {
      dispatch({
        type: "reportError",
        message: `params of "${object.id}" hold no valid JSON: ` +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  };

  return (
    <section className="panel" aria-label="Inspector" data-testid="inspector">
      <h2>
        Inspector <code>{object.id}</code>
      </h2>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">kind</span>
          <select
            data-testid="kind"
            value={object.kind}
            onChange={(event) =>
              dispatch({
                type: "applyEdits",
                operations: [
                  {
                    op: "replaceObject",
                    id: object.id,
                    with: { kind: event.target.value },
                  },
                ],
              })
            }
          >
            {OBJECT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">role</span>
          <select
            data-testid="role"
            value={object.role ?? ""}
            onChange={(event) =>
              dispatch({
                type: "applyEdits",
                operations: [
                  {
                    op: "replaceObject",
                    id: object.id,
                    with: {
                      kind: object.kind,
                      role:
                        event.target.value === ""
                          ? undefined
                          : (event.target.value as SceneObjectRole),
                    },
                  },
                ],
              })
            }
          >
            {object.role === undefined ? <option value="">none</option> : null}
            {SceneObjectRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-grid">
        <NumberField
          label="position x"
          testId="pos-x"
          value={object.position.x}
          step={0.01}
          min={0}
          max={1}
          onCommit={(x) =>
            dispatch({
              type: "applyEdits",
              operations: [
                {
                  op: "moveObject",
                  id: object.id,
                  dx: x - object.position.x,
                  dy: 0,
                },
              ],
            })
          }
        />
        <NumberField
          label="position y"
          testId="pos-y"
          value={object.position.y}
          step={0.01}
          min={0}
          max={1}
          onCommit={(y) =>
            dispatch({
              type: "applyEdits",
              operations: [
                {
                  op: "moveObject",
                  id: object.id,
                  dx: 0,
                  dy: y - object.position.y,
                },
              ],
            })
          }
        />
      </div>
      <div className="field-grid">
        <NumberField
          label="scale"
          testId="scale"
          value={object.scale}
          step={0.1}
          min={0.05}
          onCommit={(scale) =>
            dispatch({
              type: "applyEdits",
              operations: [
                { op: "replaceObject", id: object.id, with: { kind: object.kind, scale } },
              ],
            })
          }
        />
        <NumberField
          label="rotation"
          testId="rotation"
          value={object.rotation ?? 0}
          step={1}
          onCommit={(rotation) =>
            dispatch({
              type: "applyEdits",
              operations: [
                {
                  op: "replaceObject",
                  id: object.id,
                  with: { kind: object.kind, rotation },
                },
              ],
            })
          }
        />
      </div>
      <label className="field">
        <span className="field-label">params (JSON)</span>
        <textarea
          data-testid="params"
          rows={6}
          spellCheck={false}
          value={paramsDraft}
          onChange={(event) => setParamsDraft(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="button" data-testid="apply-params" onClick={applyParams}>
          Apply params
        </button>
        <button
          type="button"
          className="danger"
          data-testid="remove-object"
          onClick={() =>
            dispatch({
              type: "applyEdits",
              operations: [{ op: "removeObject", id: object.id }],
            })
          }
        >
          Remove object
        </button>
      </div>
    </section>
  );
}
