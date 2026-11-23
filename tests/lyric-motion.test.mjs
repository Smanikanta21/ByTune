import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAK_DOTS,
  FAN_SHARE,
  HeldWord,
  LEAD_MAX_MS,
  LEAD_MIN_MS,
  VoiceMotion,
  backingVoice,
  bareBacking,
  cubicBezier,
  fanDelayMs,
  fanOffset,
  handover,
  holdsLong,
  leadMs,
  leadVoice,
  liftReach,
  liveAt,
  liveRows,
  restingPose,
} from "../.test-build/lyric-motion.mjs";

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("the handover curve is the CSS cubic-bezier it names", () => {
  // An independent solve of cubic-bezier(0.41, 0, 0.12, 0.99) by bisection.
  const ref = (t) => {
    const bx = (u) => 3 * (1 - u) ** 2 * u * 0.41 + 3 * (1 - u) * u * u * 0.12 + u ** 3;
    const by = (u) => 3 * (1 - u) * u * u * 0.99 + u ** 3;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 60; i++) { u = (lo + hi) / 2; if (bx(u) < t) lo = u; else hi = u; }
    return by(u);
  };
  for (const t of [0.05, 0.2, 0.5, 0.8, 0.95]) near(handover(t), ref(t), 1e-5);
  assert.equal(handover(0), 0);
  assert.equal(handover(1), 1);
  let last = 0;
  for (let t = 0.01; t <= 1; t += 0.01) { const v = handover(t); assert.ok(v >= last - 1e-9); last = v; }
  near(cubicBezier(0, 0, 1, 1)(0.3), 0.3, 1e-5);
});

test("a word lifts by how long it's held: patter barely, a carried note all the way", () => {
  near(liftReach(100), 0.25);
  near(liftReach(150), 0.25);
  near(liftReach(525), 0.625);
  near(liftReach(900), 1);
  near(liftReach(3000), 1);
});

test("the sweep fills each word across its own time and the space over the pause after it", () => {
  const v = new VoiceMotion([
    { text: "hello", startMs: 0, endMs: 1000 },
    { text: "world", startMs: 1500, endMs: 2500 },
  ]);
  assert.equal(v.text, "hello world");
  assert.equal(v.sungChars(-5), 0);
  near(v.sungChars(500), 2.5);
  near(v.sungChars(1000), 5);
  near(v.sungChars(1250), 5.5);
  near(v.sungChars(1500), 6);
  near(v.sungChars(2000), 8.5);
  assert.equal(v.sungChars(9000), 11);
});

test("a sung word rises over its own length, holds while sung, and settles over 700 ms", () => {
  // Six letters held a second isn't a held word (that needs 1.2 s), so it only lifts.
  const v = new VoiceMotion([{ text: "nights", startMs: 1000, endMs: 2000 }]);
  assert.equal(v.held[0], undefined);
  assert.equal(v.lift(0, 1000), 0);
  near(v.lift(0, 1350), 0.5);
  near(v.lift(0, 1700), 1);
  near(v.lift(0, 2000), 1);
  near(v.lift(0, 2350), 0.5);
  assert.equal(v.lift(0, 2700), 0);
  near(v.settle(0, 1500), 1);
  near(v.settle(0, 2350), 0.5);
  assert.equal(v.lifted(900), false);
  assert.equal(v.lifted(2100), true);
  assert.equal(v.lifted(2800), false);
  // A quick word rises over at least 250 ms and only part of the way.
  const quick = new VoiceMotion([{ text: "a", startMs: 0, endMs: 100 }]);
  near(quick.lift(0, 100), 0.25 * (0.4 * 0.4 * (3 - 0.8)));
});

test("only a word held long enough, and short enough, moves a letter at a time", () => {
  assert.equal(holdsLong("o", 1099), false);
  assert.equal(holdsLong("o", 1100), true);
  assert.equal(holdsLong("oh", 1359), false);
  assert.equal(holdsLong("oh", 1360), true);
  assert.equal(holdsLong("you", 1499), false);
  assert.equal(holdsLong("you", 1500), true);
  assert.equal(holdsLong("love", 1050), true);
  assert.equal(holdsLong("golden", 1199), false);
  assert.equal(holdsLong("golden", 1200), true);
  assert.equal(holdsLong("tonights", 5000), false, "eight letters is a ripple, not a wave");
  assert.equal(holdsLong("re-do", 5000), false);
  assert.equal(holdsLong("愛", 5000), false);
  assert.equal(holdsLong("حب", 5000), false);
});

test("a held word's letters swell, hold, settle to the resting lift, each a step behind the last", () => {
  const held = new HeldWord(0, 2, 1000, 3000); // "oh" held 2 s
  const span = 2000;
  near(held.restsAtMs, 1000 + span * (0.09 + 1.5));
  const earned = ((2000 - 400) / 2600) ** 3;
  const swell = 1.05 + earned * 0.08;
  const pose = restingPose();
  // Letter 0 at the top of its move (phase 0.25..0.30 of 1.5 × the hold).
  held.pose(0, 1000 + span * 1.5 * 0.27, pose);
  near(pose.scale, swell * 0.98);
  near(pose.lift, ((swell - 1) / 0.1) * 1);
  // The light's pace is capped at 1.1× however long the hold.
  near(pose.light, (0.35 + earned * 0.45) * Math.min(1.1, 2000 / 1500) * 0.85);
  near(pose.lean, (0.25 - 0.5) * 2 * (swell - 1) * (25 / 34) * 0.98);
  // Letter 1 starts 9% of the hold later, so at the same moment it's still on its way up.
  const second = restingPose();
  held.pose(1, 1000 + span * 1.5 * 0.27, second);
  assert.ok(second.scale < pose.scale);
  // Before it starts a letter sits flat; after its move it rests at the ordinary lift with no light.
  held.pose(0, 999, pose);
  assert.deepEqual({ ...pose, lean: pose.lean + 0 }, { scale: 1, lean: 0, lift: 0, light: 0 });
  held.pose(1, held.restsAtMs + 1, pose);
  assert.deepEqual(pose, { scale: 1, lean: 0, lift: 1, light: 0 });
  assert.equal(held.moving(2000), true);
  assert.equal(held.moving(held.restsAtMs + 1), false);
});

