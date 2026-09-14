/**
 * Remembers the Claude session id for a project across restarts, so relaunching
 * agent-ally the next day continues yesterday's conversation (the SDK replays
 * the stored transcript for that id) instead of starting cold.
 *
 * Kept per-project (keyed by the launch directory) in a tiny JSON file next to
 * the transcript history. Best-effort: a missing or corrupt file just means we
 * start fresh, never a crash.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

/** ~/.agent-ally/sessions/<slug>-<hash>.json for the given working directory. */
export function defaultSessionFile(cwd: string): string {
  const dir = join(homedir(), ".agent-ally", "sessions");
  const slug =
    cwd
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-40) || "project";
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return join(dir, `${slug}-${hash}.json`);
}

interface SessionRecord {
  sessionId: string;
  updatedAt: string;
}

export class SessionStore {
  constructor(private readonly file: string) {}

  /** The last session id saved for this project, or undefined if none. */
  load(): string | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<SessionRecord>;
      return typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : undefined;
    } catch {
      return undefined; // no session yet, or unreadable — start fresh
    }
  }

  /** Persist the latest session id. Never throws — must not crash the session. */
  save(sessionId: string): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const record: SessionRecord = { sessionId, updatedAt: new Date().toISOString() };
      writeFileSync(this.file, JSON.stringify(record, null, 2) + "\n", "utf8");
    } catch {
      /* best effort */
    }
  }
}
