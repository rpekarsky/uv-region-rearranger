import { useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useEditorStore } from '../store';
import { cancelDrawing, finishDrawing, startDrawing } from '../canvas/interactions';

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type ArrowKey = (typeof ARROWS)[number];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

const temporal = () => useEditorStore.temporal.getState();

// Renderless component — registers global keyboard shortcuts.
// react-hotkeys-hook auto-disables hotkeys when an input/textarea is focused.
export function KeyboardShortcuts() {
  const hasImage = useEditorStore((s) => !!(s.originalImage || s.transformedImage));

  useHotkeys(
    'n',
    () => {
      if (hasImage) startDrawing();
    },
    [hasImage],
  );

  // Mode-aware shortcuts: read state on each fire so we always see the latest.
  useHotkeys('enter', () => {
    const s = useEditorStore.getState();
    if (s.mode.kind === 'drawing') finishDrawing();
  });

  useHotkeys('escape', () => {
    const s = useEditorStore.getState();
    if (s.mode.kind === 'drawing') {
      cancelDrawing();
      return;
    }
    if (s.selectedRegionId) s.selectRegion(null);
  });

  useHotkeys('delete, backspace', () => {
    const s = useEditorStore.getState();
    if (s.selectedRegionId) s.deleteRegion(s.selectedRegionId);
  });

  useHotkeys('h', () => {
    const s = useEditorStore.getState();
    if (!s.selectedRegionId) return;
    if (s.selectedSide === 'left') s.flipSourcePolygon(s.selectedRegionId, 'h');
    else s.flipRegion(s.selectedRegionId, 'h');
  });

  useHotkeys('v', () => {
    const s = useEditorStore.getState();
    if (!s.selectedRegionId) return;
    if (s.selectedSide === 'left') s.flipSourcePolygon(s.selectedRegionId, 'v');
    else s.flipRegion(s.selectedRegionId, 'v');
  });

  // Undo / redo. `mod` = Ctrl on Win/Linux, Cmd on Mac.
  useHotkeys('mod+z', (e) => {
    e.preventDefault();
    temporal().undo();
  });
  useHotkeys('mod+shift+z, mod+y', (e) => {
    e.preventDefault();
    temporal().redo();
  });

  useHotkeys('mod+d', (e) => {
    const s = useEditorStore.getState();
    if (!s.selectedRegionId) return;
    e.preventDefault();
    s.duplicateRegion(s.selectedRegionId);
  });

  // Pixel-level translate of the selected region via arrow keys. Right zone
  // mutates transform.translate; left zone shifts the source polygon. Plain
  // arrow = 1 px, Shift+arrow = 10 px. Skip when typing in an input.
  // Handled via native keydown — react-hotkeys-hook's arrow bindings turned
  // out flaky for this case.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ARROWS.includes(e.key as ArrowKey)) return;
      if (isTypingTarget(e.target)) return;
      const s = useEditorStore.getState();
      if (!s.selectedRegionId) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0,
        dy = 0;
      switch (e.key) {
        case 'ArrowUp':
          dy = -step;
          break;
        case 'ArrowDown':
          dy = step;
          break;
        case 'ArrowLeft':
          dx = -step;
          break;
        case 'ArrowRight':
          dx = step;
          break;
      }
      s.nudgeSelected(dx, dy);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
