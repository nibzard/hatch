/**
 * The hatch controls (specification sections 11 and 23).
 *
 * One section per hatch family of the style grammar: the regular families
 * carry `angle`, `spacing`, `weight`, and `jitter`; the crosshatch
 * families carry `angleA`, `angleB`, `spacingA`, `spacingB`, and the two
 * shared knobs. The fields read the resolved style - the spec's preset
 * with its overrides merged in - so a control always shows the value the
 * next render uses, whatever preset wrote it.
 *
 * Every field commits one `setStyle` operation with a dotted path into
 * `hatchFamilies`, which is the one style input a scene spec owns
 * (specification sections 5 and 21). A value the grammar refuses lands
 * in the error bar, and the spec keeps its last valid state.
 */

import type { ReactElement } from "react";

import type { SceneSpec } from "@hatch/core";
import { resolveStyle } from "@hatch/styles";

import type { EditorAction } from "../editor/state.js";
import { NumberField } from "./NumberField.js";

/** The fields of one regular hatch family. */
const HATCH_FIELDS = [
  { field: "angle", label: "angle", step: 1 },
  { field: "spacing", label: "spacing", step: 0.5 },
  { field: "weight", label: "weight", step: 0.05 },
  { field: "jitter", label: "jitter", step: 0.1 },
] as const;

/** The fields of one crosshatch family. */
const CROSSHATCH_FIELDS = [
  { field: "angleA", label: "angle A", step: 1 },
  { field: "angleB", label: "angle B", step: 1 },
  { field: "spacingA", label: "spacing A", step: 0.5 },
  { field: "spacingB", label: "spacing B", step: 0.5 },
  { field: "weight", label: "weight", step: 0.05 },
  { field: "jitter", label: "jitter", step: 0.1 },
] as const;

/** The props of the hatch controls. */
export interface HatchControlsProps {
  /** The spec under edit. */
  readonly spec: SceneSpec;
  /** The dispatch of the editor. */
  readonly dispatch: (action: EditorAction) => void;
}

/** The hatch controls panel, one field set per hatch family. */
export function HatchControls({ spec, dispatch }: HatchControlsProps): ReactElement {
  // The resolved style carries the merged view: preset values with the
  // spec's overrides applied. A resolve failure (a dropped preset) leaves
  // the panel empty; the error bar names the reason.
  let families: { name: string; values: Record<string, unknown>; cross: boolean }[] = [];
  try {
    const style = resolveStyle(spec.meta.stylePreset, spec.styleOverrides);
    families = Object.entries(style.hatchFamilies).map(([name, family]) => ({
      name,
      values: family as unknown as Record<string, unknown>,
      cross: "angleA" in family,
    }));
  } catch {
    families = [];
  }

  return (
    <section className="panel" aria-label="Hatch controls" data-testid="hatch-controls">
      <h2>Hatch</h2>
      {families.length === 0 ? (
        <p className="hint">the style of this preset did not resolve</p>
      ) : (
        families.map((family, index) => (
          <details key={family.name} className="family" open={index === 0}>
            <summary>{family.name}</summary>
            <div className="field-grid">
              {(family.cross ? CROSSHATCH_FIELDS : HATCH_FIELDS).map(
                ({ field, label, step }) => (
                  <NumberField
                    key={field}
                    label={label}
                    testId={`hatch-${family.name}-${field}`}
                    value={family.values[field] as number}
                    step={step}
                    onCommit={(value) =>
                      dispatch({
                        type: "applyEdits",
                        operations: [
                          {
                            op: "setStyle",
                            path: `hatchFamilies.${family.name}.${field}`,
                            value,
                          },
                        ],
                      })
                    }
                  />
                ),
              )}
            </div>
          </details>
        ))
      )}
    </section>
  );
}