test("a line with a held word stays animated until that word's last letter rests", () => {
  const v = new VoiceMotion([
    { text: "so", startMs: 0, endMs: 300 },
    { text: "high", startMs: 300, endMs: 2300 },
  ]);
  assert.equal(v.held[0], undefined);
  assert.ok(v.held[1]);
  assert.equal(v.untilMs, Math.max(2300 + 700, v.held[1].restsAtMs));
  assert.equal(v.lifted(v.untilMs - 1), true);
});

const line = (time, text, extra = {}) => ({ time, text, ...extra });
const words = (...spec) => spec.map(([text, start, end]) => ({ text, start, end }));

test("the lead voice keeps its words inside the line, spreading broken timings evenly", () => {
  const ok = leadVoice(line(10, "a b", { words: words(["a", 10, 10.5], ["b", 10.5, 11]) }), 12);
  assert.deepEqual(ok.words.map((w) => [w.startMs, w.endMs]), [[10000, 10500], [10500, 11000]]);
  // A backing word starting a second before the line: the whole line is spread instead.
  const broken = leadVoice(line(10, "a b", { words: words(["a", 8, 9], ["b", 10, 11]) }), 12);
  assert.deepEqual(broken.words.map((w) => [w.startMs, w.endMs]), [[10000, 10500], [10500, 11000]]);
  assert.equal(leadVoice(line(10, "plain"), 12), null);
  assert.equal(leadVoice(line(10, "", { gap: true, words: words(["x", 10, 11]) }), 12), null);
});

test("the answering vocal is drawn bare, on its own clock", () => {
  assert.equal(bareBacking("(ooh, yeah)"), "ooh, yeah");
  const v = backingVoice(line(10, "lead", { bg: { text: "(ooh)", words: words(["(ooh)", 11, 12]) } }));
  assert.equal(v.text, "ooh");
  assert.deepEqual([v.words[0].startMs, v.words[0].endMs], [11000, 12000]);
  assert.equal(backingVoice(line(10, "lead", { bg: { text: "(ooh)" } })), null);
});

test("live rows: the latest line, plus any earlier one still being sung", () => {
  const lines = [
    line(1, "one", { words: words(["one", 1, 6]) }),
    line(2, "two", { words: words(["two", 2, 3]) }),
    line(4, "", { gap: true }),
    line(8, "four"),
  ];
  assert.deepEqual(liveRows(lines, 500), []);
  assert.deepEqual(liveRows(lines, 1500), [0]);
  assert.deepEqual(liveRows(lines, 2500), [0, 1], "line one is still being sung under line two");
  assert.deepEqual(liveRows(lines, 5000), [0, 2]);
  assert.deepEqual(liveRows(lines, 7000), [2]);
  assert.deepEqual(liveRows(lines, 9000), [3]);
});

test("the panel starts for the next line in the breath before it, 350–500 ms ahead", () => {
  const lines = [
    line(1, "a", { words: words(["a", 1, 1.9]) }),
    line(2, "b", { words: words(["b", 2, 2.5]) }),
    line(6, "c"),
  ];
  assert.equal(leadMs(lines, 0), LEAD_MIN_MS);
  assert.equal(leadMs(lines, 1500), LEAD_MIN_MS, "100 ms of breath is under the floor");
  assert.equal(leadMs(lines, 2200), LEAD_MAX_MS, "3.5 s of breath is over the ceiling");
  assert.equal(leadMs(lines, 7000), LEAD_MIN_MS);
  // 350 ms before line two the panel already heads there; the singing hasn't moved on.
  const live = liveAt(lines, 1700);
  assert.deepEqual(live, { rows: [0], first: 0, focus: 1 });
  assert.deepEqual(liveAt(lines, 1500), { rows: [0], first: 0, focus: 0 });
});

test("rows behind the one moved to fan out, at most three rows' worth", () => {
  assert.equal(fanDelayMs(5, 5, 100, 400), 0);
  near(fanDelayMs(6, 5, 100, 400), FAN_SHARE * 400);
  near(fanDelayMs(20, 5, 100, 400), 3 * FAN_SHARE * 400);
  assert.equal(fanDelayMs(4, 5, 100, 400), 0, "rows the panel moves away from arrive together");
  // Moving up, the rows above trail.
  near(fanDelayMs(4, 5, -100, 400), FAN_SHARE * 400);
  assert.equal(fanOffset(100, 200, 400, 0), 0);
  assert.ok(fanOffset(100, 100, 400, 24) > 0, "a delayed row trails the list's movement");
  near(fanOffset(100, 500, 400, 72), 0, 1e-9);
  assert.equal(BREAK_DOTS, 3);
  assert.ok(LEAD_MAX_MS > LEAD_MIN_MS);
});
