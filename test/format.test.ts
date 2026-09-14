/** Transcript formatter tests — pure, no files. */

import assert from "node:assert/strict";
import { formatTranscript, dayHeading } from "../src/history/format.js";
import type { HistoryEntry } from "../src/history/store.js";

// Built in local time (numeric ctor) so the day comparison is timezone-safe.
const now = new Date(2026, 8, 14, 10, 0, 0);
const today = new Date(2026, 8, 14, 9, 0, 0).toISOString();
const yesterday = new Date(2026, 8, 13, 20, 0, 0).toISOString();

// Empty transcript is stated plainly, not blank.
assert.equal(formatTranscript([], now), "No history yet for this project.");

// Relative day headings.
assert.equal(dayHeading(today, now), "Today");
assert.equal(dayHeading(yesterday, now), "Yesterday");
assert.equal(dayHeading(undefined, now), "Earlier");
assert.equal(dayHeading("not-a-date", now), "Earlier");

// Grouping + role labels.
{
  const entries: HistoryEntry[] = [
    { role: "you", text: "plan a login page", at: yesterday },
    { role: "agent", text: "sure, here's the plan", at: yesterday },
    { role: "you", text: "now build it", at: today },
    { role: "system", text: "✅ Allowed: edit login.tsx", at: today },
  ];
  const out = formatTranscript(entries, now);
  // Two distinct days -> two headings.
  assert.equal((out.match(/── .+ ──/g) || []).length, 2);
  assert.match(out, /── Yesterday ──/);
  assert.match(out, /── Today ──/);
  assert.match(out, /You: plan a login page/);
  assert.match(out, /Claude: sure, here's the plan/);
  // System notes take the bullet, no colon.
  assert.match(out, /• ✅ Allowed: edit login\.tsx/);
}

// Undated entries collapse under "Earlier".
{
  const out = formatTranscript([{ role: "you", text: "old note" }], now);
  assert.match(out, /── Earlier ──/);
  assert.match(out, /You: old note/);
}

console.log("format.test: ok");
