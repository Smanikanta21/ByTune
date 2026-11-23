/**
 * One of your playlists: a wall of its songs' covers, its name, how many songs and how long (and
 * which stay on this device), Play, Shuffle and its options; then its songs in your order, each lit
 * by its own cover as the pointer passes. Songs dropped on the page are added (App's panel drop);
 * its own songs move within the list instead (useSortable).
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowDownUp, ArrowUp, Disc3, Download, FileDown, HardDrive, Heart, Image as ImageIcon, ImageOff, ImagePlus,
  ListMusic, ListPlus, Loader2, MoreHorizontal, Play, SearchX, Shuffle, X,
} from "lucide-react";
import { requireBridge } from "../lib/bridge";
import { pickSquareImage } from "../lib/imagePick";
import { upgradeArtwork } from "../lib/artwork";

/** A playlist cover from this computer: square, this many pixels a side (small: it syncs with the library). */
const COVER_PX = 320;
import { deletionKey } from "../lib/deletion-sync";
import { SORT_DIRECTIONS, SORT_LABELS, activeSort, sortPlaylist, startsDescending, type PlaylistSortKey } from "../lib/playlistSort";
import { downloadAll } from "../lib/downloads";
import { exportPlaylist } from "../lib/playlistShare";
import { DownloadBadge } from "../components/TrackList";
import { CollectionHero, HERO_PLAY } from "../components/CollectionHero";
import { HERO_ROUND } from "../components/PlaylistHero";
import { PlayingLight, useRowLight } from "../components/RowLight";
import { Artwork, EmptyState, EqBars, ExplicitBadge } from "../components/primitives";
import { playlistHeaderItems, playlistMenuItems } from "../lib/trackActions";
import { useDrag } from "../lib/dnd";
import { useSortable, type SortableDragProps } from "../lib/useSortable";
import { collectionFacts } from "../lib/collection";
import { fmtTime, shortTitle } from "../lib/format";
import { FitText } from "../components/FitText";
import { useLibrary, type Playlist } from "../stores/library";
import { isLocalSong, staysOnDevice } from "../lib/devicePlaylists";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import type { Track } from "../types";

