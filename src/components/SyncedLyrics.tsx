/**
 * Time-synced lyrics.
 *
 * The line being sung lights as it's sung: a soft-edged sweep runs across its
 * words, each word lifts a little as it lands and settles back, and a word held
 * long enough swells and glows a letter at a time. The rows around it sit back,
 * dimmer, a touch smaller and softly out of focus the further they are. The
 * panel sets off for the next line in the breath before it, the rows behind
 * fanning out and closing up as it lands. A break counts itself out in three
 * dots, and an answering vocal opens under its line as it's sung. Click a line
 * to seek there.
 *
 * lib/lyricMotion works the movement out from the timings; this draws it. One
 * frame loop repaints what's moving, writing straight onto those elements, so
 * React only renders when a line hands over.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getPlaybackPosition } from "../lib/audio";
import { visibleLyricLines } from "../lib/lyricsLines";
import { romanize } from "../lib/romanize";
import { LYRICS_LOADING_LINES, pickLyricsLine } from "../lib/lyricsPhrases";
import {
  BACKING_LEAD_MS,
  BASE_TYPE_PX,
  BREAK_DOTS,
  BREAK_DOT_REST,
  BROWSING_LIGHT,
  FAN_ROWS,
  FAN_SHARE,
  GLOW_STRENGTH,
  ROW_LIGHT,
  ROW_REST_SCALE,
  ROW_SOFTNESS,
  SOFT_EDGE,
  UNSUNG,
  WORD_LIFT,
  atType,
  backingVoice,
  bareBacking,
  blurPx,
  fanDelayMs,
  fanOffset,
  handover,
  leadMs,
  leadVoice,
  liveAt,
  restingPose,
  type LiveRows,
  type VoiceMotion,
} from "../lib/lyricMotion";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useWindowVisible, useVisualSnapshot, visibleActivity } from "../lib/visualActivity";
import type { LyricsResult, SyncedLyricLine } from "../types";

const readPosition = (): number => usePlayer.getState().position;

interface LyricsViewProps {
  lyrics: LyricsResult | null;
  loading: boolean;
  large?: boolean;
  /** Fullscreen scale — the same treatments as `large`, sized for the
      fullscreen panel's height. Container, spacing and type only. */
  hero?: boolean;
  /** Where the live line's centre rests, as a fraction of the container's
      height (0.5 = dead centre). The fullscreen player measures the album
      cover's centre and passes that fraction, so the live line sits exactly
      beside it; everything else keeps the centred anchor. */
  anchor?: number;
  /** The playing track's id — pins the loading copy to one line per track. */
  trackKey?: string;
}

type LyricsVariant = "compact" | "large" | "hero";

/** Background vocals and romanized readings: a quieter line under the lyric. */
function subLineClass(variant: LyricsVariant): string {
  switch (variant) {
    case "hero":
      return "font-display text-[clamp(17px,1.9vw,28px)] leading-[1.3] font-bold";
    case "large":
      return "font-display text-[22px] leading-[1.3] font-bold";
    default:
      return "font-display text-[15px] leading-[1.35] font-bold";
  }
}

/** Line type scale — `hero` is the fullscreen variant of `large`. */
function lineSizeClass(variant: LyricsVariant): string {
  switch (variant) {
    case "hero":
      return "font-display text-[clamp(28px,3.4vw,54px)] leading-[1.22] tracking-[-0.03em] font-extrabold";
    case "large":
      return "font-display text-[40px] leading-[1.25] tracking-[-0.03em] font-extrabold";
    default:
      return "font-display text-[24px] leading-[1.4] tracking-[-0.02em] font-extrabold";
  }
}

/** Half the gap between rows, worn above and below each one so a closed break takes no room. */
const ROW_PAD: Record<LyricsVariant, string> = { hero: "14px", large: "10px", compact: "8px" };

const RTL = /[֐-ࣿ]/;

/** Each voice the frame loop redraws; it skips a frame when nothing on it has moved. */
type Painter = (at: number) => void;
type Register = (key: string, paint: Painter | null) => void;

