/**
 * One numeric input that commits on confirm, not on every keystroke.
 *
 * Typing "0.6" passes through "0" and "0." on the way; a field that
 * dispatched per keystroke would patch the spec with each partial number
 * and reject the ones that parse to nothing. The draft stays local until
 * the user presses Enter or leaves the field, then one commit carries the
 * finished number (or the draft rolls back to the authored value).
 */

import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

/** The props of one numeric field. */
export interface NumberFieldProps {
  /** The label the field shows. */
  readonly label: string;
  /** The authored value the field edits. */
  readonly value: number;
  /** Called once with the confirmed number when it differs from `value`. */
  readonly onCommit: (value: number) => void;
  /** The `data-testid` of the input. */
  readonly testId: string;
  /** The step the input moves by, when the control states one. */
  readonly step?: number;
  /** The smallest accepted value, when the control states one. */
  readonly min?: number;
  /** The largest accepted value, when the control states one. */
  readonly max?: number;
}

/** One numeric input with a label, confirmed on Enter or blur. */
export function NumberField({
  label,
  value,
  onCommit,
  testId,
  step,
  min,
  max,
}: NumberFieldProps): ReactElement {
  const [draft, setDraft] = useState(String(value));

  // The authored value moves whenever another panel patches the same
  // spec field, so the draft follows it and a stale draft never survives
  // a re-render.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const confirm = (): void => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      confirm();
    }
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        data-testid={testId}
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={confirm}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}
