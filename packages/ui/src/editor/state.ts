/**
 * The editor state model (specification sections 15, 21, and 23).
 *
 * The scene spec is the primary editing object (section 15), so the state
 * holds one spec and every panel action resolves to one of two writes:
 *
 * - an edit operation of specification section 21, applied through
 *   `engine.editScene` - every object edit and every style edit the
 *   inspector, the object list, and the hatch controls make;
 * - a direct patch of one spec block - seed, preset, camera, composition,
 *   debug flags - because section 21 defines no operation for them, and
 *   the editor writes them in the structured scene language itself.
 *
 * Every write validates before it commits. An action that cannot apply -
 * a `setStyle` path the grammar does not define, a camera horizon outside
 * the frame - lands in `error` and leaves the spec untouched, so the
 * canvas keeps showing the last scene that rendered. The panel that made
 * the request can show the message next to its control; the error bar
 * shows it once for the whole page.
 */

import type { SceneEditOperation } from "@hatch/agent";
import {
  parseSceneSpec,
  type Camera,
  type Composition,
  type DebugFlagName,
  type EnvironmentType,
  type SceneMeta,
  type SceneSpec,
} from "@hatch/core";

/**
 * What the editor needs from the compiler. `HatchEngine` satisfies this
 * with the operations of `@hatch/agent` wired in, which is what
 * `createV1Engine()` builds; tests pass the same engine.
 */
export interface EditorEngine {
  /** Apply the edit operations of specification section 21 to one spec. */
  editScene(input: unknown, operations: readonly unknown[]): SceneSpec;
  /** Every registered preset id. */
  listPresets(): string[];
  /**
   * The environment family one preset draws, when it declares one. The
   * preset picker reads it to keep the environment pair of the spec valid.
   */
  presetEnvironmentType(presetId: string): EnvironmentType | undefined;
}

/** The state of the editor page. */
export interface EditorState {
  /** The spec under edit. It always parses, because writes validate. */
  readonly spec: SceneSpec;
  /** The object the inspector shows, or `null` when none is selected. */
  readonly selectedId: string | null;
  /** The message of the last rejected action, or `null` when all applied. */
  readonly error: string | null;
}

/** Every action the panels dispatch. */
export type EditorAction =
  /** Load one complete spec, from a starter scene or an imported file. */
  | { type: "loadSpec"; input: unknown }
  /** Select the object the inspector shows. */
  | { type: "selectObject"; id: string | null }
  /** Apply edit operations of specification section 21, in order. */
  | { type: "applyEdits"; operations: readonly SceneEditOperation[] }
  /** Write the seed field (specification section 23: seed field). */
  | { type: "setSeed"; seed: number }
  /** Pick one style preset (specification section 23: preset picker). */
  | { type: "setPreset"; presetId: string }
  /** Patch camera controls (specification section 23: composition controls). */
  | { type: "patchCamera"; patch: Partial<Camera> }
  /** Patch composition controls. */
  | { type: "patchComposition"; patch: Partial<Composition> }
  /** Switch one debug overlay flag on or off (specification sections 9, 23). */
  | { type: "setDebugFlag"; flag: DebugFlagName; on: boolean }
  /** Report one panel-local failure, for example unparseable params JSON. */
  | { type: "reportError"; message: string };

/** One state with one spec and nothing selected. */
export function editorStateOf(spec: SceneSpec): EditorState {
  return { spec, selectedId: null, error: null };
}

/**
 * Parse one unknown input as the next spec of the editor.
 *
 * This is the gate every complete-spec write passes: a starter scene, an
 * imported file, the spec panel's Apply button. A readable parse error is
 * the return value's `error`, never a thrown one, so the page stays up.
 */
export function importSpec(input: unknown): { spec: SceneSpec | null; error: string | null } {
  try {
    return { spec: parseSceneSpec(input), error: null };
  } catch (error) {
    return { spec: null, error: messageOf(error) };
  }
}

/** The readable message of one thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The spec with every optional block the patch leaves out kept as authored. */
function withSpec(spec: SceneSpec, patch: Partial<SceneSpec>): SceneSpec {
  const stated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      stated[key] = value;
    }
  }
  return { ...spec, ...stated } as SceneSpec;
}

