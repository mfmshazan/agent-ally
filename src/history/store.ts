/**
 * Persistent transcript for the phone. Kept per-project (keyed by the directory
 * agent-ally was launched from) so that reopening the phone another day shows
 * the previous conversation and the decisions you made — no need to re-plan.
 *
 * Stored as JSONL under ~/.agent-ally/history/<project>.jsonl: append-only, one
 * entry per line, robust to partial writes (bad lines are skipped on load).
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

export interface HistoryEntry {
  role: "agent" | "you" | "system";
  text: string;
}

/** ~/.agent-ally/history/<slug>-<hash>.jsonl for the given working directory. */
export function defaultHistoryFile(cwd: string): string {
  const dir = join(homedir(), ".agent-ally", "history");
  const slug =
    cwd
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-40) || "project";
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return join(dir, `${slug}-${hash}.jsonl`);
}

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    !!e &&
    typeof e.text === "string" &&
    (e.role === "agent" || e.role === "you" || e.role === "system")
  );
}

export class HistoryStore {
  constructor(
    private readonly file: string,
    private readonly cap = 300,
  ) {}

  /** Load the saved transcript, trimming (and rewriting) if over the cap. */
  load(): HistoryEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return []; // no history yet
    }
    const entries: HistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const parsed = JSON.parse(s);
        if (isEntry(parsed)) entries.push({ role: parsed.role, text: parsed.text });
      } catch {
        /* skip a corrupt line */
      }
    }
    if (entries.length > this.cap) {
      const trimmed = entries.slice(-this.cap);
      this.rewrite(trimmed);
      return trimmed;
    }
    return entries;
  }

  /** Append one line. Never throws — logging must not crash the session. */
  append(entry: HistoryEntry): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* best effort */
    }
  }

  private rewrite(entries: HistoryEntry[]): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    } catch {
      /* best effort */
    }
  }
}
