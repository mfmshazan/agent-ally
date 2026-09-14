/**
 * Renders a saved transcript as plain text for the terminal (`--history`).
 * Grouped by day with friendly headings (Today / Yesterday / full date) so a
 * plan picked up another day is easy to locate. Kept screen-reader friendly:
 * clear role labels, no decoration a TTS engine would read as noise.
 */

import type { HistoryEntry } from "./store.js";

const ROLE_LABEL: Record<HistoryEntry["role"], string> = {
  you: "You",
  agent: "Claude",
  system: "•",
};

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A friendly day heading for an entry's timestamp, relative to `now`. */
export function dayHeading(iso?: string, now: Date = new Date()): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Full transcript as plain text, grouped by day. */
export function formatTranscript(entries: HistoryEntry[], now: Date = new Date()): string {
  if (entries.length === 0) return "No history yet for this project.";
  const lines: string[] = [];
  let lastDay: string | null = null;
  for (const e of entries) {
    const day = dayHeading(e.at, now);
    if (day !== lastDay) {
      if (lastDay !== null) lines.push("");
      lines.push(`── ${day} ──`);
      lastDay = day;
    }
    const label = ROLE_LABEL[e.role];
    // System notes already read as full sentences (✅ Allowed: …), so they take
    // the bullet without a colon; you/Claude lines get "Role: text".
    lines.push(e.role === "system" ? `  ${label} ${e.text}` : `  ${label}: ${e.text}`);
  }
  return lines.join("\n");
}
