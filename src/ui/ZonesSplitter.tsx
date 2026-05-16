import { useEffect, useRef } from 'react';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  setRatio: (r: number) => void;
  vertical: boolean;
  onDoubleClick?: () => void;
}

export function ZonesSplitter({ containerRef, setRatio, vertical, onDoubleClick }: Props) {
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const r = vertical
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      setRatio(Math.max(0.02, Math.min(0.98, r)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [containerRef, setRatio, vertical]);

  return (
    <div
      className={`zones-splitter ${vertical ? 'vertical' : 'horizontal'}`}
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
    />
  );
}