export function LyricsView({
  lyrics,
  loading,
  large = false,
  hero = false,
  anchor = 0.5,
  offset = 0,
  trackKey,
}: LyricsViewProps & { offset?: number }) {
  const variant: LyricsVariant = hero ? "hero" : large ? "large" : "compact";
  // Synced lyrics gate the whole synced treatment; blurring the rows away from
  // the sung one is its own switch; the glow yields to reduced motion and blur.
  const syncedOn = useSettings((s) => s.syncedLyrics);
  const blurOn = useSettings((s) => s.blurUnfocusedLyrics);
  const romanOn = useSettings((s) => s.romanizeLyrics);
  const reduceMotion = useSettings((s) => s.reduceAnimation);
  const reduceBlur = useSettings((s) => s.reduceDynamicBlur);

  // While lyrics load, the lookup's stand-in is one of the
  // loading phrases — no spinner — picked once per track and held there.
  const loadingPhrase = useMemo(() => pickLyricsLine(LYRICS_LOADING_LINES), [trackKey]);

  const synced = lyrics?.synced ?? null;
  const lines = useMemo(() => (synced ? visibleLyricLines(synced) : null), [synced]);

  // Static text for the plain (unsynced) treatment: the provider's plain
  // lyrics when they exist, otherwise the synced lines' own words joined in
  // order — so switching synced lyrics OFF never blanks the panel on tracks
  // that only shipped synced lines. Gap/instrumental markers carry no words.
  const staticText = useMemo(() => {
    if (lyrics?.plain && lyrics.plain.trim()) return lyrics.plain;
    const fromSynced = (lines ?? [])
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0)
      .join("\n")
      .trim();
    return fromSynced || null;
  }, [lyrics, lines]);

  if (loading) {
    // Words, not a spinner — mobile's LyricsLoadingLine, dimmed like an
    // unsung line.
    return (
      <div className="flex justify-center py-12">
        <span
          className={`font-display font-extrabold text-ink-hi/55 animate-pulse ${
            hero
              ? "text-[30px] tracking-[-0.02em]"
              : large
                ? "text-[28px] tracking-[-0.02em]"
                : "text-[18px]"
          }`}
        >
          {loadingPhrase}
        </span>
      </div>
    );
  }

  if (!lyrics || !staticText) {
    return (
      <p
        className={`text-center text-ink-faint ${
          hero ? "py-16 text-lg" : large ? "py-16 text-base" : "py-10 text-sm"
        }`}
      >
        No lyrics available for this track.
      </p>
    );
  }

  if (synced && syncedOn && lines) {
    return (
      <SyncedLines
        lines={lines}
        variant={variant}
        anchor={anchor}
        offset={offset}
        source={lyrics.source}
        romanOn={romanOn}
        blurOn={blurOn && !reduceBlur}
        glowOn={blurOn && !reduceMotion && !reduceBlur}
        still={reduceMotion}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <pre
        className={`relative flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap font-sans text-ink-dim ${
          hero ? "h-full text-[17px] leading-8 py-2" : large ? "h-full text-[15px] leading-7 py-2" : "text-[13px] leading-6 py-2"
        }`}
      >
        {staticText}
      </pre>
    </div>
  );
}

/* ============================================================ the panel */

interface SyncedLinesProps {
  lines: SyncedLyricLine[];
  variant: LyricsVariant;
  anchor: number;
  offset: number;
  source?: string;
  romanOn: boolean;
  blurOn: boolean;
  glowOn: boolean;
  still: boolean;
}

/** A move of the list to the line it's heading for. */
interface Glide {
  from: number;
  delta: number;
  startedAt: number;
  durationMs: number;
  focus: number;
}

const sameLive = (a: LiveRows, b: LiveRows): boolean =>
  a.first === b.first && a.focus === b.focus && a.rows.length === b.rows.length && a.rows.every((r, i) => r === b.rows[i]);

