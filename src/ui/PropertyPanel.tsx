import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import { centroid } from '../geometry/polygon';
import type { Region, Transform } from '../types';
import { RotationDial } from './RotationDial';
import { NumberInput } from './NumberInput';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

type Field = 'tx' | 'ty' | 'rotation' | 'sx' | 'sy' | 'kx' | 'ky' | 'px' | 'py';

function readField(t: Transform, f: Field): number {
  switch (f) {
    case 'tx':
      return t.translate[0];
    case 'ty':
      return t.translate[1];
    case 'rotation':
      return t.rotation * RAD2DEG;
    case 'sx':
      return t.scale[0];
    case 'sy':
      return t.scale[1];
    case 'kx':
      return t.skew[0];
    case 'ky':
      return t.skew[1];
    case 'px':
      return t.pivot[0];
    case 'py':
      return t.pivot[1];
  }
}

function applyField(t: Transform, f: Field, value: number): Partial<Transform> {
  switch (f) {
    case 'tx':
      return { translate: [value, t.translate[1]] };
    case 'ty':
      return { translate: [t.translate[0], value] };
    case 'rotation':
      return { rotation: value * DEG2RAD };
    case 'sx':
      return { scale: [value, t.scale[1]] };
    case 'sy':
      return { scale: [t.scale[0], value] };
    case 'kx':
      return { skew: [value, t.skew[1]] };
    case 'ky':
      return { skew: [t.skew[0], value] };
    case 'px':
      return { pivot: [value, t.pivot[1]] };
    case 'py':
      return { pivot: [t.pivot[0], value] };
  }
}

interface NumFieldProps {
  field: Field;
  label: string;
  value: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
}

function NumField({ field, label, value, defaultValue, onChange, onReset }: NumFieldProps) {
  const isAtDefault = defaultValue !== undefined && Math.abs(value - defaultValue) < 1e-6;
  const handleReset =
    onReset ?? (defaultValue !== undefined ? () => onChange(defaultValue) : undefined);
  return (
    <label className="prop-row">
      <span>{label}</span>
      <NumberInput data-field={field} value={value} onChange={onChange} />
      {handleReset && (
        <button
          type="button"
          className="prop-reset"
          title="Reset to default"
          disabled={isAtDefault}
          onClick={(e) => {
            e.preventDefault();
            handleReset();
          }}
        >
          ↺
        </button>
      )}
    </label>
  );
}

export function PropertyPanel() {
  const region = useEditorStore((s) => s.regions.find((r) => r.id === s.selectedRegionId) ?? null);
  const { updateTransform, resetTransform, rebasePivot, flipRegion } = useEditorStore(
    useShallow((s) => ({
      updateTransform: s.updateTransform,
      resetTransform: s.resetTransform,
      rebasePivot: s.rebasePivot,
      flipRegion: s.flipRegion,
    })),
  );

  if (!region) return null;
  const t = region.transform;

  const change = (f: Field, v: number) => updateTransform(region.id, applyField(t, f, v));
  const setRotation = (rad: number) => updateTransform(region.id, { rotation: rad });

  return (
    <PropertyPanelInner
      region={region}
      onChange={change}
      onSetRotation={setRotation}
      onFlip={(axis) => flipRegion(region.id, axis)}
      onResetXform={() => resetTransform(region.id)}
      onResetPivot={() => rebasePivot(region.id, centroid(region.polygon))}
    />
  );
}

interface InnerProps {
  region: Region;
  onChange: (f: Field, v: number) => void;
  onSetRotation: (rad: number) => void;
  onFlip: (axis: 'h' | 'v') => void;
  onResetXform: () => void;
  onResetPivot: () => void;
}

function PropertyPanelInner({
  region,
  onChange,
  onSetRotation,
  onFlip,
  onResetXform,
  onResetPivot,
}: InnerProps) {
  const t = region.transform;
  return (
    <div className="prop-grid">
      <NumField
        field="tx"
        label="Translate X"
        value={readField(t, 'tx')}
        defaultValue={0}
        onChange={(v) => onChange('tx', v)}
      />
      <NumField
        field="ty"
        label="Translate Y"
        value={readField(t, 'ty')}
        defaultValue={0}
        onChange={(v) => onChange('ty', v)}
      />
      <div className="prop-row prop-row-rotation">
        <span>Rotation</span>
        <RotationDial value={t.rotation} onChange={onSetRotation} />
        <button
          type="button"
          className="prop-reset"
          title="Reset rotation to 0"
          disabled={Math.abs(t.rotation) < 1e-6}
          onClick={(e) => {
            e.preventDefault();
            onSetRotation(0);
          }}
        >
          ↺
        </button>
      </div>
      <NumField
        field="sx"
        label="Scale X"
        value={readField(t, 'sx')}
        defaultValue={1}
        onChange={(v) => onChange('sx', v)}
      />
      <NumField
        field="sy"
        label="Scale Y"
        value={readField(t, 'sy')}
        defaultValue={1}
        onChange={(v) => onChange('sy', v)}
      />
      <NumField
        field="kx"
        label="Skew X"
        value={readField(t, 'kx')}
        defaultValue={0}
        onChange={(v) => onChange('kx', v)}
      />
      <NumField
        field="ky"
        label="Skew Y"
        value={readField(t, 'ky')}
        defaultValue={0}
        onChange={(v) => onChange('ky', v)}
      />
      <NumField
        field="px"
        label="Pivot X"
        value={readField(t, 'px')}
        onChange={(v) => onChange('px', v)}
        onReset={onResetPivot}
      />
      <NumField
        field="py"
        label="Pivot Y"
        value={readField(t, 'py')}
        onChange={(v) => onChange('py', v)}
        onReset={onResetPivot}
      />
      <div className="prop-actions">
        <button className="btn small" onClick={() => onFlip('h')}>
          Flip H
        </button>
        <button className="btn small" onClick={() => onFlip('v')}>
          Flip V
        </button>
        <button className="btn small" onClick={onResetXform}>
          Reset xform
        </button>
      </div>
      <div className="prop-actions">
        <button className="btn small" onClick={onResetPivot}>
          Pivot to centroid
        </button>
      </div>
    </div>
  );
}