export function PlaylistView({ playlistId }: { playlistId: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === playlistId) ?? null);
  const playQueue = usePlayer((s) => s.playQueue);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const toast = useUI((s) => s.toast);
  const rowLight = useRowLight();
  // When each song joined a playlist: the sync record's add times (0 for songs older than it).
  const adds = useLibrary((s) => s.deletionSync?.adds);
  const sort = activeSort(playlist?.sort);

  // A song dragged within the list moves the way the queue's do; dragged out,
  // it still drops onto other playlists or the queue. Only the playlist's own order moves.
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scrollRef.current = document.getElementById("view-scroll");
  }, []);
  const sortable = useSortable({
    signature: (playlist?.tracks ?? []).map((t) => t.id).join(","),
    listRef,
    scrollRef,
    clamp: (_from, target) => target,
    canDrag: () => !sort,
    onCommit: (from, to) => {
      if (playlist) useLibrary.getState().moveInPlaylist(playlist.id, from, to);
    },
  });

  if (!playlist) {
    return (
      <EmptyState
        icon={ListMusic}
        title="This playlist no longer exists"
        body="It may have been deleted. Head back to your playlists to find the rest."
        className="pt-10"
      />
    );
  }

  // A sort is a view: Play, the queue and the cover wall follow it, the playlist keeps its own order.
  const tracks = sort
    ? sortPlaylist(playlist.tracks, sort, (t) => adds?.[deletionKey("tracks", t.id, playlist.id)] ?? 0)
    : playlist.tracks;
  // Keys stay with the song (id + which copy), so a moved row moves rather than remounting.
  const copies = new Map<string, number>();
  const rowKey = (id: string): string => {
    const n = copies.get(id) ?? 0;
    copies.set(id, n + 1);
    return `${id}#${n}`;
  };
  // Songs from this computer don't sync: the playlist says what stays here.
  const onDevice = staysOnDevice(playlist);
  const localCount = tracks.filter(isLocalSong).length;
  const facts = collectionFacts(tracks);

  const play = (shuffle: boolean): void => {
    if (!tracks.length) return;
    if (shuffle) {
      usePlayer.setState({ shuffle: true });
      playQueue(tracks, Math.floor(Math.random() * tracks.length), playlistId);
    } else {
      playQueue(tracks, 0, playlistId);
    }
  };

  // The cover pickers: an image from this computer, or one of the songs' own covers.
  const songCovers = [...new Set(playlist.tracks.map((t) => t.thumb).filter(Boolean))].slice(0, 12);
  const chooseCover = async (): Promise<void> => {
    try {
      const cover = await pickSquareImage(COVER_PX, { title: "Frame the cover", confirmLabel: "Use as cover" });
      if (!cover) return;
      useLibrary.getState().setPlaylistCover(playlist.id, cover);
      toast("Cover changed", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "ByTune couldn't use that image.", "error");
    }
  };

  const openHeaderMenu = (x: number, y: number): void => {
    const [renameItem, deleteItem] = playlistHeaderItems(playlist);
    openContextMenu(x, y, [
      {
        label: "Add all to queue",
        icon: ListPlus,
        action: () => {
          usePlayer.getState().addToQueue(tracks);
          toast("Playlist added to queue");
        },
      },
      { label: "Download all", icon: Download, action: () => downloadAll(tracks, `"${playlist.name}"`) },
      { label: "Export playlist", icon: FileDown, action: () => void exportPlaylist(playlist.name, tracks) },
      {
        label: "Change cover",
        icon: ImageIcon,
        separatorBefore: true,
        children: [
          { label: "Choose an image", icon: ImagePlus, action: () => void chooseCover() },
          {
            label: "Use a song's cover",
            icon: Disc3,
            disabled: !songCovers.length,
            // After this menu closes: the picker is a menu of its own.
            action: () => window.setTimeout(() => openContextMenu(x, y, [{ node: <CoverPicker playlistId={playlist.id} covers={songCovers} /> }]), 0),
          },
          ...(playlist.cover ? [{ label: "Remove cover", icon: ImageOff, action: () => useLibrary.getState().setPlaylistCover(playlist.id, null) }] : []),
        ],
      },
      renameItem,
      deleteItem,
    ]);
  };

  return (
    <div className="pb-14">
      <CollectionHero
        icon={onDevice ? HardDrive : ListMusic}
        kind={onDevice ? "On this device" : "Your playlist"}
        title={playlist.name}
        // An artist's playlist leads with the artist's photo.
        // An artist's playlist leads with their photo. The listener's own cover is the playlist's picture
        // elsewhere (sidebar, Library, folders); this wall stays its songs' covers.
        covers={[playlist.artistThumb, ...tracks.map((t) => t.thumb)]}
        facts={
          <>
            {tracks.length ? [facts.songs, facts.length].filter(Boolean).join(" · ") : "No songs yet"}
            {facts.topArtist && (
              <>
                {" · Top artist: "}
                <span className="font-semibold text-white">{facts.topArtist.name}</span>
              </>
            )}
            {/* Says why a drag doesn't move songs while another order shows. */}
            {sort && ` · Sorted by ${SORT_LABELS[sort.by].toLowerCase()}, ${SORT_DIRECTIONS[sort.by][sort.descending ? 1 : 0]}`}
            {localCount > 0 && (
              <span className="block mt-1.5 text-[13px] text-white/60">
                {onDevice
                  ? "All its songs are from this computer, so it stays here and doesn't sync."
                  : `${localCount === 1 ? "1 song is" : `${localCount} songs are`} from this computer and ${
                      localCount === 1 ? "stays" : "stay"
                    } on this device. The rest of the playlist syncs.`}
              </span>
            )}
          </>
        }
      >
        {/* Not dimmed when empty: play() does nothing then, and grey buttons made new playlists look broken. */}
        <button type="button" className={HERO_PLAY} aria-label={`Play ${playlist.name}`} onClick={() => play(false)}>
          <Play className="w-5 h-5 fill-current" />
          Play
        </button>
        <button type="button" className={HERO_ROUND} aria-label="Shuffle" title="Shuffle" onClick={() => play(true)}>
          <Shuffle className="w-5 h-5" />
        </button>
        <button
          type="button"
          className={HERO_ROUND}
          aria-label="Sort"
          title="Sort"
          onClick={(e) => openContextMenu(e.clientX, e.clientY, [{ node: <SortPanel playlistId={playlist.id} /> }])}
        >
          <ArrowDownUp className="w-5 h-5" />
        </button>
        <button
          type="button"
          className={HERO_ROUND}
          aria-label="More options"
          title="More options"
          onClick={(e) => openHeaderMenu(e.clientX, e.clientY)}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </CollectionHero>

      <div className="pt-6">
        {tracks.length ? (
          <div className="relative" onMouseLeave={rowLight.leave}>
            {rowLight.light}
            <div ref={listRef}>
              {tracks.map((track, i) => (
                <div key={rowKey(track.id)} style={sortable.styleFor(i)}>
                  <PlaylistTrackRow
                    track={track}
                    index={i}
                    queue={tracks}
                    playlist={playlist}
                    sortDrag={sortable.dragProps(i)}
                    onHover={rowLight.hover}
                  />
                  {i < tracks.length - 1 && <div className="h-px bg-ink-hi/[0.05] ml-[112px] mr-3" />}
                </div>
              ))}
            </div>
          </div>
        ) : playlist.missing?.length ? null : (
          <EmptyState
            icon={ListMusic}
            title="Let's find something for your playlist"
            body="Search for songs you love, or browse Explore to discover something new, then right-click any song to add it here. Its cover joins the wall above."
            action={
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => {
                    useUI.getState().navigate({ name: "home" });
                    // The search field lives in the top bar; focus it once
                    // home has painted so typing starts immediately.
                    window.setTimeout(() => document.getElementById("global-search")?.focus(), 80);
                  }}
                  className="h-10 px-5 rounded-full bg-primary text-on-primary text-[13.5px] font-semibold hover:brightness-110 hover:shadow-[0_10px_36px_-10px_rgb(var(--primary)/0.55)] transition-all active:scale-[0.98]"
                >
                  Search for songs
                </button>
                <button
                  onClick={() => useUI.getState().navigate({ name: "explore" })}
                  className="h-10 px-5 rounded-full bg-panel border border-ink-hi/[0.09] text-[13.5px] font-semibold text-ink-hi hover:bg-ink-hi/[0.05] hover:border-ink-hi/[0.2] transition-all active:scale-[0.98]"
                >
                  Browse Explore
                </button>
              </div>
            }
          />
        )}
        {!!playlist.missing?.length && <MissingSongs playlist={playlist} />}
      </div>
    </div>
  );
}

