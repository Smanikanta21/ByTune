/**
 * The movement of synced lyrics, worked out from the timings alone.
 *
 * How far the sweep has got across a line, how high each sung word sits, how a
 * word held long enough swells, leans, lifts and glows a letter at a time, and
 * which rows the panel is showing and heading for. Times are milliseconds;
 * lengths are given at BASE_TYPE_PX and scaled to the type actually drawn, so
 * the same motion reads the same at every size. Nothing here touches the page:
 * the lyrics view draws what this works out.
 */
import type { SyncedLyricLine, SyncedLyricWord } from "../types";

/* --------------------------------------------------------------- the look */

/** The type size the lengths below are given at. */
export const BASE_TYPE_PX = 34;
/** A length given at BASE_TYPE_PX, at `typePx`. */
export const atType = (length: number, typePx: number): number => (length * typePx) / BASE_TYPE_PX;

/** The words of a line still to be sung, and lines not reached yet, held back to this. */
export const UNSUNG = 0.45;
/** Rows' brightness by distance from the one being sung; the last stands for everything further. */
export const ROW_LIGHT = [1, 0.8, 0.7, 0.58, 0.46] as const;
/** Rows' softness by the same distance, as a blur radius at BASE_TYPE_PX. */
export const ROW_SOFTNESS = [0, 1, 1, 1.7, 2.4] as const;
/** Every row while the list is being read by hand, so none is pointed at. */
export const BROWSING_LIGHT = 0.8;
/** Rows other than the one being sung sit fractionally back. */
export const ROW_REST_SCALE = 0.98;
/** The bloom behind held letters at its strongest. */
export const GLOW_STRENGTH = 0.62;
/** How far the bloom spreads off a letter (blur radius). */
export const GLOW_SPREAD = 6;
/** The sweep's leading edge fades out over this much, ahead of where the singing is. */
export const SOFT_EDGE = 30;
/** How far a sung word lifts off its line at most. */
export const WORD_LIFT = 2;
/** One handover's dimming, blurring, scaling and scrolling. */
export const SETTLE_MS = 400;
/** The bloom fading in and out with its line. */
export const GLOW_FADE_MS = 420;
/** The panel's move to the next line: started this long before it lands, and lasting as long. */
export const LEAD_MIN_MS = 350;
export const LEAD_MAX_MS = 500;
/** Rows behind the one moved to set off a share of the move later, up to a few rows back. */
export const FAN_ROWS = 3;
export const FAN_SHARE = 0.06;

/** A break counts itself out: dots lighting in turn across the silence. */
export const BREAK_DOTS = 3;
export const BREAK_DOT = 13;
export const BREAK_DOT_GAP = 5;
export const BREAK_DOT_REST = 0.25;
export const BREAK_REST_SCALE = 0.76;
export const BREAK_HEIGHT = 40;

/** The answering vocal under a line: smaller, a shade back, opening as it's due. */
export const BACKING_TYPE = 23 / 34;
export const BACKING_LINE_HEIGHT = 29 / 23;
export const BACKING_LIGHT = 0.72;
export const BACKING_LEAD_MS = 250;
export const BACKING_OPEN_MS = 400;
export const BACKING_CLOSE_MS = 450;
export const BACKING_RISE = 6;
export const BACKING_REST_SCALE = 0.94;

/** A blur radius as CSS draws it: the browser's blur() takes a standard deviation. */
export const blurPx = (radius: number): number => (radius > 0 ? radius * 0.57735 : 0);

/* ----------------------------------------------------------------- curves */

