import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'inputMode'
>;

interface Props extends NativeInputProps {
  value: number;
  onChange: (v: number) => void;
  // Optional: invoked with the parsed number once the user finishes editing
  // (blur / Enter), regardless of whether onChange already fired during typing.
  onCommit?: (v: number) => void;
  // Render formatter for the committed number; default trims trailing zeros.
  format?: (v: number) => string;
}

function defaultFormat(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return Number(v.toFixed(3)).toString();
}

// Numeric input that allows transient invalid/empty states while typing
// (`""`, `"-"`, `".5"`, `"3."`, etc.). The displayed string is owned locally
// while the field is focused; on blur it either commits a parseable value
// or reverts to the prop. External prop updates while unfocused replace the
// displayed value.
export function NumberInput({
  value,
  onChange,
  onCommit,
  format = defaultFormat,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  // Sync away the draft whenever the prop changes from the outside while we
  // are unfocused. Drag handles updating the panel are the typical case.
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(null);
  }, [value]);

  const display = draft ?? format(value);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const parsed = parseFloat(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={(e) => {
        const parsed = parseFloat(draft ?? '');
        if (Number.isFinite(parsed)) {
          onChange(parsed);
          onCommit?.(parsed);
        }
        setDraft(null);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}
