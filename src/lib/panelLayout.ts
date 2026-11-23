/** Width rules for the three-pane shell. All sizes are CSS pixels. */
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 480;
export const CONTENT_MIN_WIDTH = 480;
export const PANEL_DIVIDER_WIDTH = 8;
/** The library folded down to a column of covers. */
export const LIBRARY_RAIL_WIDTH = 80;
/** A drag that takes the library under this folds it; dragging the rail past it opens the list again. */
export const LIBRARY_FOLD_AT = 160;

export interface PanelWidths {
  library: number;
  nowPlaying: number;
}

export type SidePanel = keyof PanelWidths;

/** The widths the shell draws, and whether the library shows as its rail. */
export interface PanelFit extends PanelWidths {
  rail: boolean;
}

export const DEFAULT_PANEL_WIDTHS: Readonly<PanelWidths> = { library: 328, nowPlaying: 328 };

const readWidth = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(value)))
    : fallback;

/** Old installs, partial saves and damaged values all get usable widths. */
export function readPanelWidths(raw: unknown): PanelWidths {
  const value = raw && typeof raw === "object" ? raw as Partial<PanelWidths> : {};
  return {
    library: readWidth(value.library, DEFAULT_PANEL_WIDTHS.library),
    nowPlaying: readWidth(value.nowPlaying, DEFAULT_PANEL_WIDTHS.nowPlaying),
  };
}

/** containerWidth excludes the shell's outer margins, but includes both dividers. */
function panelBudget(containerWidth: number, folded: boolean): number {
  const width = Number.isFinite(containerWidth) ? Math.floor(containerWidth) : 0;
  // At the native window's 1000px minimum, all three minimums fit. A hidden or
  // unusually small browser preview still keeps the side panels at their minimums.
  const least = (folded ? LIBRARY_RAIL_WIDTH : PANEL_MIN_WIDTH) + PANEL_MIN_WIDTH;
  return Math.max(least, width - 2 * PANEL_DIVIDER_WIDTH - CONTENT_MIN_WIDTH);
}

/** Fit saved preferences to this window without modifying the saved values. */
export function fitPanelWidths(preferred: PanelWidths, containerWidth: number, folded = false): PanelFit {
  const widths = readPanelWidths(preferred);
  const budget = panelBudget(containerWidth, folded);
  // Folded, the library's room goes to the page; Now Playing keeps its own width.
  if (folded) return { library: LIBRARY_RAIL_WIDTH, nowPlaying: Math.min(widths.nowPlaying, budget - LIBRARY_RAIL_WIDTH), rail: true };
  const total = widths.library + widths.nowPlaying;
  if (total <= budget) return { ...widths, rail: false };

  // Share the reduction according to each panel's room above its minimum.
  // Neither side is sacrificed first when the window gets smaller.
  const fraction = (budget - 2 * PANEL_MIN_WIDTH) / (total - 2 * PANEL_MIN_WIDTH);
  const library = PANEL_MIN_WIDTH + Math.floor((widths.library - PANEL_MIN_WIDTH) * fraction);
  return { library, nowPlaying: budget - library, rail: false };
}

/** A divider stops before it squeezes either the opposite panel or the content. */
export function panelMaxWidth(panel: SidePanel, widths: PanelWidths, containerWidth: number, folded = false): number {
  const fitted = fitPanelWidths(widths, containerWidth, folded);
  const other = panel === "library" ? fitted.nowPlaying : fitted.library;
  return Math.min(PANEL_MAX_WIDTH, panelBudget(containerWidth, folded) - other);
}

export function resizePanel(widths: PanelWidths, panel: SidePanel, requested: number, containerWidth: number, folded = false): PanelFit {
  const fitted = fitPanelWidths(widths, containerWidth, folded);
  return {
    ...fitted,
    [panel]: Math.min(readWidth(requested, fitted[panel]), panelMaxWidth(panel, fitted, containerWidth, folded)),
  };
}

/**
 * Whether the library ends up folded after asking for `requested` px, from
 * `current` px. A drag has to cross LIBRARY_FOLD_AT either way, so the rail
 * doesn't flicker at its edge. By key, an arrow stops at the list's minimum
 * first and the next press folds; Home folds at once; any step out opens.
 */
export function foldsLibrary(requested: number, folded: boolean, byKey: boolean, current = PANEL_MIN_WIDTH): boolean {
  if (!byKey) return requested < LIBRARY_FOLD_AT;
  if (folded) return requested <= LIBRARY_RAIL_WIDTH;
  return requested <= LIBRARY_RAIL_WIDTH || (requested < PANEL_MIN_WIDTH && current <= PANEL_MIN_WIDTH);
}
