import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PANEL_WIDTHS,
  LIBRARY_RAIL_WIDTH,
  PANEL_DIVIDER_WIDTH,
  PANEL_MIN_WIDTH,
  fitPanelWidths,
  foldsLibrary,
  panelMaxWidth,
  resizePanel,
  type PanelFit,
  type PanelWidths,
  type SidePanel,
} from "../lib/panelLayout";
import { usePanelLayout } from "../stores/panelLayout";
import { PanelDivider } from "./PanelDivider";

/** How long the library takes to fold into its rail or open out of it (.panels-snap). */
const SNAP_MS = 280;

/** Only this shell rerenders during a drag; the page, playback and scroll position stay mounted. */
export function ResizablePanels({
  library,
  nowPlaying,
  children,
}: {
  /** Your Library, told whether it's showing as the rail. */
  library: (rail: boolean) => ReactNode;
  nowPlaying: ReactNode;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const preferred = usePanelLayout((s) => s.widths);
  const folded = usePanelLayout((s) => s.libraryFolded);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hydrated, setHydrated] = useState(usePanelLayout.persist.hasHydrated());
  const [resized, setResized] = useState<{ preferred: PanelWidths; folded: boolean; containerWidth: number; widths: PanelFit } | null>(null);

  useEffect(() => {
    const off = usePanelLayout.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(usePanelLayout.persist.hasHydrated());
    return off;
  }, []);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth;
      setContainerWidth(width);
      setResized((current) => current?.containerWidth === width ? current : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A smaller window fits the saved widths temporarily. Making it larger brings
  // them back; only an intentional resize or reset changes the saved preference.
  // Refitting after every resize input would also move the untouched divider.
  const widths = resized?.preferred === preferred && resized.folded === folded && resized.containerWidth === containerWidth
    ? resized.widths
    : fitPanelWidths(preferred, containerWidth, folded);

  // Folding and opening glide; a drag's own moves follow the pointer at once. The
  // transition has to arrive in the same commit as the new width, so it's set while
  // rendering. The render that brings the saved fold at launch doesn't glide.
  const settled = useRef(false);
  const [snap, setSnap] = useState({ rail: widths.rail, on: false });
  if (snap.rail !== widths.rail) setSnap({ rail: widths.rail, on: settled.current });
  useEffect(() => {
    if (!snap.on) return;
    const timer = window.setTimeout(() => setSnap((s) => ({ ...s, on: false })), SNAP_MS);
    return () => window.clearTimeout(timer);
  }, [snap]);
  useEffect(() => { if (hydrated) settled.current = true; }, [hydrated]);

  const layout = usePanelLayout.getState;
  const resize = (panel: SidePanel, width: number, foldedNow: boolean): void => {
    const next = resizePanel(widths, panel, width, containerWidth, foldedNow);
    if (next[panel] === widths[panel] && next.rail === widths.rail) return;
    layout().setWidths({ ...preferred, [panel]: next[panel] });
    setResized({ preferred: layout().widths, folded: foldedNow, containerWidth, widths: next });
  };
  const resizeLibrary = (requested: number, byKey: boolean): void => {
    if (foldsLibrary(requested, folded, byKey, widths.library)) {
      layout().setLibraryFolded(true);
      return;
    }
    layout().setLibraryFolded(false);
    // A key press out of the rail brings back the width the list had, as the window allows.
    if (folded && byKey) return;
    resize("library", requested, false);
  };

  const disabled = !hydrated || containerWidth === 0;
  return (
    <div
      ref={host}
      className={`grid flex-1 min-h-0 mx-2 mb-1 ${snap.on ? "panels-snap" : ""}`}
      style={{ gridTemplateColumns: `${widths.library}px ${PANEL_DIVIDER_WIDTH}px minmax(0, 1fr) ${PANEL_DIVIDER_WIDTH}px ${widths.nowPlaying}px` }}
    >
      {library(widths.rail)}
      <PanelDivider
        label="Your Library"
        controls="library-panel"
        hint={widths.rail ? "Drag to open Your Library. Double-click to reset it." : "Drag to resize Your Library, or all the way in to fold it. Double-click to reset it."}
        side="left"
        value={widths.library}
        min={LIBRARY_RAIL_WIDTH}
        max={panelMaxWidth("library", widths, containerWidth)}
        disabled={disabled}
        onResize={resizeLibrary}
        onToggle={() => layout().setLibraryFolded(!folded)}
        onReset={() => {
          layout().setWidths({ ...preferred, library: DEFAULT_PANEL_WIDTHS.library });
          layout().setLibraryFolded(false);
        }}
      />
      {children}
      <PanelDivider
        label="Now Playing"
        controls="now-playing-panel"
        hint="Drag to resize Now Playing. Double-click to reset it."
        side="right"
        value={widths.nowPlaying}
        min={PANEL_MIN_WIDTH}
        max={panelMaxWidth("nowPlaying", widths, containerWidth, folded)}
        disabled={disabled}
        onResize={(width) => resize("nowPlaying", width, folded)}
        onReset={() => layout().setWidths({ ...preferred, nowPlaying: DEFAULT_PANEL_WIDTHS.nowPlaying })}
      />
      {nowPlaying}
    </div>
  );
}
