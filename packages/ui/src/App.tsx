/**
 * The editor page (specification sections 11 and 23).
 *
 * One page, every panel of the section 23 list: the toolbar with the seed
 * field and the preset picker, the layer and object list, the canvas
 * preview, the inspector, the hatch controls, the composition controls,
 * the debug toggles, the spec view, and the export panel.
 *
 * The render loop is one line of data flow: every panel dispatches one
 * action, the state model applies it - through the edit operations of
 * specification section 21 where one exists, as a spec patch otherwise -
 * and the page compiles the updated spec with the same engine the CLI
 * uses. When a render fails, the page keeps the last document that
 * compiled and names the reason in the error bar.
 */

import { useEffect, useMemo, useReducer, useState, type ReactElement } from "react";

import { parseSceneSpec, type RenderResult, type SceneObject } from "@hatch/core";

import { Canvas } from "./components/Canvas.js";
import { CompositionControls } from "./components/CompositionControls.js";
import { DebugToggles } from "./components/DebugToggles.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { HatchControls } from "./components/HatchControls.js";
import { Inspector } from "./components/Inspector.js";
import { MetaBar } from "./components/MetaBar.js";
import { ObjectList } from "./components/ObjectList.js";
import { SpecPanel } from "./components/SpecPanel.js";
import { engine, renderSpec } from "./editor/engine.js";
import {
  createEditorReducer,
  editorStateOf,
  importSpec,
  type EditorState,
} from "./editor/state.js";
import { STARTER_SCENES } from "./editor/starters.js";

/**
 * One valid spec for the degenerate case of no parseable starter. The
 * page must always hold a spec that renders, or no panel has anything to
 * edit.
 */
const EMPTY_SPEC = parseSceneSpec({
  meta: {
    id: "empty",
    seed: 1,
    stylePreset: "pastoral-v1",
    aspectRatio: "4:3",
    version: "1.0.0",
  },
  camera: { framing: "wide", lens: "normal", horizonY: 0.68 },
  composition: {
    focalPoints: [],
    balance: "center",
    negativeSpace: 0.35,
    depthLayers: 1,
  },
  environment: { type: "rural" },
  objects: [],
});

/** Open the page on the first starter scene that parses. */
function initialState(): EditorState {
  for (const starter of STARTER_SCENES) {
    const { spec, error } = importSpec(starter.spec);
    if (spec !== null) {
      return editorStateOf(spec);
    }
    if (error !== null) {
      return { ...editorStateOf(EMPTY_SPEC), error };
    }
  }
  return editorStateOf(EMPTY_SPEC);
}

// One reducer for one engine: the engine is a module singleton, so the
// reducer can be too.
const reducer = createEditorReducer(engine);

/** The editor page. */
export function App(): ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  // One compile per spec change. The spec under edit always parses, so a
  // failure here means the pipeline, not the spec - the page keeps the
  // last good document and shows the reason.
  const render = useMemo(() => renderSpec(state.spec), [state.spec]);
  const [lastGood, setLastGood] = useState<RenderResult | null>(null);
  useEffect(() => {
    if (render.result !== null) {
      setLastGood(render.result);
    }
  }, [render]);

  const shown = render.result ?? lastGood;
  const error = state.error ?? render.error;
  const selected: SceneObject | null =
    state.spec.objects.find((object) => object.id === state.selectedId) ?? null;

  return (
    <div className="editor">
      <MetaBar spec={state.spec} dispatch={dispatch} />
      {error === null ? null : (
        <p className="error-bar" role="alert" data-testid="error">
          {error}
        </p>
      )}
      <main className="layout">
        <div className="column">
          <ObjectList
            spec={state.spec}
            selectedId={state.selectedId}
            dispatch={dispatch}
          />
          <SpecPanel spec={state.spec} dispatch={dispatch} />
        </div>
        <Canvas
          svg={shown === null ? null : shown.svg}
          metrics={shown?.trace.metrics ?? null}
          specHash={shown === null ? null : shown.trace.specHash}
        />
        <div className="column">
          <Inspector object={selected} dispatch={dispatch} />
          <HatchControls spec={state.spec} dispatch={dispatch} />
          <CompositionControls spec={state.spec} dispatch={dispatch} />
          <DebugToggles spec={state.spec} dispatch={dispatch} />
          <ExportPanel
            spec={state.spec}
            svg={shown === null ? null : shown.svg}
          />
        </div>
      </main>
    </div>
  );
}
