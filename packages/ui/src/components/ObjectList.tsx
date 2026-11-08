/**
 * The layer and object list (specification sections 11 and 23).
 *
 * Every scene object takes one draw role (specification section 5), and
 * the depth stack draws the roles back to front: background, midground,
 * foreground, focal. The list groups the objects under those layers, with
 * the unassigned objects after them, so the page reads like the depth
 * order the planner builds.
 *
 * Selecting one object opens it in the inspector. The remove button of a
 * row and the add form at the foot both go through the edit operations of
 * specification section 21 - `removeObject` and `addObject` - so the list
 * never writes the objects array itself.
 */

import { useState, type ReactElement } from "react";

import { OBJECT_KINDS } from "@hatch/objects";
import type { SceneObject, SceneSpec } from "@hatch/core";

import type { EditorAction } from "../editor/state.js";

/** The draw roles in depth order, the layers of the list. */
export const LAYER_ROLES = ["background", "midground", "foreground", "focal"] as const;

/** The props of the object list. */
export interface ObjectListProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The selected object id, or `null`. */
  readonly selectedId: string | null;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** One id no object of the scene carries yet, for the add form. */
function freshId(spec: SceneSpec, kind: string): string {
  const taken = new Set(spec.objects.map((object) => object.id));
  let index = 1;
  while (taken.has(`${kind}-${index}`)) {
    index += 1;
  }
  return `${kind}-${index}`;
}

/** One object row. */
function ObjectRow({
  object,
  selected,
  dispatch,
}: {
  readonly object: SceneObject;
  readonly selected: boolean;
  readonly dispatch: (action: EditorAction) => void;
}): ReactElement {
  return (
    <div className={`object-row${selected ? " selected" : ""}`}>
      <button
        type="button"
        className="object-select"
        data-testid={`object-${object.id}`}
        onClick={() => dispatch({ type: "selectObject", id: object.id })}
      >
        <span className="object-kind">{object.kind}</span>
        <span className="object-id">{object.id}</span>
      </button>
      <button
        type="button"
        className="object-remove"
        title={`Remove ${object.id}`}
        data-testid={`delete-${object.id}`}
        onClick={() =>
          dispatch({
            type: "applyEdits",
            operations: [{ op: "removeObject", id: object.id }],
          })
        }
      >
        ×
      </button>
    </div>
  );
}

/** The layer and object list with the add form. */
export function ObjectList({
  spec,
  selectedId,
  dispatch,
}: ObjectListProps): ReactElement {
  const [kind, setKind] = useState<string>(OBJECT_KINDS[0]!);
  const [id, setId] = useState<string>("");

  const layers = [...LAYER_ROLES, null] as const;
  const objectsOf = (role: (typeof LAYER_ROLES)[number] | null): SceneObject[] =>
    spec.objects.filter((object) =>
      role === null ? object.role === undefined : object.role === role,
    );

  const add = (): void => {
    const objectId = id.trim() === "" ? freshId(spec, kind) : id.trim();
    dispatch({
      type: "applyEdits",
      operations: [
        {
          op: "addObject",
          object: {
            id: objectId,
            kind,
            position: { x: 0.5, y: 0.8 },
            scale: 1,
          },
        },
      ],
    });
    setId("");
  };

  return (
    <section className="panel" aria-label="Objects">
      <h2>Layers</h2>
      <div className="object-list" data-testid="object-list">
        {layers.flatMap((role) => {
          const objects = objectsOf(role);
          if (objects.length === 0) {
            return [];
          }
          return [
            <h3 key={role ?? "none"} className="layer-name">
              {role ?? "no role"}
            </h3>,
            ...objects.map((object) => (
              <ObjectRow
                key={object.id}
                object={object}
                selected={object.id === selectedId}
                dispatch={dispatch}
              />
            )),
          ];
        })}
      </div>
      <div className="add-form">
        <h3>Add object</h3>
        <label className="field">
          <span className="field-label">kind</span>
          <select
            data-testid="add-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {OBJECT_KINDS.map((objectKind) => (
              <option key={objectKind} value={objectKind}>
                {objectKind}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">id</span>
          <input
            type="text"
            data-testid="add-id"
            value={id}
            placeholder={freshId(spec, kind)}
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary"
          data-testid="add-object"
          onClick={add}
        >
          Add
        </button>
      </div>
    </section>
  );
}
