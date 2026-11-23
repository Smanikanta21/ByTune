/**
 * Framing a picture before it becomes a playlist cover or a profile photo: drag it to move it, zoom
 * with the slider, the buttons or the wheel. The square shows exactly what's kept; for a profile
 * photo, the circle it will show as stays clear and the rest dims. Escape cancels, Enter keeps.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { create } from "zustand";
import { Btn } from "./primitives";

/** What to keep, in the picture's own pixels: the square from (x, y), `size` a side. */
export interface CropRect {
  x: number;
  y: number;
  size: number;
}

interface CropRequest {
  /** the picture, already loaded (an object URL) */
  src: string;
  width: number;
  height: number;
  /** a profile photo: show the circle it will be */
  round: boolean;
  title: string;
  confirmLabel: string;
  done: (rect: CropRect | null) => void;
}

const useCrop = create<{ req: CropRequest | null }>(() => ({ req: null }));

/** Shows the frame for a loaded picture; the square to keep, or null when cancelled. */
export function askCrop(req: Omit<CropRequest, "done">): Promise<CropRect | null> {
  return new Promise((resolve) => useCrop.setState({ req: { ...req, done: resolve } }));
}

/** The frame's side, CSS px. */
const FRAME = 280;
const MAX_ZOOM = 4;

export function ImageCropDialog() {
  const req = useCrop((s) => s.req);
  return req ? <Frame key={req.src} req={req} /> : null;
}

function Frame({ req }: { req: CropRequest }) {
  // At zoom 1 the picture's short side fills the frame.
  const base = FRAME / Math.min(req.width, req.height);
  const fit = (x: number, y: number, zoom: number): { x: number; y: number; zoom: number } => {
    const s = base * zoom;
    return { zoom, x: Math.min(0, Math.max(FRAME - req.width * s, x)), y: Math.min(0, Math.max(FRAME - req.height * s, y)) };
  };
  const [view, setView] = useState(() => fit((FRAME - req.width * base) / 2, (FRAME - req.height * base) / 2, 1));
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ id: number; px: number; py: number; x: number; y: number } | null>(null);
  const scale = base * view.zoom;

  const finish = (rect: CropRect | null): void => {
    useCrop.setState({ req: null });
    req.done(rect);
  };
  const keep = (): void => {
    const v = viewRef.current;
    const s = base * v.zoom;
    finish({ x: -v.x / s, y: -v.y / s, size: FRAME / s });
  };
  // Zooming keeps whatever is in the middle of the frame in the middle.
  const zoomTo = (to: (zoom: number) => number): void =>
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, to(v.zoom)));
      const was = base * v.zoom;
      const now = base * zoom;
      const cx = (FRAME / 2 - v.x) / was;
      const cy = (FRAME / 2 - v.y) / was;
      return fit(FRAME / 2 - cx * now, FRAME / 2 - cy * now, zoom);
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
        else keep();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish(null);
      }}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={req.title} className="relative w-[min(340px,calc(100vw-48px))] rounded-2xl glass-strong p-6 animate-pop-in">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink-hi">{req.title}</h2>
        <p className="text-[13px] text-ink-dim mt-1.5">Drag to move it, zoom to frame the part you want.</p>
        <div
          className="crop-frame mt-4"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, x: view.x, y: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            setView((v) => fit(d.x + e.clientX - d.px, d.y + e.clientY - d.py, v.zoom));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => zoomTo((z) => z * Math.exp(-e.deltaY * 0.0015))}
        >
          <img
            src={req.src}
            alt=""
            draggable={false}
            style={{ width: req.width * scale, height: req.height * scale, transform: `translate(${view.x}px, ${view.y}px)` }}
          />
          {req.round && (
            <>
              <span aria-hidden className="crop-shade" />
              <span aria-hidden className="crop-circle" />
            </>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3 text-ink-dim">
          <button type="button" onClick={() => zoomTo((z) => z - 0.25)} aria-label="Zoom out" className="hover:text-ink-hi transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomTo(() => Number(e.target.value))}
            className="slider flex-1"
            style={{ "--fill": `${((view.zoom - 1) / (MAX_ZOOM - 1)) * 100}%` } as CSSProperties}
          />
          <button type="button" onClick={() => zoomTo((z) => z + 0.25)} aria-label="Zoom in" className="hover:text-ink-hi transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 mt-6">
          <Btn variant="ghost" size="md" className="!rounded-xl" onClick={() => finish(null)}>
            Cancel
          </Btn>
          <Btn variant="accent" size="md" className="!rounded-xl" onClick={keep}>
            {req.confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