/** cubic-bezier(x1, y1, x2, y2) as a function of progress, solved for x the way CSS does. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 1 + 3 * x1 - 3 * x2;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 + 3 * y1 - 3 * y2;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const x = (u: number): number => ((ax * u + bx) * u + cx) * u;
  const slope = (u: number): number => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const off = x(u) - t;
      if (Math.abs(off) < 1e-7) break;
      const d = slope(u);
      if (Math.abs(d) < 1e-6) break;
      u -= off / d;
    }
    if (!(u >= 0 && u <= 1) || Math.abs(x(u) - t) > 1e-5) {
      let lo = 0;
      let hi = 1;
      u = t;
      for (let i = 0; i < 40 && Math.abs(x(u) - t) > 1e-7; i++) {
        if (x(u) < t) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return ((ay * u + by) * u + cy) * u;
  };
}

/** Away quickly, in slowly and softly: one curve for every part of a handover. */
export const HANDOVER = [0.41, 0, 0.12, 0.99] as const;
export const handover = cubicBezier(...HANDOVER);
export const HANDOVER_CSS = `cubic-bezier(${HANDOVER.join(", ")})`;
/** The bloom's fade and a closing backing line. */
export const SOFT_CSS = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Eased in and out of both ends, so nothing it drives has a corner. */
const ease = (f: number): number => f * f * (3 - 2 * f);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------ word motion */

/** A word longer than its rise or settle is never quicker than this to go up. */
const RISE_MS = 700;
const RISE_SHORTEST_MS = 250;
/** How high a word goes, from how long it's held: patter barely leaves the line. */
const LIFT_QUICK_MS = 150;
const LIFT_FULL_MS = 900;
const LIFT_LEAST = 0.25;

/** Share of the full lift a word held `heldMs` reaches. */
export function liftReach(heldMs: number): number {
  return LIFT_LEAST + (1 - LIFT_LEAST) * ease(clamp01((heldMs - LIFT_QUICK_MS) / (LIFT_FULL_MS - LIFT_QUICK_MS)));
}

/** One sung word, placed in the line's drawn text as characters [from, to). */
export interface SungWord {
  text: string;
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

/** Where one letter of a held word is: swell, lean (in ems), lift (in word lifts), light (0..1). */
export interface LetterPose {
  scale: number;
  lean: number;
  lift: number;
  light: number;
}

export const restingPose = (): LetterPose => ({ scale: 1, lean: 0, lift: 0, light: 0 });

/* What qualifies a word for the letter-by-letter treatment, and the shape of it. */
const HOLD_LONGEST = 7;
const HOLD_ONE_MS = 1100;
const HOLD_SHORT_MS = 1360;
const HOLD_SHORT_STEP_MS = 140;
const HOLD_FOUR_MS = 1050;
const HOLD_LONG_MS = 900;
const HOLD_PER_LETTER_MS = 200;
const STAGGER = 0.09;
const MOVE_SPAN = 1.5;
const UP_BY = 0.25;
const HELD_TO = 0.3;
const DOWN_BY = 0.75;
const RESTS_AT_LIFT = 1;
const EARN_FROM_MS = 400;
const EARN_FULL_MS = 3000;
const SWELL_SHORT = 0.05;
const SWELL_LONG = 0.04;
const SWELL_RANGE = 0.08;
const SWELL_CEILING = 0.1;
const SWELL_TRIM = 0.98;
const LEAN_EM = 25 / 34;
const LIGHT_FLOOR = 0.35;
const LIGHT_RANGE = 0.45;
const LIGHT_PACE_MS = 1500;
const LIGHT_PACE_MOST = 1.1;
const LIGHT_SHORT = 0.85;
const LIGHT_LONG = 1.1;
const LIFT_PACE_MS = 2000;
const LIFT_PACE_LEAST = 0.3;

/** Han, kana and Hangul draw as blocks; Hebrew and Arabic join up. Neither swells a letter at a time. */
const BLOCKY = /[一-鿿぀-ゟ゠-ヿ가-힯֐-ࣿ]/;

/** Whether a word is held long enough, and short enough, to move a letter at a time. */
export function holdsLong(text: string, heldMs: number): boolean {
  const n = [...text].length;
  // A "word" with a space in it is a phrase a provider didn't split: it doesn't swell as one.
  if (n === 0 || n > HOLD_LONGEST || /[-\s]/.test(text) || BLOCKY.test(text)) return false;
  if (n === 1) return heldMs >= HOLD_ONE_MS;
  if (n <= 3) return heldMs >= HOLD_SHORT_MS + (n - 2) * HOLD_SHORT_STEP_MS;
  if (n === 4) return heldMs >= HOLD_FOUR_MS;
  return heldMs >= HOLD_LONG_MS && heldMs >= n * HOLD_PER_LETTER_MS;
}

/** How much of the movement later letters give up: long words and barely-held ones damp their tail. */
function tailDamping(letters: number, heldMs: number): number {
  const long = letters > 5;
  const quick = heldMs < 1200;
  let strength = 0;
  if (long) strength += Math.min((letters - 5) / 5, 1) * 0.4;
  if (quick) strength += Math.max(0, 1 - (heldMs - 800) / 400) * (letters > 3 ? 0.3 : 0.1);
  return Math.min(strength, 0.7);
}

/** A word held long enough that each letter swells, leans, lifts and lights in turn. */
export class HeldWord {
  readonly restsAtMs: number;
  private readonly peaks: Float64Array;

