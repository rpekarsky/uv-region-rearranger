import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const SNAP_DEG = 15;

interface Props {
  /** Current rotation in radians. */
  value: number;
  onChange: (radians: number) => void;
}

const SIZE = 96;
const RADIUS = 38;

/**
 * Photoshop-ish rotation knob. Drag inside the circle to set angle.
 * Hold shift while dragging to snap to 15°.
 *
 * Internally tracks rotation as a relative delta from where you grabbed —
 * this avoids the dial "jumping" if you click off-center.
 */
export function RotationDial({ value, onChange }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startAngle: number; startValue: number } | null>(null);

  function getAngle(ev: MouseEvent | React.MouseEvent): number {
    const svg = ref.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(ev.clientY - cy, ev.clientX - cx);
  }

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    useEditorStore.getState().beginAction();
    dragStateRef.current = { startAngle: getAngle(e), startValue: value };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const cur = getAngle(ev);
      let next = ds.startValue + (cur - ds.startAngle);
      if (ev.shiftKey) {
        const snap = SNAP_DEG * DEG2RAD;
        next = Math.round(next / snap) * snap;
      }
      onChange(next);
    };
    const onUp = () => {
      setDragging(false);
      dragStateRef.current = null;
      useEditorStore.getState().endAction();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onChange]);

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const deg = parseFloat(e.target.value);
    if (!isNaN(deg)) onChange(deg * DEG2RAD);
  };

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  // Pointer aligned with current angle. Y inverted only conceptually — in
  // canvas/screen coords +y is down, so atan2 already gives screen-up=−π/2.
  const px = cx + Math.cos(value) * RADIUS;
  const py = cy + Math.sin(value) * RADIUS;

  // tick marks every 30°
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r1 = RADIUS - 3;
    const r2 = RADIUS + (i % 3 === 0 ? 4 : 2);
    ticks.push(
      <line
        key={i}
        x1={cx + Math.cos(a) * r1}
        y1={cy + Math.sin(a) * r1}
        x2={cx + Math.cos(a) * r2}
        y2={cy + Math.sin(a) * r2}
        stroke="#555"
        strokeWidth={i % 3 === 0 ? 1.5 : 1}
      />,
    );
  }

  const displayDeg = ((((value * RAD2DEG) % 360) + 540) % 360) - 180;

  return (
    <div className="rotation-dial">
      <svg
        ref={ref}
        width={SIZE}
        height={SIZE}
        onMouseDown={onMouseDown}
        style={{ cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
      >
        <circle cx={cx} cy={cy} r={RADIUS} fill="#222" stroke="#444" strokeWidth={1} />
        {ticks}
        <line
          x1={cx}
          y1={cy}
          x2={px}
          y2={py}
          stroke="#4080ee"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} fill="#4080ee" />
        <circle cx={px} cy={py} r={5} fill="#4080ee" stroke="#fff" strokeWidth={1.5} />
      </svg>
      <input
        className="rotation-num"
        type="number"
        step="any"
        value={Number(displayDeg.toFixed(2))}
        onChange={handleNumberChange}
        onFocus={() => useEditorStore.getState().beginAction()}
        onBlur={() => useEditorStore.getState().endAction()}
      />
      <span className="rotation-deg">°</span>
    </div>
  );
}
