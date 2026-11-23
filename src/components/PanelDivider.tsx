import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface PanelDividerProps {
  label: string;
  controls: string;
  /** The tooltip: what a drag and a double-click do here. */
  hint: string;
  /** The right panel grows when its divider moves to the left. */
  side: "left" | "right";
  value: number;
  /** The narrowest the panel goes (the library's rail) and the widest this window allows. */
  min: number;
  max: number;
  disabled?: boolean;
  /** The width asked for, before limits: the shell clamps it and decides folding. */
  onResize: (width: number, byKey: boolean) => void;
  onReset: () => void;
  /** Enter folds the panel or opens it again (the window-splitter pattern). */
  onToggle?: () => void;
}

export function PanelDivider({ label, controls, hint, side, value, min, max, disabled, onResize, onReset, onToggle }: PanelDividerProps) {
  const drag = useRef<{ id: number; x: number; width: number; target: HTMLDivElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = side === "left" ? 1 : -1;
  const resize = (width: number, byKey: boolean): void => onResize(Math.round(width), byKey);
  // The Escape listener outlives the render that added it.
  const latestResize = useRef(onResize);
  latestResize.current = onResize;

  const endDrag = useCallback((): void => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    root.classList.add("panel-resizing");
    // A mouse drag leaves focus where it was, so Escape is heard on the window: it puts the panel back.
    const cancel = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || !drag.current) return;
      e.preventDefault();
      e.stopPropagation();
      const start = drag.current.width;
      endDrag();
      // As a drag to where it began: that width, or the rail if it began there.
      latestResize.current(start, false);
    };
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", endDrag);
    return () => {
      root.classList.remove("panel-resizing");
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("blur", endDrag);
      // Unmounting during a drag must also release capture and the global cursor.
      const current = drag.current;
      drag.current = null;
      if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    };
  }, [dragging, endDrag]);

  useEffect(() => { if (disabled) endDrag(); }, [disabled, endDrag]);

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id === e.pointerId) endDrag();
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={hint}
      className="panel-divider app-no-drag"
      data-dragging={dragging ? "" : undefined}
      // A mouse press doesn't take focus: arrow keys keep seeking and Enter keeps playing after a drag.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || !e.isPrimary || drag.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, width: value, target: e.currentTarget };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current || current.id !== e.pointerId) return;
        if (e.buttons === 0) { endDrag(); return; }
        resize(current.width + (e.clientX - current.x) * direction, false);
      }}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      onDoubleClick={() => { if (!disabled) onReset(); }}
      onKeyDown={(e) => {
        if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
        const step = e.shiftKey ? 40 : 8;
        switch (e.key) {
          case "ArrowLeft": resize(value - step * direction, true); break;
          case "ArrowRight": resize(value + step * direction, true); break;
          case "Home": resize(min, true); break;
          case "End": resize(max, true); break;
          case "Enter": if (!onToggle) return; onToggle(); break;
          default: return;
        }
        // These keys belong to the divider, not the app's seek/skip shortcuts.
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