function SyncedLines({ lines, variant, anchor, offset, source, romanOn, blurOn, glowOn, still }: SyncedLinesProps) {
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);
  const windowVisible = useWindowVisible();
  const position = useVisualSnapshot(usePlayer.subscribe, readPosition);

  // Lyric times live on the matched recording's timeline; the playing upload
  // may prepend an intro (music videos). offset converts element position →
  // lyric timeline.
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const clock = useCallback((): number => (getPlaybackPosition() - offsetRef.current) * 1000, []);

  const voices = useMemo(
    () => lines.map((line, i) => ({ lead: leadVoice(line, lines[i + 1]?.time), backing: line.bg ? backingVoice(line) : null })),
    [lines],
  );

  const [live, setLive] = useState<LiveRows>(() => liveAt(lines, (position - offset) * 1000));
  const liveRef = useRef(live);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const refreshLive = useCallback((at: number): void => {
    const next = liveAt(linesRef.current, at);
    if (sameLive(next, liveRef.current)) return;
    liveRef.current = next;
    setLive(next);
  }, []);

  const painters = useRef(new Map<string, Painter>());
  const register = useCallback<Register>((key, paint) => {
    if (paint) painters.current.set(key, paint);
    else painters.current.delete(key);
  }, []);
  const paintAll = useCallback((at: number): void => {
    for (const paint of painters.current.values()) paint(at);
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef<Array<HTMLElement | null>>([]);
  const glide = useRef<Glide | null>(null);
  /** Rows currently trailing a glide, by index, with the offset they were last given. */
  const fanned = useRef(new Map<number, number>());
  const [browsing, setBrowsing] = useState(false);
  const browsingRef = useRef(false);
  browsingRef.current = browsing;
  const lastHandScroll = useRef(0);

  const clearFans = useCallback((): void => {
    for (const index of fanned.current.keys()) rowEls.current[index]?.style.removeProperty("translate");
    fanned.current.clear();
  }, []);

  /** Where the scroller has to be for row `index`'s middle to rest on the anchor. */
  const targetFor = useCallback(
    (index: number): number | null => {
      const container = containerRef.current;
      const el = rowEls.current[index];
      if (!container || !el) return null;
      // Measured against the scroller itself: offsetTop would count from the
      // list instead while the list has a layer of its own (fullscreen's
      // .fs-moving). A trailing row's own offset is taken back out.
      const r = el.getBoundingClientRect();
      const trailing = fanned.current.get(index) ?? 0;
      const mid = container.scrollTop + r.top - container.getBoundingClientRect().top + r.height / 2 - trailing;
      const target = Math.max(0, mid - container.clientHeight * anchor);
      // Past the end the browser would stop the list anyway; a glide aimed there would fan rows for nothing.
      const room = container.scrollHeight - container.clientHeight;
      return room > 0 ? Math.min(room, target) : target;
    },
    [anchor],
  );

  /** Head for row `index`: a glide over the breath before it, or at once when that can't read as a glide. */
  const headFor = useCallback(
    (index: number, atOnce: boolean): void => {
      const container = containerRef.current;
      const target = targetFor(index);
      if (!container || target == null) return;
      clearFans();
      const from = container.scrollTop;
      const delta = target - from;
      const reduce =
        still ||
        document.documentElement.classList.contains("reduce-motion") ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (atOnce || reduce || !usePlayer.getState().playing || Math.abs(delta) > container.clientHeight * 1.5) {
        glide.current = null;
        container.scrollTop = target;
        return;
      }
      glide.current = { from, delta, startedAt: performance.now(), durationMs: leadMs(linesRef.current, clock()), focus: index };
    },
    [targetFor, clearFans, still, clock],
  );

  /** One frame of the glide: the list moves on the handover curve, the rows behind it a little later. */
  const stepGlide = useCallback(
    (now: number): void => {
      const g = glide.current;
      const container = containerRef.current;
      if (!g || !container) return;
      const elapsed = now - g.startedAt;
      container.scrollTop = g.from + g.delta * handover(Math.min(1, elapsed / g.durationMs));
      const lo = Math.max(0, g.focus - 14);
      const hi = Math.min(linesRef.current.length - 1, g.focus + 14);
      for (let i = lo; i <= hi; i++) {
        const delay = fanDelayMs(i, g.focus, g.delta, g.durationMs);
        const y = fanOffset(g.delta, elapsed, g.durationMs, delay);
        const el = rowEls.current[i];
        if (!el) continue;
        if (Math.abs(y) < 0.05) {
          if (fanned.current.delete(i)) el.style.removeProperty("translate");
        } else {
          fanned.current.set(i, y);
          el.style.translate = `0 ${y.toFixed(2)}px`;
        }
      }
      if (elapsed >= g.durationMs * (1 + FAN_SHARE * FAN_ROWS)) {
        glide.current = null;
        clearFans();
      }
    },
    [clearFans],
  );

  const finishGlide = useCallback((): void => {
    const g = glide.current;
    const container = containerRef.current;
    if (g && container) container.scrollTop = g.from + g.delta;
    glide.current = null;
    clearFans();
  }, [clearFans]);

  // Every frame while it plays: who's being sung, what's moving on them, and the glide.
  useEffect(() => {
    if (!playing) {
      finishGlide();
      return;
    }
    return visibleActivity.runFrames((now) => {
      const at = clock();
      refreshLive(at);
      paintAll(at);
      stepGlide(now);
    });
  }, [playing, clock, refreshLive, paintAll, stepGlide, finishGlide]);

  // Paused, seeking or coming back: the clock moved without a frame to say so.
  useEffect(() => {
    const at = (position - offset) * 1000;
    refreshLive(at);
    paintAll(at);
  }, [position, offset, lines, refreshLive, paintAll]);

  // The first placement, and the first after being hidden, land at once rather
  // than glide. Spent only when a placement actually runs: one superseded by a
  // newer line before its frame keeps it for the one that replaces it.
  const landAtOnce = useRef(true);
  useEffect(() => {
    if (windowVisible) return;
    finishGlide();
    landAtOnce.current = true;
  }, [windowVisible, finishGlide]);

  // The panel follows the row it's heading for; a handover glides.
  const placedFor = useRef(-1);
  const wasBrowsing = useRef(false);
  useLayoutEffect(() => {
    if (browsing || !windowVisible) {
      wasBrowsing.current = browsing;
      return;
    }
    const focus = live.focus;
    if (focus < 0) return;
    const back = wasBrowsing.current;
    wasBrowsing.current = false;
    if (focus === placedFor.current && !back && !landAtOnce.current) return;
    placedFor.current = focus;
    // The rows have to be laid out for their middles to mean anything.
    const frame = requestAnimationFrame(() => {
      const atOnce = landAtOnce.current;
      landAtOnce.current = false;
      headFor(focus, atOnce);
    });
    return () => cancelAnimationFrame(frame);
  }, [live.focus, browsing, windowVisible, headFor]);

  // The fullscreen cover re-measures every frame while it moves: the line
  // follows the anchor at once, and a glide in flight just takes the new target.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const focus = liveRef.current.focus;
    if (!container || focus < 0 || browsingRef.current) return;
    const target = targetFor(focus);
    if (target == null) return;
    const g = glide.current;
    if (g) g.delta = target - g.from;
    else container.scrollTop = target;
  }, [anchor, targetFor]);

  // Reading by hand: the list stops following, flattens to one brightness and
  // drops its blur. It picks the song back up once the line being sung is back
  // in view and the hand has been still for a moment, or after a longer rest.
  const beginBrowsing = useCallback((): void => {
    lastHandScroll.current = performance.now();
    glide.current = null;
    clearFans();
    if (!browsingRef.current) setBrowsing(true);
  }, [clearFans]);
  useEffect(() => {
    if (!browsing || !playing) return;
    const id = window.setInterval(() => {
      const idle = performance.now() - lastHandScroll.current;
      const container = containerRef.current;
      const el = rowEls.current[liveRef.current.focus];
      let inView = false;
      if (container && el) {
        const c = container.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        inView = r.bottom > c.top && r.top < c.bottom;
      }
      if ((idle > 600 && inView) || idle > 5000) setBrowsing(false);
    }, 150);
    return () => window.clearInterval(id);
  }, [browsing, playing]);

  const typeClass = lineSizeClass(variant);
  const subClass = subLineClass(variant);
  // Spacers: the scroll target puts the live line's centre at `anchor` ×
  // container height. Both panels park the list at the top of the area with
  // a small fixed head spacer, so singing starting can't reposition it; later
  // lines glide to the anchor (fullscreen: beside the cover). % heights resolve
  // against the scroller's own height; the −fudge is ~half a line so the line
  // *centre* lands on the anchor.
  const headFudge = variant === "hero" ? 36 : variant === "large" ? 28 : 20;
  const topSpacer = "calc(10% + 4px)";
  const bottomSpacer = `max(12px, calc(${(1 - anchor) * 100}% - ${headFudge}px))`;

  return (
    <div
      className="relative flex-1 min-h-0 -mx-6"
      style={{
        // Horizontal twin of the vertical melt below: the live line's glow
        // fades toward the panel edges instead of stopping on a hard line.
        maskImage: "linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)",
        WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)",
      }}
    >
      <div
        ref={containerRef}
        onWheel={beginBrowsing}
        onPointerDown={beginBrowsing}
        onScroll={() => {
          if (browsingRef.current) lastHandScroll.current = performance.now();
        }}
        className="absolute inset-0 overflow-y-auto scroll-host px-6 py-0"
        style={{
          // Lines melt into the dark at the panel edges instead of stopping hard.
          maskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
        }}
      >
        <div aria-hidden="true" style={{ height: topSpacer, flexShrink: 0 }} />
        <div
          className="lyrics-lines"
          data-still={still ? "" : undefined}
          style={{ "--ly-pad": ROW_PAD[variant] } as CSSProperties}
        >
          {lines.map((line, i) => {
            // Brightness and focus follow the line being sung, not the one the
            // panel is heading for: they say "these are the words now".
            const isActive = live.rows.includes(i);
            const distance = live.first < 0 ? 0 : Math.abs(i - live.first);
            const step = Math.min(distance, ROW_LIGHT.length - 1);
            const sung = live.first >= 0 && i < live.first;
            const light = isActive ? 1 : browsing ? BROWSING_LIGHT : ROW_LIGHT[step];
            const softEm = !blurOn || browsing || isActive ? 0 : blurPx(ROW_SOFTNESS[step]) / BASE_TYPE_PX;
            const rowRef = (el: HTMLElement | null): void => {
              rowEls.current[i] = el;
            };
            const onSeek = (): void => seek(Math.max(0, line.time + offset - 0.15));
            if (line.gap) {
              return (
                <BreakRow
                  key={`${line.time}-${i}`}
                  index={i}
                  line={line}
                  until={lines[i + 1]?.time ?? line.end ?? line.time + 5}
                  open={isActive}
                  light={light}
                  softEm={softEm}
                  typeClass={typeClass}
                  register={register}
                  rowRef={rowRef}
                  onSeek={onSeek}
                />
              );
            }
            const { lead, backing } = voices[i];
            const roman = romanOn ? (line.roman ?? romanize(line.text)) : null;
            const bgText = line.bg ? bareBacking(line.bg.text) : "";
            return (
              <button
                key={`${line.time}-${i}`}
                ref={rowRef}
                onClick={onSeek}
                title="Jump here"
                className={`ly-row block w-full text-left ${typeClass}`}
                style={{
                  opacity: light,
                  filter: softEm ? `blur(${softEm.toFixed(4)}em)` : "none",
                  scale: String(isActive ? 1 : ROW_REST_SCALE),
                }}
              >
                {lead ? (
                  <SweptVoice
                    voice={lead}
                    paintKey={`${i}:lead`}
                    tail={sung ? 1 : UNSUNG}
                    soft={isActive}
                    rise={!still}
                    glowOn={glowOn}
                    glow={isActive && glowOn ? GLOW_STRENGTH : 0}
                    clock={clock}
                    register={register}
                  />
                ) : (
                  // No word timings: the line lights whole as it starts, and
                  // holds back until then the way unsung words do.
                  <span className="ly-plain" style={{ "--ly-tail": sung || isActive ? 1 : UNSUNG } as CSSProperties}>
                    {line.text}
                  </span>
                )}
                {bgText && (
                  <Backing
                    index={i}
                    text={bgText}
                    voice={backing}
                    open={isActive || i === live.focus}
                    sung={sung}
                    clock={clock}
                    register={register}
                  />
                )}
                {roman && <span className={`block mt-1 text-ink-hi/60 ${subClass}`}>{roman}</span>}
              </button>
            );
          })}
          {source && <p className="pt-4 text-[12px] font-medium text-ink-hi/45">Lyrics from {source}</p>}
        </div>
        <div aria-hidden="true" style={{ height: bottomSpacer, flexShrink: 0 }} />
      </div>
    </div>
  );
}

