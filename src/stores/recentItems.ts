/**
 * What you played or opened from search lately — songs, artists, albums,
 * playlists — with their art: the search field's Recent searches, and the
 * empty search page. Kept on this device only (it never syncs), newest first.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";
import type { Track } from "../types";

export type RecentItem =
  | { kind: "song"; id: string; title: string; subtitle: string; thumb: string; track: Track }
  | { kind: "artist" | "album" | "playlist"; id: string; title: string; subtitle: string; thumb: string };

const KEEP = 20;
const same = (a: RecentItem, kind: RecentItem["kind"], id: string): boolean => a.kind === kind && a.id === id;

const KIND_LABEL: Record<RecentItem["kind"], string> = { song: "Song", artist: "Artist", album: "Album", playlist: "Playlist" };
/** "Song • Lex Amarni": what it is, then its own line (YouTube's lines often start with the kind already). */
export const recentLine = (item: RecentItem): string => {
  const rest = (item.subtitle || "").replace(/^(artist|album|single|ep|playlist|song)\s*•\s*/i, "");
  return rest ? `${KIND_LABEL[item.kind]} • ${rest}` : KIND_LABEL[item.kind];
};

interface RecentItemsState {
  items: RecentItem[];
  add(item: RecentItem): void;
  remove(kind: RecentItem["kind"], id: string): void;
  clear(): void;
}

export const useRecentItems = create<RecentItemsState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) => set({ items: [item, ...get().items.filter((x) => !same(x, item.kind, item.id))].slice(0, KEEP) }),
      remove: (kind, id) => set({ items: get().items.filter((x) => !same(x, kind, id)) }),
      clear: () => set({ items: [] }),
    }),
    { name: "recent-items", storage: createJSONStorage(() => storage) },
  ),
);