  constructor(
    readonly index: number,
    readonly letters: number,
    readonly startMs: number,
    readonly endMs: number,
  ) {
    const held = Math.max(1, endMs - startMs);
    const earned = clamp01((held - EARN_FROM_MS) / (EARN_FULL_MS - EARN_FROM_MS)) ** 3;
    const damping = tailDamping(letters, held);
    const lightPace = Math.min(LIGHT_PACE_MOST, held / LIGHT_PACE_MS);
    const lightSpread = letters <= 3 ? LIGHT_SHORT : letters >= 6 ? LIGHT_LONG : 1;
    const base = letters <= 3 ? SWELL_SHORT : SWELL_LONG;
    const liftPace = Math.min(1, Math.max(LIFT_PACE_LEAST, held / LIFT_PACE_MS));
    // Four numbers a letter: swell, lean, lift and light at the top of its move.
    this.peaks = new Float64Array(letters * 4);
    for (let i = 0; i < letters; i++) {
      const along = letters > 1 ? i / (letters - 1) : 0;
      const reach = earned * (1 - along * damping);
      const swell = 1 + base + reach * SWELL_RANGE;
      const middle = (i + 0.5) / letters;
      this.peaks[i * 4] = swell * SWELL_TRIM;
      this.peaks[i * 4 + 1] = (middle - 0.5) * 2 * (swell - 1) * LEAN_EM * SWELL_TRIM;
      this.peaks[i * 4 + 2] = ((swell - 1) / SWELL_CEILING) * liftPace;
      this.peaks[i * 4 + 3] = (LIGHT_FLOOR + reach * LIGHT_RANGE) * lightPace * lightSpread;
    }
    this.restsAtMs = startMs + held * (Math.max(0, letters - 1) * STAGGER + MOVE_SPAN);
  }

  /** Whether any of its letters is moving at `at`. */
  moving(at: number): boolean {
    return at >= this.startMs && at <= this.restsAtMs;
  }

  /** Where letter `i` is at `at`, written into `pose`. */
  pose(i: number, at: number, pose: LetterPose): LetterPose {
    const span = Math.max(1, this.endMs - this.startMs);
    const phase = clamp01((at - this.startMs - i * span * STAGGER) / (span * MOVE_SPAN));
    const swell = this.peaks[i * 4];
    const lean = this.peaks[i * 4 + 1];
    const lift = this.peaks[i * 4 + 2];
    const light = this.peaks[i * 4 + 3];
    if (phase < UP_BY) {
      const t = ease(phase / UP_BY);
      pose.scale = 1 + (swell - 1) * t;
      pose.lean = lean * t;
      pose.lift = lift * t;
      pose.light = light * t;
    } else if (phase < HELD_TO) {
      pose.scale = swell;
      pose.lean = lean;
      pose.lift = lift;
      pose.light = light;
    } else if (phase < DOWN_BY) {
      const t = ease((phase - HELD_TO) / (DOWN_BY - HELD_TO));
      pose.scale = swell + (1 - swell) * t;
      pose.lean = lean * (1 - t);
      pose.lift = lift + (RESTS_AT_LIFT - lift) * t;
      pose.light = light * (1 - t);
    } else {
      pose.scale = 1;
      pose.lean = 0;
      pose.lift = RESTS_AT_LIFT;
      pose.light = 0;
    }
    return pose;
  }
}

/** One voice of a row — a lead line or its answering vocal — and how its words move. */
export class VoiceMotion {
  /** What's drawn: the words, one space apart. */
  readonly text: string;
  readonly words: SungWord[];
  /** The words held long enough to move a letter at a time, by word index. */
  readonly held: Array<HeldWord | undefined>;
  /** Before this nothing on the line has moved; after `untilMs` everything has settled. */
  readonly fromMs: number;
  readonly untilMs: number;
  private readonly reach: number[];

