import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import { NumberInput } from './NumberInput';

interface Props {
  open: boolean;
  onClose: () => void;
}

function LinkIcon({ locked }: { locked: boolean }) {
  // Two interlocked link halves (closed) vs separated halves (open). 14×14
  // viewBox keeps strokes crisp at the 16px button size.
  if (locked) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.5 8.5 L8.5 5.5" />
        <path d="M4 7 L2.5 8.5 a2.12 2.12 0 0 0 3 3 L7 10" />
        <path d="M10 7 L11.5 5.5 a2.12 2.12 0 0 0 -3 -3 L7 4" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7 L2.5 8.5 a2.12 2.12 0 0 0 3 3 L7 10" />
      <path d="M10 7 L11.5 5.5 a2.12 2.12 0 0 0 -3 -3 L7 4" />
    </svg>
  );
}

type SizeUnit = 'px' | '%';

interface SizeSectionState {
  // Always stored in px (truth). Display converts to the chosen unit.
  w: number;
  h: number;
  unit: SizeUnit;
  lockAspect: boolean;
  stretch: boolean;
}

function pxToDisplay(px: number, basis: number, unit: SizeUnit): number {
  return unit === 'px' ? px : (px / basis) * 100;
}

function displayToPx(display: number, basis: number, unit: SizeUnit): number {
  return unit === 'px' ? display : (display / 100) * basis;
}

interface SectionProps {
  label: string;
  hint: string;
  initial: [number, number];
  state: SizeSectionState;
  setState: (s: SizeSectionState) => void;
}

