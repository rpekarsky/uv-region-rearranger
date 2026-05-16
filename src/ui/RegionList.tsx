import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';

export function RegionList() {
  const { regions, selectedRegionId, selectRegion, renameRegion, deleteRegion, reorderRegions } =
    useEditorStore(
      useShallow((s) => ({
        regions: s.regions,
        selectedRegionId: s.selectedRegionId,
        selectRegion: s.selectRegion,
        renameRegion: s.renameRegion,
        deleteRegion: s.deleteRegion,
        reorderRegions: s.reorderRegions,
      })),
    );

  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  if (regions.length === 0) {
    return <div className="empty-list">no regions</div>;
  }

  return (
    <div className="region-list">
      {regions.map((r, idx) => {
        const isEditing = editingId === r.id;
        const isSelected = r.id === selectedRegionId;
        return (
          <div
            key={r.id}
            className={'region-item' + (isSelected ? ' selected' : '')}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('input, button')) return;
              selectRegion(r.id);
            }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="region-name"
                value={r.name}
                onChange={(e) => renameRegion(r.id, e.target.value)}
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <span className="region-name region-name-static">{r.name}</span>
            )}
            <button
              className="region-btn"
              title="Move up"
              disabled={idx === 0}
              onClick={(e) => {
                e.stopPropagation();
                reorderRegions(idx, idx - 1);
              }}
            >
              ↑
            </button>
            <button
              className="region-btn"
              title="Move down"
              disabled={idx === regions.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                reorderRegions(idx, idx + 1);
              }}
            >
              ↓
            </button>
            <button
              className="region-btn"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(r.id);
              }}
            >
              ✎
            </button>
            <button
              className="region-btn region-del"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                deleteRegion(r.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
