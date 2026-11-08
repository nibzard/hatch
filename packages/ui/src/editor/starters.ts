/**
 * The starter scenes of the editor (specification sections 11 and 23).
 *
 * The editor opens on a scene a reader can recognize from the examples,
 * so the first render of the page is the same artwork the golden fixtures
 * pin. The scenes import from `examples/scenes/`, the one directory the
 * release gate reads too, so the editor never drifts onto a private copy.
 *
 * A starter is `unknown`, not `SceneSpec`: the state model parses it with
 * the same `parseSceneSpec` every imported spec passes, and the parse
 * error of a broken example reaches the error bar instead of a crash.
 */

import mountainLake from "../../../../examples/scenes/mountain-lake-0002.json" with { type: "json" };
import pastoralCreek from "../../../../examples/scenes/pastoral-creek-0001.json" with { type: "json" };

/** One scene the editor can open from the toolbar. */
export interface StarterScene {
  /** The value a `select` option carries. */
  readonly id: string;
  /** The label the option shows. */
  readonly label: string;
  /** The engine input, exactly what a caller hands `renderScene`. */
  readonly spec: unknown;
}

/** Every starter scene, in the order the picker lists them. */
export const STARTER_SCENES: readonly StarterScene[] = [
  {
    id: "pastoral-creek-0001",
    label: "pastoral-creek-0001 (4:3)",
    spec: pastoralCreek,
  },
  {
    id: "mountain-lake-0002",
    label: "mountain-lake-0002 (16:9)",
    spec: mountainLake,
  },
];