/** True when `id` names an object of the spec. */
function selectsObject(spec: SceneSpec, id: string | null): string | null {
  return id !== null && spec.objects.some((object) => object.id === id)
    ? id
    : null;
}

/**
 * Build the editor reducer over one engine.
 *
 * The engine enters as a parameter, not an import, so the model stays a
 * pure module the Node unit suite can exercise with the real V1 engine.
 */
export function createEditorReducer(
  engine: EditorEngine,
): (state: EditorState, action: EditorAction) => EditorState {
  /**
   * Commit one candidate spec, or keep the current one and report why.
   * A spec that reaches this path always re-parses first, so the state
   * invariant - the spec under edit is valid - holds after every action.
   */
  const commit = (
    state: EditorState,
    candidate: unknown,
  ): EditorState => {
    const { spec, error } = importSpec(candidate);
    if (spec === null) {
      return { ...state, error };
    }
    return {
      spec,
      selectedId: selectsObject(spec, state.selectedId),
      error: null,
    };
  };

  return (state, action): EditorState => {
    switch (action.type) {
      case "loadSpec": {
        const { spec, error } = importSpec(action.input);
        if (spec === null) {
          return { ...state, error };
        }
        return { spec, selectedId: null, error: null };
      }

      case "selectObject": {
        return {
          ...state,
          selectedId: selectsObject(state.spec, action.id),
          error: null,
        };
      }

      case "applyEdits": {
        // The one write that goes through the edit operations: the engine
        // applies them to the spec, never to pixels (section 15), and an
        // operation that cannot apply throws one error that names it.
        try {
          return commit(
            state,
            engine.editScene(state.spec, action.operations),
          );
        } catch (error) {
          return { ...state, error: messageOf(error) };
        }
      }

      case "setSeed": {
        // meta.seed must stay an integer; the parse below enforces the
        // rest of the meta block.
        const meta: SceneMeta = { ...state.spec.meta, seed: action.seed };
        return commit(state, withSpec(state.spec, { meta }));
      }

      case "setPreset": {
        if (!engine.listPresets().includes(action.presetId)) {
          return {
            ...state,
            error: `unknown style preset '${action.presetId}'; available presets: ` +
              engine.listPresets().join(", "),
          };
        }
        // The environment follows the preset. The intent stage checks the
        // family the preset draws against the type the spec names, so a
        // picker that moved one without the other would leave the page
        // holding a spec that no longer renders. A spec that says `custom`
        // keeps its word: the author picked the pair, not the picker.
        const family = engine.presetEnvironmentType(action.presetId);
        const type = state.spec.environment.type;
        const environment =
          type !== "custom" && family !== undefined && family !== type
            ? { ...state.spec.environment, type: family }
            : state.spec.environment;
        // Style overrides were written against the grammar of the preset
        // they edited, as whole sections with absolute values. Under a new
        // preset they would resolve but say nothing about it, so the picker
        // starts the new preset clean.
        const { styleOverrides: _cleared, ...rest } = state.spec;
        return commit(state, {
          ...rest,
          environment,
          meta: { ...rest.meta, stylePreset: action.presetId },
        });
      }

      case "patchCamera": {
        return commit(state, {
          ...state.spec,
          camera: { ...state.spec.camera, ...action.patch },
        });
      }

      case "patchComposition": {
        return commit(state, {
          ...state.spec,
          composition: { ...state.spec.composition, ...action.patch },
        });
      }

      case "setDebugFlag": {
        const debug = { ...state.spec.debug, [action.flag]: action.on };
        // The three spellings of "every overlay off" must agree (section
        // 9), so a block with no flag on carries none at all. Removing the
        // key needs the destructure: a spread patch that sets `debug` to
        // undefined would leave the old block in place.
        const { debug: _replaced, ...withoutDebug } = state.spec;
        const anyOn = Object.values(debug).some((value) => value === true);
        return commit(state, anyOn ? { ...state.spec, debug } : withoutDebug);
      }

      case "reportError": {
        return { ...state, error: action.message };
      }
    }
  };
}
