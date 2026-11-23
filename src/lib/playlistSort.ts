/**
 * The orders a playlist can show its songs in. Custom is the listener's own, the one a drag changes;
 * the others are views over it and never rewrite the playlist.
 */
import type { Track } from "../types";

export type PlaylistSortKey = "custom" | "added" | "title" | "artist" | "album" | "duration";

export interface PlaylistSort {
  by: PlaylistSortKey;
  /** newest, Z, longest or the custom order's last song first; ascending is the other way */
  descending?: boolean;
}

export const SORT_LABELS: Record<PlaylistSortKey, string> = {
  custom: "Custom order",
  added: "Date added",
  title: "Title",
  artist: "Artist",
  album: "Album",
  duration: "Duration",
};

/** How each order reads ascending, then descending: the page's "Sorted by" line. */
export const SORT_DIRECTIONS: Record<PlaylistSortKey, [string, string]> = {
  custom: ["your order", "reversed"],
  added: ["oldest first", "newest first"],
  title: ["A to Z", "Z to A"],
  artist: ["A to Z", "Z to A"],
  album: ["A to Z", "Z to A"],
  duration: ["shortest first", "longest first"],
};

/** Picked, Date added starts with the newest songs; the rest start ascending. */
export const startsDescending = (by: PlaylistSortKey): boolean => by === "added";

/** A stored sort, or null when it is the playlist's own order or something this version doesn't know (from sync). */
export function activeSort(sort: unknown): PlaylistSort | null {
  const s = sort as Partial<PlaylistSort> | null | undefined;
  if (!s || typeof s.by !== "string" || !Object.prototype.hasOwnProperty.call(SORT_LABELS, s.by)) return null;
  if (s.by === "custom" && !s.descending) return null;
  return { by: s.by, ...(s.descending ? { descending: true } : {}) };
}

interface Row {
  track: Track;
  index: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * The songs in the order `sort` shows them. `addedAt` is when a song joined this playlist, 0 when
 * unknown. Songs added together (an import) or never stamped fall back to their place in the
 * playlist, so newest first puts the later one first.
 */
export function sortPlaylist(tracks: Track[], sort: PlaylistSort, addedAt: (track: Track) => number): Track[] {
  const rows: Row[] = tracks.map((track, index) => ({ track, index }));
  const byText = (key: "title" | "artist" | "album") => (a: Row, b: Row): number =>
    collator.compare(a.track[key] ?? "", b.track[key] ?? "") || a.index - b.index;
  // Each ascending; descending is the same list turned round.
  const order: Record<PlaylistSortKey, (a: Row, b: Row) => number> = {
    custom: (a, b) => a.index - b.index,
    added: (a, b) => addedAt(a.track) - addedAt(b.track) || a.index - b.index,
    title: byText("title"),
    artist: byText("artist"),
    album: byText("album"),
    duration: (a, b) => (a.track.duration || 0) - (b.track.duration || 0) || a.index - b.index,
  };
  rows.sort(order[sort.by] ?? order.custom);
  if (sort.descending) rows.reverse();
  return rows.map((r) => r.track);
}