function SizeSection({ label, hint, initial, state, setState }: SectionProps) {
  const aspect = initial[0] / initial[1];
  const [iw, ih] = initial;

  // Pixel commits: lock-aspect snaps the orthogonal axis from the ORIGINAL
  // aspect (not state.w/state.h) so repeated small edits don't drift.
  const commitW = (wPx: number) => {
    if (!Number.isFinite(wPx) || wPx <= 0) return;
    const wR = Math.max(1, Math.round(wPx));
    setState({
      ...state,
      w: wR,
      h: state.lockAspect ? Math.max(1, Math.round(wR / aspect)) : state.h,
    });
  };
  const commitH = (hPx: number) => {
    if (!Number.isFinite(hPx) || hPx <= 0) return;
    const hR = Math.max(1, Math.round(hPx));
    setState({
      ...state,
      h: hR,
      w: state.lockAspect ? Math.max(1, Math.round(hR * aspect)) : state.w,
    });
  };

  // Display values in the current unit.
  const wDisp = pxToDisplay(state.w, iw, state.unit);
  const hDisp = pxToDisplay(state.h, ih, state.unit);

  // 1-unit step for ±: 1px or 1% (mapped through the basis).
  const stepW = state.unit === 'px' ? 1 : iw / 100;
  const stepH = state.unit === 'px' ? 1 : ih / 100;

  const setUnit = (unit: SizeUnit) => setState({ ...state, unit });

  const dirty = state.w !== iw || state.h !== ih;

  // Round display so we don't show "100.000000001%" after px↔% round-trips.
  const fmt = (n: number) => (state.unit === 'px' ? Math.round(n) : Math.round(n * 100) / 100);

  return (
    <fieldset className="canvas-size-section">
      <legend>{label}</legend>
      <p className="canvas-size-hint">{hint}</p>
      <div className="size-grid">
        <label className="size-grid-label" htmlFor={`${label}-w`}>
          Width:
        </label>
        <div className="size-input-group">
          <NumberInput
            id={`${label}-w`}
            value={fmt(wDisp)}
            onChange={(v) => commitW(displayToPx(v, iw, state.unit))}
            aria-label={`${label} width`}
          />
          <button
            type="button"
            className="step-btn"
            title={`−${state.unit === 'px' ? '1' : '1%'}`}
            onClick={() => commitW(state.w - stepW)}
          >
            −
          </button>
          <button
            type="button"
            className="step-btn"
            title={`+${state.unit === 'px' ? '1' : '1%'}`}
            onClick={() => commitW(state.w + stepW)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="size-unit-toggle"
          title={`Click to switch to ${state.unit === 'px' ? '%' : 'px'}`}
          onClick={() => setUnit(state.unit === 'px' ? '%' : 'px')}
        >
          {state.unit}
        </button>
        <button
          type="button"
          className={'aspect-lock' + (state.lockAspect ? ' locked' : '')}
          title={
            state.lockAspect
              ? 'Aspect ratio locked — click to unlink'
              : 'Aspect ratio unlocked — click to link'
          }
          aria-pressed={state.lockAspect}
          onClick={() => setState({ ...state, lockAspect: !state.lockAspect })}
        >
          <LinkIcon locked={state.lockAspect} />
        </button>

        <label className="size-grid-label" htmlFor={`${label}-h`}>
          Height:
        </label>
        <div className="size-input-group">
          <NumberInput
            id={`${label}-h`}
            value={fmt(hDisp)}
            onChange={(v) => commitH(displayToPx(v, ih, state.unit))}
            aria-label={`${label} height`}
          />
          <button
            type="button"
            className="step-btn"
            title={`−${state.unit === 'px' ? '1' : '1%'}`}
            onClick={() => commitH(state.h - stepH)}
          >
            −
          </button>
          <button
            type="button"
            className="step-btn"
            title={`+${state.unit === 'px' ? '1' : '1%'}`}
            onClick={() => commitH(state.h + stepH)}
          >
            +
          </button>
        </div>
      </div>

      <div className="canvas-size-row">
        <span className="canvas-size-meta">
          {state.w} × {state.h} px
          {dirty && (
            <em>
              {' '}
              (was {initial[0]} × {initial[1]})
            </em>
          )}
        </span>
        <button
          type="button"
          className="btn small"
          disabled={!dirty}
          onClick={() => setState({ ...state, w: initial[0], h: initial[1] })}
          title="Revert to current"
        >
          revert
        </button>
      </div>

      <label
        className="bg-checkbox"
        title="Rescale regions to keep their relative position and size in the new canvas. Off = canvas resizes alone."
      >
        <input
          type="checkbox"
          checked={state.stretch}
          onChange={(e) => setState({ ...state, stretch: e.target.checked })}
        />
        stretch regions to fit
      </label>
    </fieldset>
  );
}

// Inner form: mounts only while the dialog is open, so its useState lazy
// initializers re-run on every open. Avoids the "setState in useEffect to
// reset form" anti-pattern.
interface FormProps {
  sourceInitial: [number, number];
  outputInitial: [number, number];
  onApply: (source: SizeSectionState, output: SizeSectionState) => void;
  onClose: () => void;
}

function CanvasSizeForm({ sourceInitial, outputInitial, onApply, onClose }: FormProps) {
  const [source, setSource] = useState<SizeSectionState>(() => ({
    w: sourceInitial[0],
    h: sourceInitial[1],
    unit: 'px',
    lockAspect: true,
    stretch: true,
  }));
  const [output, setOutput] = useState<SizeSectionState>(() => ({
    w: outputInitial[0],
    h: outputInitial[1],
    unit: 'px',
    lockAspect: true,
    stretch: true,
  }));

  return (
    <form
      method="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(source, output);
      }}
    >
      <h2>Canvas size</h2>
      <SizeSection
        label="Source"
        hint="Dimensions of the original-image canvas. Region polygons live here."
        initial={sourceInitial}
        state={source}
        setState={setSource}
      />
      <SizeSection
        label="Output"
        hint="Dimensions of the transformed canvas (right zone render target)."
        initial={outputInitial}
        state={output}
        setState={setOutput}
      />
      <div className="canvas-size-actions">
        <button type="button" className="btn small" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn small primary">
          Apply
        </button>
      </div>
    </form>
  );
}

export function CanvasSizeModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { regionImageSize, outputCanvasSize, setSourceCanvasSize, setOutputCanvasSize } =
    useEditorStore(
      useShallow((s) => ({
        regionImageSize: s.regionImageSize,
        outputCanvasSize: s.outputCanvasSize,
        setSourceCanvasSize: s.setSourceCanvasSize,
        setOutputCanvasSize: s.setOutputCanvasSize,
      })),
    );

  const sourceInitial: [number, number] = regionImageSize ?? [1024, 1024];
  const outputInitial: [number, number] = outputCanvasSize ?? regionImageSize ?? [1024, 1024];

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const apply = (source: SizeSectionState, output: SizeSectionState) => {
    const sourceChanged = source.w !== sourceInitial[0] || source.h !== sourceInitial[1];
    const outputChanged = output.w !== outputInitial[0] || output.h !== outputInitial[1];
    if (sourceChanged) setSourceCanvasSize([source.w, source.h], source.stretch);
    if (outputChanged) setOutputCanvasSize([output.w, output.h], output.stretch);
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="canvas-size-dialog" onClose={onClose} onCancel={onClose}>
      {open && (
        <CanvasSizeForm
          sourceInitial={sourceInitial}
          outputInitial={outputInitial}
          onApply={apply}
          onClose={onClose}
        />
      )}
    </dialog>
  );
}
