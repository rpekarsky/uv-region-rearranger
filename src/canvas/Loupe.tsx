import { useEffect, useRef } from 'react';
import type { Vec2, Viewport } from '../types';

const LOUPE_SIZE = 140;
const ZOOM = 3;
const SRC_SIZE = LOUPE_SIZE / ZOOM;
const CURSOR_OFFSET = 24;

export interface LoupePolyline {
  points: Vec2[]; // image-space coords
  closed: boolean;
  color?: string;
  width?: number; // screen-px (multiplied internally by ZOOM)
  drawVertices?: boolean;
}

interface Props {
  sourceCanvas: HTMLCanvasElement | null;
  cursor: { x: number; y: number } | null;
  containerW: number;
  containerH: number;
  viewport?: Viewport;
  polylines?: LoupePolyline[];
}

export function Loupe({
  sourceCanvas,
  cursor,
  containerW,
  containerH,
  viewport,
  polylines,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cursor || !sourceCanvas) return;
    if (canvas.width !== LOUPE_SIZE) canvas.width = LOUPE_SIZE;
    if (canvas.height !== LOUPE_SIZE) canvas.height = LOUPE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    const sx = cursor.x - SRC_SIZE / 2;
    const sy = cursor.y - SRC_SIZE / 2;
    try {
      ctx.drawImage(sourceCanvas, sx, sy, SRC_SIZE, SRC_SIZE, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    } catch {
      // drawImage with negative source coords is a no-op in some browsers; ignore
    }

    if (viewport && polylines && polylines.length) {
      const toLoupe = (p: Vec2): Vec2 => {
        const screenX = p[0] * viewport.scale + viewport.panX;
        const screenY = p[1] * viewport.scale + viewport.panY;
        return [
          (screenX - cursor.x) * ZOOM + LOUPE_SIZE / 2,
          (screenY - cursor.y) * ZOOM + LOUPE_SIZE / 2,
        ];
      };
      for (const pl of polylines) {
        if (pl.points.length < 2) continue;
        ctx.strokeStyle = pl.color ?? 'rgba(120,200,255,0.95)';
        ctx.lineWidth = (pl.width ?? 1) * ZOOM;
        ctx.beginPath();
        const first = toLoupe(pl.points[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < pl.points.length; i++) {
          const q = toLoupe(pl.points[i]);
          ctx.lineTo(q[0], q[1]);
        }
        if (pl.closed) ctx.closePath();
        ctx.stroke();
        if (pl.drawVertices) {
          ctx.fillStyle = pl.color ?? 'rgba(120,200,255,0.95)';
          for (const p of pl.points) {
            const q = toLoupe(p);
            ctx.beginPath();
            ctx.arc(q[0], q[1], 2 * ZOOM, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    const c = LOUPE_SIZE / 2;
    const gap = 4;
    ctx.strokeStyle = 'rgba(255, 70, 70, 0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, c + 0.5);
    ctx.lineTo(c - gap, c + 0.5);
    ctx.moveTo(c + gap, c + 0.5);
    ctx.lineTo(LOUPE_SIZE, c + 0.5);
    ctx.moveTo(c + 0.5, 0);
    ctx.lineTo(c + 0.5, c - gap);
    ctx.moveTo(c + 0.5, c + gap);
    ctx.lineTo(c + 0.5, LOUPE_SIZE);
    ctx.stroke();
  }, [sourceCanvas, cursor, viewport, polylines]);

  if (!cursor) return null;

  let left = cursor.x + CURSOR_OFFSET;
  let top = cursor.y + CURSOR_OFFSET;
  if (left + LOUPE_SIZE > containerW) left = cursor.x - CURSOR_OFFSET - LOUPE_SIZE;
  if (top + LOUPE_SIZE > containerH) top = cursor.y - CURSOR_OFFSET - LOUPE_SIZE;
  if (left < 4) left = 4;
  if (top < 4) top = 4;

  return (
    <canvas
      ref={canvasRef}
      className="canvas-loupe"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
    />
  );
}