/* ============================================================ a voice */

/** The words of a voice as drawn: words one space apart, a held word letter by letter. */
function Words({ voice }: { voice: VoiceMotion }) {
  return (
    <>
      {voice.words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          {voice.held[i] ? (
            <span className="ly-word">
              {[...w.text].map((c, j) => (
                <span key={j} className="ly-unit ly-letter">
                  {c}
                </span>
              ))}
            </span>
          ) : (
            <span className="ly-unit ly-word">{w.text}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}

interface UnitBox {
  el: HTMLElement;
  left: number;
  right: number;
  row: number;
  /** What was last painted: "lit", "dim" or the edge's gradient. */
  ink: string;
}

/**
 * One voice of a row, swept as it's sung. Every piece that lights is painted
 * on its own — lit, unsung, or the edge between, a gradient that fades over
 * SOFT_EDGE ahead of where the singing is — so the lit part moves with a word
 * that lifts. A held word's letters each swell, lean and lift on their own, and
 * a blurred copy of just those letters behind the line is their glow.
 */
function SweptVoice({
  voice,
  paintKey,
  tail,
  soft,
  rise,
  glowOn,
  glow,
  clock,
  register,
}: {
  voice: VoiceMotion;
  paintKey: string;
  /** How bright the words still to be sung are. */
  tail: number;
  /** Whether the sweep's edge is feathered: only on a line being sung. */
  soft: boolean;
  rise: boolean;
  glowOn: boolean;
  glow: number;
  clock: () => number;
  register: Register;
}) {
  const host = useRef<HTMLSpanElement | null>(null);
  const inkRef = useRef<HTMLSpanElement | null>(null);
  const bloomRef = useRef<HTMLSpanElement | null>(null);
  const opts = useRef({ soft, rise });
  opts.current = { soft, rise };
  const paintRef = useRef<Painter | null>(null);
  const hasHeld = voice.held.some(Boolean);
  const showBloom = glowOn && hasHeld;

  useLayoutEffect(() => {
    const root = host.current;
    const ink = inkRef.current;
    if (!root || !ink) return;
    const bloom = bloomRef.current;
    const rtl = RTL.test(voice.text);
    const wordEls = Array.from(ink.children) as HTMLElement[];
    const bloomWords = bloom ? (Array.from(bloom.children) as HTMLElement[]) : [];
    // Each word's paintable pieces: the word itself, or a held word's letters.
    const units: UnitBox[][] = wordEls.map((w, i) =>
      (voice.held[i] ? (Array.from(w.children) as HTMLElement[]) : [w]).map((el) => ({ el, left: 0, right: 0, row: 0, ink: "" })),
    );
    const words = units.map(() => ({ left: 0, right: 0, row: 0 }));
    let rows: Array<{ top: number; left: number; right: number }> = [];
    let typePx = BASE_TYPE_PX;

    const measure = (): void => {
      typePx = parseFloat(getComputedStyle(root).fontSize) || BASE_TYPE_PX;
      rows = [];
      units.forEach((list, i) => {
        list.forEach((u) => {
          u.left = u.el.offsetLeft;
          u.right = u.left + u.el.offsetWidth;
          const top = u.el.offsetTop;
          let row = rows.findIndex((r) => Math.abs(r.top - top) < 2);
          if (row < 0) {
            rows.push({ top, left: u.left, right: u.right });
            row = rows.length - 1;
          }
          rows[row].left = Math.min(rows[row].left, u.left);
          rows[row].right = Math.max(rows[row].right, u.right);
          u.row = row;
        });
        words[i] = {
          left: Math.min(...list.map((u) => u.left)),
          right: Math.max(...list.map((u) => u.right)),
          row: list[0].row,
        };
      });
    };

    const LIT = "rgb(var(--ink-hi))";
    const DIM = "rgb(var(--ink-hi) / var(--ly-tail))";
    const setInk = (u: UnitBox, ink: string): void => {
      if (u.ink === ink) return;
      u.ink = ink;
      if (ink === "lit" || ink === "dim") {
        u.el.dataset.ink = ink;
        u.el.style.removeProperty("background-image");
      } else {
        u.el.dataset.ink = "edge";
        u.el.style.backgroundImage = ink;
      }
    };

    /** Where the singing is: a row and an x across it, or the whole line one way or the other. */
    const boundary = (reach: number): { row: number; x: number } | "none" | "all" => {
      if (reach <= 0) return "none";
      if (reach >= voice.text.length) return "all";
      const ws = voice.words;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        const box = words[i];
        if (reach < w.from) break;
        if (reach < w.to) {
          // Across a word at a steady pace, not letter by letter.
          const share = (reach - w.from) / (w.to - w.from);
          const width = box.right - box.left;
          return { row: box.row, x: rtl ? box.right - width * share : box.left + width * share };
        }
        const next = ws[i + 1];
        if (next && reach < next.from) {
          const nb = words[i + 1];
          if (nb.row !== box.row) return { row: box.row, x: rtl ? box.left : box.right };
          const through = (reach - w.to) / (next.from - w.to);
          return { row: box.row, x: rtl ? box.left - (box.left - nb.right) * through : box.right + (nb.left - box.right) * through };
        }
      }
      return "all";
    };

    const pose = restingPose();
    const lastLift = new Map<HTMLElement, string>();
    const place = (el: HTMLElement, prop: "translate" | "transform", value: string): void => {
      if (lastLift.get(el) === value) return;
      lastLift.set(el, value);
      if (value) el.style[prop] = value;
      else el.style.removeProperty(prop);
    };
    const lastLight = new Map<HTMLElement, string>();
    const light = (el: HTMLElement, color: string): void => {
      if (lastLight.get(el) === color) return;
      lastLight.set(el, color);
      el.style.color = color;
    };
    let lastReach = NaN;
    let lastSoft: boolean | null = null;
    let wasMoving = true;

    const paint = (at: number): void => {
      const { soft: feathered, rise: rising } = opts.current;
      const reach = voice.sungChars(at);
      const moving = rising && at >= voice.fromMs - 1 && at <= voice.untilMs + 1;
      if (reach === lastReach && feathered === lastSoft && !moving && !wasMoving) return;
      lastReach = reach;
      lastSoft = feathered;
      wasMoving = moving;

      // The sweep.
      const edge = boundary(reach);
      if (edge === "none" || edge === "all") {
        for (const list of units) for (const u of list) setInk(u, edge === "all" ? "lit" : "dim");
      } else {
        const band = rows[edge.row];
        const fade = feathered
          ? Math.max(0, Math.min(atType(SOFT_EDGE, typePx), rtl ? band.right - edge.x : edge.x - band.left))
          : 0;
        for (const list of units) {
          for (const u of list) {
            if (u.row < edge.row) setInk(u, "lit");
            else if (u.row > edge.row) setInk(u, "dim");
            else if (!rtl) {
              if (u.right <= edge.x) setInk(u, "lit");
              else if (u.left >= edge.x + fade) setInk(u, "dim");
              else setInk(u, `linear-gradient(90deg, ${LIT} ${(edge.x - u.left).toFixed(1)}px, ${DIM} ${(edge.x + fade - u.left).toFixed(1)}px)`);
            } else if (u.left >= edge.x) setInk(u, "lit");
            else if (u.right <= edge.x - fade) setInk(u, "dim");
            else setInk(u, `linear-gradient(270deg, ${LIT} ${(u.right - edge.x).toFixed(1)}px, ${DIM} ${(u.right - edge.x + fade).toFixed(1)}px)`);
          }
        }
      }

      // The lift, and a held word's letters.
      const lift = atType(WORD_LIFT, typePx);
      voice.words.forEach((_, i) => {
        const wordEl = wordEls[i];
        const held = voice.held[i];
        if (rising && held && held.moving(at)) {
          place(wordEl, "translate", "");
          const settle = voice.settle(i, at);
          units[i].forEach((u, j) => {
            held.pose(j, at, pose);
            const t = `translate(${(pose.lean * typePx).toFixed(2)}px, ${(-pose.lift * lift * settle).toFixed(2)}px) scale(${pose.scale.toFixed(4)})`;
            place(u.el, "transform", t);
            const glowLetter = bloomWords[i]?.children[j] as HTMLElement | undefined;
            if (glowLetter) {
              place(glowLetter, "transform", t);
              light(glowLetter, pose.light > 0.01 ? `rgb(var(--ink-hi) / ${pose.light.toFixed(3)})` : "");
            }
          });
          return;
        }
        if (held) {
          units[i].forEach((u, j) => {
            place(u.el, "transform", "");
            const glowLetter = bloomWords[i]?.children[j] as HTMLElement | undefined;
            if (glowLetter) {
              place(glowLetter, "transform", "");
              light(glowLetter, "");
            }
          });
        }
        const up = rising ? voice.lift(i, at) * lift : 0;
        place(wordEl, "translate", up > 0.01 ? `0 ${(-up).toFixed(2)}px` : "");
      });
    };

    measure();
    paintRef.current = paint;
    register(paintKey, paint);
    paint(clock());
    // A new width or a font arriving moves every word: measure again.
    const resize = new ResizeObserver(() => {
      measure();
      for (const list of units) for (const u of list) u.ink = "";
      lastReach = NaN;
      paint(clock());
    });
    resize.observe(root);
    return () => {
      resize.unobserve(root);
      register(paintKey, null);
      paintRef.current = null;
    };
  }, [voice, showBloom, paintKey, register, clock]);

  // The edge softens, or the words stop lifting, without a new frame to show it.
  useEffect(() => {
    paintRef.current?.(clock());
  }, [soft, rise, clock]);

  return (
    <span ref={host} dir="auto" className="ly-voice" style={{ "--ly-tail": tail } as CSSProperties}>
      <span ref={inkRef} className="ly-ink">
        <Words voice={voice} />
      </span>
      {showBloom && (
        <span ref={bloomRef} aria-hidden="true" className="ly-bloom" style={{ opacity: glow }}>
          <Words voice={voice} />
        </span>
      )}
    </span>
  );
}

/* ============================================================ backing vocal */

/**
 * The answering vocal, opening under its line: room made for it as it comes,
 * the words fading in a little ahead and rising the last few pixels into place.
 * A timed one opens just before its first word and folds away when it's sung;
 * one without timings shows while its line is being sung or headed for.
 */
function Backing({
  index,
  text,
  voice,
  open,
  sung,
  clock,
  register,
}: {
  index: number;
  text: string;
  voice: VoiceMotion | null;
  open: boolean;
  sung: boolean;
  clock: () => number;
  register: Register;
}) {
  const host = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!voice) return;
    const last = voice.words[voice.words.length - 1].endMs;
    let shown: boolean | null = null;
    const key = `${index}:backing`;
    const paint = (at: number): void => {
      const due = at >= voice.fromMs - BACKING_LEAD_MS && at < last;
      if (due === shown) return;
      shown = due;
      host.current?.toggleAttribute("data-open", due);
    };
    register(key, paint);
    paint(clock());
    return () => register(key, null);
  }, [voice, index, register, clock]);

  return (
    <span ref={host} className="ly-backing" data-open={!voice && open ? "" : undefined}>
      <span className="ly-backing-inner">
        {voice ? (
          <SweptVoice
            voice={voice}
            paintKey={`${index}:backing-words`}
            tail={sung ? 1 : UNSUNG}
            soft={open}
            rise={false}
            glowOn={false}
            glow={0}
            clock={clock}
            register={register}
          />
        ) : (
          <span className="ly-plain" style={{ "--ly-tail": sung || open ? 1 : UNSUNG } as CSSProperties}>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}

/* ============================================================ a break */

/** An instrumental break: three dots lighting in turn across it, its row open only while it plays. */
function BreakRow({
  index,
  line,
  until,
  open,
  light,
  softEm,
  typeClass,
  register,
  rowRef,
  onSeek,
}: {
  index: number;
  line: SyncedLyricLine;
  until: number;
  open: boolean;
  light: number;
  softEm: number;
  typeClass: string;
  register: Register;
  rowRef: (el: HTMLElement | null) => void;
  onSeek: () => void;
}) {
  const dots = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    const from = line.time * 1000;
    const to = Math.max(from + 1, until * 1000);
    let last = -1;
    const key = `${index}:break`;
    register(key, (at) => {
      const through = Math.min(1, Math.max(0, (at - from) / (to - from)));
      const step = Math.round(through * 600);
      if (step === last) return;
      last = step;
      dots.current.forEach((dot, k) => {
        if (!dot) return;
        // Each dot owns a third of the break and fills across it.
        const lit = Math.min(1, Math.max(0, through * BREAK_DOTS - k));
        dot.style.opacity = (BREAK_DOT_REST + (1 - BREAK_DOT_REST) * lit).toFixed(3);
      });
    });
    return () => register(key, null);
  }, [line, until, index, register]);

  return (
    <button
      ref={rowRef}
      onClick={onSeek}
      title="Instrumental"
      aria-label="Instrumental"
      className={`ly-row ly-break block w-full text-left ${typeClass}`}
      data-open={open ? "" : undefined}
      style={{ "--ly-light": light, filter: softEm ? `blur(${softEm.toFixed(4)}em)` : "none" } as CSSProperties}
    >
      <span className="ly-dots">
        {Array.from({ length: BREAK_DOTS }, (_, k) => (
          <span
            key={k}
            ref={(el) => {
              dots.current[k] = el;
            }}
            className="ly-dot"
          />
        ))}
      </span>
    </button>
  );
}
