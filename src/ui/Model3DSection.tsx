import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';

export function Model3DSection() {
  const {
    model3d,
    selectedMaterialId,
    setSelectedMaterialId,
    meshVisibility,
    setMeshVisibility,
    setAllMeshesVisible,
  } = useEditorStore(
    useShallow((s) => ({
      model3d: s.model3d,
      selectedMaterialId: s.selectedMaterialId,
      setSelectedMaterialId: s.setSelectedMaterialId,
      meshVisibility: s.meshVisibility,
      setMeshVisibility: s.setMeshVisibility,
      setAllMeshesVisible: s.setAllMeshesVisible,
    })),
  );

  if (!model3d) {
    return <div className="model3d-empty">No model loaded. Drop a .glb into the 3D panel.</div>;
  }

  const allVisible = model3d.meshNames.every((n) => meshVisibility[n] !== false);

  return (
    <div className="model3d-section">
      <div className="model3d-filename">{model3d.filename}</div>

      <div className="model3d-subhead">Skin material</div>
      <select
        className="model3d-material-select"
        value={selectedMaterialId ?? ''}
        onChange={(e) => setSelectedMaterialId(e.target.value || null)}
      >
        <option value="">— none —</option>
        {model3d.materialNames.map((name) => (
          <option key={name} value={name}>
            {name} ({model3d.meshesByMaterial.get(name)?.length ?? 0} meshes)
          </option>
        ))}
      </select>

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
