import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';

export function Model3DSection() {
  const {
    model3d,
    selectedMaterialIds,
    setSelectedMaterialIds,
    meshVisibility,
    setMeshVisibility,
    setAllMeshesVisible,
    texture3DFlipY,
    setTexture3DFlipY,
  } = useEditorStore(
    useShallow((s) => ({
      model3d: s.model3d,
      selectedMaterialIds: s.selectedMaterialIds,
      setSelectedMaterialIds: s.setSelectedMaterialIds,
      meshVisibility: s.meshVisibility,
      setMeshVisibility: s.setMeshVisibility,
      setAllMeshesVisible: s.setAllMeshesVisible,
      texture3DFlipY: s.texture3DFlipY,
      setTexture3DFlipY: s.setTexture3DFlipY,
    })),
  );

  if (!model3d) {
    return <div className="model3d-empty">No model loaded. Drop a .glb into the 3D panel.</div>;
  }

  const allVisible = model3d.meshNames.every((n) => meshVisibility[n] !== false);

  return (
    <div className="model3d-section">
      <div className="model3d-filename">{model3d.filename}</div>

      <label className="bg-checkbox">
        <input
          type="checkbox"
          checked={texture3DFlipY}
          onChange={(e) => setTexture3DFlipY(e.target.checked)}
        />
        flip texture Y
      </label>

      <div className="model3d-subhead">Skin materials</div>
      {[...selectedMaterialIds, null].map((id, idx) => {
        const handleChange = (next: string | null) => {
          if (idx < selectedMaterialIds.length) {
            if (next === null) {
              setSelectedMaterialIds(selectedMaterialIds.filter((_, i) => i !== idx));
            } else {
              setSelectedMaterialIds(
                selectedMaterialIds.map((existing, i) => (i === idx ? next : existing)),
              );
            }
          } else if (next !== null) {
            setSelectedMaterialIds([...selectedMaterialIds, next]);
          }
        };
        const available = model3d.materialNames.filter(
          (n) => n === id || !selectedMaterialIds.includes(n),
        );
        return (
          <select
            key={idx}
            className="model3d-material-select"
            value={id ?? ''}
            onChange={(e) => handleChange(e.target.value || null)}
          >
            <option value="">— none —</option>
            {available.map((name) => (
              <option key={name} value={name}>
                {name} ({model3d.meshesByMaterial.get(name)?.length ?? 0} meshes)
              </option>
            ))}
          </select>
        );
      })}

      <div className="model3d-subhead">
        Meshes ({model3d.meshNames.length})
        <button
          type="button"
          className="btn small model3d-toggle-all"
          onClick={() => setAllMeshesVisible(!allVisible)}
        >
          {allVisible ? 'Hide all' : 'Show all'}
        </button>
      </div>
      <div className="model3d-mesh-list">
        {model3d.meshNames.map((name) => (
          <label key={name} className="model3d-mesh-row">
            <input
              type="checkbox"
              checked={meshVisibility[name] !== false}
              onChange={(e) => setMeshVisibility(name, e.target.checked)}
            />
            <span className="model3d-mesh-name" title={name}>
              {name}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
