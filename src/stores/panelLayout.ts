/** This computer's panel-width preferences, kept separately from synced account settings. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { coalescedStorage } from "../lib/persist";
import { DEFAULT_PANEL_WIDTHS, readPanelWidths, type PanelWidths } from "../lib/panelLayout";

interface PanelLayoutState {
  widths: PanelWidths;
  /** Your Library folded to its rail of covers; its list width is kept for when it opens. */
  libraryFolded: boolean;
  setWidths(widths: PanelWidths): void;
  setLibraryFolded(folded: boolean): void;
  resetWidths(): void;
}

export const usePanelLayout = create<PanelLayoutState>()(
  persist(
    (set, get) => ({
      widths: { ...DEFAULT_PANEL_WIDTHS },
      libraryFolded: false,
      setWidths(widths) {
        const next = readPanelWidths(widths);
        const previous = get().widths;
        if (next.library === previous.library && next.nowPlaying === previous.nowPlaying) return;
        set({ widths: next });
      },
      setLibraryFolded(folded) {
        if (get().libraryFolded !== folded) set({ libraryFolded: folded });
      },
      resetWidths() {
        get().setWidths(DEFAULT_PANEL_WIDTHS);
        get().setLibraryFolded(false);
      },
    }),
    {
      name: "panel-layout",
      // Pointer moves stay responsive without writing to disk on every frame.
      storage: coalescedStorage,
      partialize: ({ widths, libraryFolded }) => ({ widths, libraryFolded }),
      merge: (saved, current) => {
        const value = saved as { widths?: unknown; libraryFolded?: unknown } | null;
        return { ...current, widths: readPanelWidths(value?.widths), libraryFolded: value?.libraryFolded === true };
      },
    }
  )
);