  constructor(words: Array<{ text: string; startMs: number; endMs: number }>) {
    let at = 0;
    this.words = words.map((w) => {
      const from = at === 0 ? 0 : at + 1;
      const to = from + w.text.length;
      at = to;
      return { text: w.text, startMs: w.startMs, endMs: w.endMs, from, to };
    });
    this.text = this.words.map((w) => w.text).join(" ");
    this.reach = this.words.map((w) => liftReach(w.endMs - w.startMs));
    // Letters as drawn: one per code point, the same count the view splits the word into.
    this.held = this.words.map((w, i) =>
      holdsLong(w.text, w.endMs - w.startMs) ? new HeldWord(i, [...w.text].length, w.startMs, w.endMs) : undefined,
    );
    const last = this.words[this.words.length - 1];
    this.fromMs = this.words[0]?.startMs ?? 0;
    const settled = last ? last.endMs + RISE_MS : 0;
    const grown = Math.max(-Infinity, ...this.held.map((h) => h?.restsAtMs ?? -Infinity));
    this.untilMs = Math.max(settled, grown);
  }

  /**
   * How many characters of the text have been sung at `at`, fractionally. A word
   * fills across its own time; the space after it fills over the pause before
   * the next one, so the sweep creeps on rather than resting on a last letter.
   */
  sungChars(at: number): number {
    const words = this.words;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (at < w.startMs) return w.from;
      if (at < w.endMs) return w.from + ((at - w.startMs) / Math.max(1, w.endMs - w.startMs)) * (w.to - w.from);
      const next = words[i + 1];
      if (next && at < next.startMs) {
        return w.to + ((at - w.endMs) / Math.max(1, next.startMs - w.endMs)) * (next.from - w.to);
      }
    }
    return this.text.length;
  }

  /** How far word `i` is off the line at `at`, as a share of WORD_LIFT: up over its own length, down over RISE_MS. */
  lift(i: number, at: number): number {
    const w = this.words[i];
    if (!w) return 0;
    const riseMs = Math.min(RISE_MS, Math.max(RISE_SHORTEST_MS, w.endMs - w.startMs));
    const rising = clamp01((at - w.startMs) / riseMs);
    const falling = clamp01(1 - (at - w.endMs) / RISE_MS);
    return this.reach[i] * ease(Math.min(rising, falling));
  }

  /** What's left of word `i`'s lift at `at` — its full height while sung, settling after. */
  settle(i: number, at: number): number {
    const w = this.words[i];
    if (!w) return 0;
    return this.reach[i] * ease(clamp01(1 - (at - w.endMs) / RISE_MS));
  }

  /** Whether anything on the line is off the floor at `at`. */
  lifted(at: number): boolean {
    if (!this.words.length || at <= this.words[0].startMs) return false;
    return at < this.words[this.words.length - 1].endMs + RISE_MS || this.held.some((h) => h?.moving(at));
  }
}

/* ----------------------------------------------------------------- voices */

const ms = (seconds: number): number => Math.round(seconds * 1000);

/**
 * The lead voice's words, kept inside the line's own slice of the song. Providers
 * hand over backing-vocal words that start before the line, and zero-length
 * ones; sane spans are clamped into the line, anything else is spread evenly
 * across it.
 */
export function leadVoice(line: SyncedLyricLine, nextTime: number | undefined): VoiceMotion | null {
  const words = line.words?.filter((w) => w.text.trim());
  if (!words?.length || line.gap) return null;
  const t0 = line.time;
  let t1 = nextTime ?? line.time + 4;
  const lastEnd = words[words.length - 1].end;
  if (lastEnd > line.time) t1 = Math.min(t1, Math.max(lastEnd, line.time + 1));
  if (t1 <= line.time) t1 = line.time + 3;
  const sane = words.every((w) => w.end > w.start && w.start >= t0 - 0.25 && w.end <= t1 + 0.5);
  const n = words.length;
  return new VoiceMotion(
    words.map((w, i) =>
      sane
        ? { text: w.text.trim(), startMs: ms(Math.max(t0, w.start)), endMs: ms(Math.min(t1, Math.max(w.start + 0.04, w.end))) }
        : { text: w.text.trim(), startMs: ms(t0 + ((t1 - t0) * i) / n), endMs: ms(t0 + ((t1 - t0) * (i + 1)) / n) },
    ),
  );
}

