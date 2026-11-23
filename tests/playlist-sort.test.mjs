/**
 * Playlist sorting: a view over the playlist's own order. Date added reads when each song joined
 * (the sync record's add time), so an import's shared stamp or an unknown time falls back to the
 * song's place in the playlist instead of jumbling it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSort, sortPlaylist, startsDescending } from "../.test-build/playlist-sort.mjs";

const song = (id, title, artist, album, duration) => ({ id, title, artist, album, duration, thumb: "" });
const list = [
  song("a", "Yellow", "Coldplay", "Parachutes", 269),
  song("b", "alright", "Kendrick Lamar", "To Pimp a Butterfly", 219),
  song("c", "Loser", "Tame Impala", "The Slow Rush", 223),
  song("d", "Zebra", "Beach House", "Teen Dream", 289),
];
const added = { a: 100, b: 300, c: 0, d: 300 };
const at = (t) => added[t.id];
const ids = (tracks) => tracks.map((t) => t.id).join("");

test("date added starts newest first; ties and unknown times go by their place in the playlist", () => {
  assert.equal(startsDescending("added"), true);
  // b and d share a stamp (added together): d sits later in the playlist, so it counts as newer.
  assert.equal(ids(sortPlaylist(list, { by: "added", descending: true }, at)), "dbac");
  assert.equal(ids(sortPlaylist(list, { by: "added" }, at)), "cabd");
});

test("title, artist and album go A to Z ignoring case, duration shortest first, each descending too", () => {
  assert.equal(startsDescending("title"), false);
  assert.equal(ids(sortPlaylist(list, { by: "title" }, at)), "bcad");
  assert.equal(ids(sortPlaylist(list, { by: "title", descending: true }, at)), "dacb");
  assert.equal(ids(sortPlaylist(list, { by: "artist" }, at)), "dabc");
  assert.equal(ids(sortPlaylist(list, { by: "album" }, at)), "adcb");
  assert.equal(ids(sortPlaylist(list, { by: "duration" }, at)), "bcad");
  assert.equal(ids(sortPlaylist(list, { by: "duration", descending: true }, at)), "dacb");
});

test("custom order is the playlist's own, reversed descending, and sorting never changes the playlist", () => {
  assert.equal(ids(sortPlaylist(list, { by: "custom" }, at)), "abcd");
  assert.equal(ids(sortPlaylist(list, { by: "custom", descending: true }, at)), "dcba");
  sortPlaylist(list, { by: "title" }, at);
  assert.equal(ids(list), "abcd");
});

test("only a real, non-default sort counts as sorted", () => {
  assert.equal(activeSort(undefined), null);
  assert.equal(activeSort({ by: "custom" }), null);
  assert.deepEqual(activeSort({ by: "custom", descending: true }), { by: "custom", descending: true });
  assert.deepEqual(activeSort({ by: "added", descending: false }), { by: "added" });
  // A key from a newer version, or junk from a synced copy, reads as the playlist's own order.
  assert.equal(activeSort({ by: "toString" }), null);
  assert.equal(activeSort({ by: "popularity" }), null);
});