/**
 * The songs this playlist's import couldn't find on YouTube Music, as the source named them. Find
 * searches YouTube Music and offers its top songs to pick from; picking one adds it and takes the
 * name off the list. × skips a song, Clear list skips them all.
 */
function MissingSongs({ playlist }: { playlist: Playlist }) {
  const [searching, setSearching] = useState<number | null>(null);
  const missing = playlist.missing ?? [];
  const lib = useLibrary.getState();
  const ui = useUI.getState();

  const find = async (i: number, x: number, y: number): Promise<void> => {
    const song = missing[i];
    setSearching(i);
    try {
      const hits = ((await requireBridge().search(`${song.title} ${song.artist}`.trim())).songs ?? []).slice(0, 5);
      if (!hits.length) {
        ui.toast(`YouTube Music has nothing for “${song.title}”`);
        return;
      }
      const pick = (track: Track): void => {
        ui.closeContextMenu();
        const added = useLibrary.getState().addToPlaylist(playlist.id, track);
        // By name, not position: a song skipped while this search ran has moved the rest up.
        const now = useLibrary.getState().playlists.find((p) => p.id === playlist.id)?.missing ?? [];
        const at = now.findIndex((m) => m.title === song.title && m.artist === song.artist);
        if (at >= 0) useLibrary.getState().dropMissing(playlist.id, at);
        ui.toast(added ? `Added “${shortTitle(track.title)}” to ${playlist.name}` : `“${shortTitle(track.title)}” was already in ${playlist.name}`, added ? "success" : "info");
      };
      ui.openContextMenu(x, y, [{ node: <FoundSongs heading={`Songs like “${song.title}”`} hits={hits} onPick={pick} /> }]);
    } catch {
      ui.toast("Search didn't go through. Give it another try.", "error");
    } finally {
      setSearching(null);
    }
  };

  return (
    <section className="mt-10 px-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[17px] font-bold tracking-[-0.2px] text-ink-hi">
          Didn't import <span className="font-medium text-ink-faint">· {missing.length}</span>
        </h2>
        <button type="button" onClick={() => lib.dropMissing(playlist.id)} className="text-[13px] font-semibold text-ink-dim hover:text-ink-hi transition-colors">
          Clear list
        </button>
      </div>
      <p className="mt-1 text-[13.5px] text-ink-dim">YouTube Music didn't have a match for these. Find each one yourself, or skip it.</p>
      <div className="mt-3">
        {missing.map((song, i) => (
          <div key={`${song.title}|${song.artist}|${i}`} className="group flex items-center gap-3.5 h-[64px] px-3 -mx-3 rounded-lg hover:bg-ink-hi/[0.04]">
            <div className="w-7 shrink-0" />
            <div className="w-[52px] h-[52px] rounded-lg shrink-0 grid place-items-center bg-ink-hi/[0.05] text-ink-faint">
              <SearchX className="w-[18px] h-[18px]" />
            </div>
            <div className="flex-1 min-w-0 opacity-70">
              <FitText text={song.title} className="text-[16px] font-semibold tracking-[-0.2px] text-ink-hi" />
              {song.artist && <FitText text={song.artist} className="text-[14px] text-ink-dim mt-0.5" />}
            </div>
            <button
              type="button"
              onClick={(e) => void find(i, e.clientX, e.clientY)}
              disabled={searching !== null}
              className="h-8 px-3.5 rounded-full inline-flex items-center gap-1.5 bg-ink-hi/[0.07] hover:bg-ink-hi/[0.12] text-[13px] font-semibold text-ink-hi transition-colors disabled:opacity-60"
            >
              {searching === i && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Find
            </button>
            <button
              type="button"
              onClick={() => lib.dropMissing(playlist.id, i)}
              title="Skip this song"
              aria-label={`Skip ${song.title}`}
              className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Use a song's cover": the playlist's own song covers, four to a row; the one in use is ringed. */
function CoverPicker({ playlistId, covers }: { playlistId: string; covers: string[] }) {
  const current = useLibrary((s) => s.playlists.find((p) => p.id === playlistId)?.cover);
  return (
    <div>
      <div role="presentation" className="menu-caption">
        Pick a song's cover
      </div>
      <div className="cover-pick-grid">
        {covers.map((src) => (
          <button
            key={src}
            type="button"
            role="menuitemradio"
            aria-checked={current === src}
            aria-label="Use this cover"
            data-menu-row
            className={`cover-pick${current === src ? " is-on" : ""}`}
            onClick={() => {
              useLibrary.getState().setPlaylistCover(playlistId, src);
              useUI.getState().closeContextMenu();
            }}
          >
            <img src={upgradeArtwork(src, 226)} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Find's menu: YouTube Music's top songs for a name the import couldn't place, with their covers. */
function FoundSongs({ heading, hits, onPick }: { heading: string; hits: Track[]; onPick: (track: Track) => void }) {
  return (
    <div className="max-w-[300px]">
      <div role="presentation" className="menu-caption truncate">
        {heading}
      </div>
      {hits.map((track) => (
        <button key={track.id} type="button" role="menuitem" data-menu-row className="menu-row is-rich" onClick={() => onPick(track)}>
          <Artwork src={track.thumb} className="w-9 h-9 rounded-md shrink-0" iconClassName="w-3.5 h-3.5" alt="" />
          <span className="menu-text">
            <span className="menu-label">{shortTitle(track.title)}</span>
            <span className="menu-note">{[track.artist, track.duration > 0 ? fmtTime(track.duration) : ""].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The Sort button's panel: the orders two to a row, then ascending or descending. It stays open
 * while you choose, reading the playlist's sort as it changes; outside or Escape closes it.
 */
function SortPanel({ playlistId }: { playlistId: string }) {
  const stored = useLibrary((s) => s.playlists.find((p) => p.id === playlistId)?.sort);
  const sort = activeSort(stored);
  const by = sort?.by ?? "custom";
  const descending = !!sort?.descending;
  const set = useLibrary.getState().setPlaylistSort;
  const cell = (on: boolean): string => `sort-cell${on ? " is-on" : ""}`;
  return (
    <div>
      <div role="presentation" className="menu-caption">
        Sort by
      </div>
      <div className="sort-grid">
        {(Object.keys(SORT_LABELS) as PlaylistSortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            aria-checked={by === key}
            data-menu-row
            className={cell(by === key)}
            // A new order starts its own way round (Date added: newest first); the chosen one stays as it is.
            onClick={() => key !== by && set(playlistId, { by: key, ...(startsDescending(key) ? { descending: true } : {}) })}
          >
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>
      <div role="separator" className="menu-sep" />
      <div className="sort-grid">
        {([false, true] as const).map((down) => (
          <button
            key={down ? "desc" : "asc"}
            type="button"
            role="menuitemradio"
            aria-checked={descending === down}
            data-menu-row
            className={cell(descending === down)}
            onClick={() => set(playlistId, { by, ...(down ? { descending: true } : {}) })}
          >
            {down ? <ArrowDown /> : <ArrowUp />}
            {down ? "Descending" : "Ascending"}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlaylistTrackRow({
  track,
  index,
  queue,
  playlist,
  sortDrag,
  onHover,
}: {
  track: Track;
  index: number;
  queue: Track[];
  playlist: Playlist;
  /** moving the row within the playlist (see useSortable) */
  sortDrag: SortableDragProps;
  /** the pointer came onto this row: the list's light moves to it */
  onHover: (row: HTMLElement, thumb: string) => void;
}) {
  const playQueue = usePlayer((s) => s.playQueue);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const drag = useDrag({ track, fromPlaylist: playlist.id });
  const isCurrent = currentId === track.id;

  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, playlistMenuItems(playlist, track));
  };

  return (
    <div
      {...drag.props}
      onDragStart={(e) => {
        drag.props.onDragStart(e);
        sortDrag.onDragStart(e);
      }}
      onDragEnd={(e) => {
        drag.props.onDragEnd(e);
        sortDrag.onDragEnd(e);
      }}
      onPointerDown={sortDrag.onPointerDown}
      onPointerMove={sortDrag.onPointerMove}
      onPointerUp={sortDrag.onPointerUp}
      onPointerCancel={sortDrag.onPointerCancel}
      onMouseEnter={(e) => onHover(e.currentTarget, track.thumb)}
      onClick={() => playQueue(queue, index, playlist.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
      className={`tl-row fit-host group flex items-center gap-3.5 h-[64px] px-3 rounded-lg cursor-pointer select-none ${
        isCurrent ? "bg-ink-hi/[0.06]" : "hover:bg-ink-hi/[0.04]"
      } ${drag.dragging ? "opacity-40" : ""}`}
    >
      {isCurrent && <PlayingLight thumb={track.thumb} />}
      {/* The playlist's own running order: numbered rows, play on hover. */}
      <div data-ghost-hide className="w-7 shrink-0 grid place-items-center text-[13px] text-ink-faint tabular-nums">
        {isCurrent && playing ? (
          <EqBars />
        ) : (
          <>
            <span className={`group-hover:hidden ${isCurrent ? "text-ink-hi font-medium" : ""}`}>{index + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) usePlayer.getState().toggle();
                else playQueue(queue, index, playlist.id);
              }}
              className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
              title="Play"
              aria-label={`Play ${track.title}`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          </>
        )}
      </div>
      <Artwork src={track.thumb} className="w-[52px] h-[52px] rounded-lg shrink-0" iconClassName="w-4 h-4" alt="" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.2px] text-ink-hi">
          {track.explicit && <ExplicitBadge />}
          <FitText text={shortTitle(track.title)} full={track.title} />
        </div>
        <FitText text={track.artist} className="text-[14px] text-ink-dim mt-0.5" />
      </div>
      <div
        data-ghost-hide
        className="w-[88px] shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
          }}
          title={liked ? "Remove from Liked" : "Add to Liked"}
          aria-label={liked ? "Remove from Liked" : "Add to Liked"}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <Heart key={liked ? "liked" : "unliked"} className={`w-4 h-4 animate-icon-pop ${liked ? "fill-ink-hi text-ink-hi" : ""}`} />
        </button>
        <span className="opacity-80">
          <DownloadBadge id={track.id} />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="More options"
          aria-label={`More options for ${track.title}`}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <div className="w-11 shrink-0 text-right text-xs text-ink-faint tabular-nums">
        {track.duration > 0 ? fmtTime(track.duration) : "—"}
      </div>
    </div>
  );
}