/** Brackets only ever marked the answering vocal as one; on its own row it's drawn bare. */
export const bareBacking = (text: string): string => text.replace(/[()]/g, "").trim();

/** The answering vocal's words, on its own clock, without its brackets. */
export function backingVoice(line: SyncedLyricLine): VoiceMotion | null {
  const words = line.bg?.words
    ?.map((w): SyncedLyricWord => ({ ...w, text: bareBacking(w.text) }))
    .filter((w) => w.text);
  if (!words?.length) return null;
  return new VoiceMotion(
    words.map((w) => ({ text: w.text, startMs: ms(w.start), endMs: ms(Math.max(w.start + 0.04, w.end)) })),
  );
}

/* ------------------------------------------------------------------- rows */

/** Whether the provider says when the line's singing stops, not only when it starts. */
export const hasKnownEnd = (line: SyncedLyricLine): boolean => !!line.words?.length || line.end != null;

/** When the line's singing stops — the last word, the line's own end, or its start when neither is known. */
export function lineEndMs(line: SyncedLyricLine): number {
  const lead = line.words?.length ? line.words[line.words.length - 1].end : line.end ?? line.time;
  const backing = line.bg?.words?.length ? line.bg.words[line.bg.words.length - 1].end : lead;
  return ms(Math.max(lead, backing));
}

/** The rows being sung at `at`: the latest to start, and any earlier one whose singing hasn't ended. */
export function liveRows(lines: SyncedLyricLine[], at: number): number[] {
  let latest = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ms(lines[i].time) <= at) latest = i;
    else break;
  }
  if (latest < 0) return [];
  const rows: number[] = [];
  for (let i = 0; i <= latest; i++) {
    const line = lines[i];
    if (i === latest || (!line.gap && hasKnownEnd(line) && ms(line.time) <= at && at < lineEndMs(line))) rows.push(i);
  }
  return rows;
}

/**
 * How long before a line lands the panel starts moving to it, and how long the
 * move takes: the breath between the end of the line being sung and the start
 * of the next, kept between LEAD_MIN_MS and LEAD_MAX_MS.
 */
export function leadMs(lines: SyncedLyricLine[], at: number): number {
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ms(lines[i].time) <= at) current = i;
    else break;
  }
  if (current < 0) return LEAD_MIN_MS;
  const next = lines[current + 1];
  if (!next) return LEAD_MIN_MS;
  return Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, ms(next.time) - lineEndMs(lines[current])));
}

/** The rows being sung, the first of them, and the row the panel is heading for. */
export interface LiveRows {
  rows: number[];
  first: number;
  focus: number;
}

export function liveAt(lines: SyncedLyricLine[], at: number): LiveRows {
  const rows = liveRows(lines, at);
  const first = rows[0] ?? -1;
  const ahead = liveRows(lines, at + leadMs(lines, at))[0] ?? -1;
  return { rows, first, focus: ahead >= 0 ? ahead : first };
}

/** How far behind the panel row `index` runs, in ms, on a move of `delta` px to row `focus` taking `durationMs`. */
export function fanDelayMs(index: number, focus: number, delta: number, durationMs: number): number {
  const behind = delta >= 0 ? index - focus : focus - index;
  return Math.min(FAN_ROWS, Math.max(0, behind)) * FAN_SHARE * durationMs;
}

/** How far row's picture trails the list `elapsedMs` into a move. */
export function fanOffset(delta: number, elapsedMs: number, durationMs: number, delayMs: number): number {
  if (delayMs <= 0) return 0;
  return delta * (handover(clamp01(elapsedMs / durationMs)) - handover(clamp01((elapsedMs - delayMs) / durationMs)));
}
