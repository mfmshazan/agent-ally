/**
 * Read the sessions Claude Code itself stores (the ones the extension/CLI show
 * in their resume list), so agent-ally can surface and reopen a thread you
 * started outside it.
 *
 * Layout (created by Claude Code, not us):
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where <encoded-cwd> is the working directory with every non-alphanumeric
 * character turned into "-". Top-level sessions are UUID-named; the "agent-*"
 * files are sub-agent sidechains and are skipped. Everything here is read-only
 * and best-effort — a missing or malformed store just yields no sessions.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClaudeSession {
  sessionId: string;
  title: string;
  /** File mtime, ISO — when the thread was last active. */
  updatedAt: string;
}

const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

/** Claude Code's per-project folder name for a working directory. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function clip(s: string): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}

/** Pull a human title from a session file: its first user prompt. */
function titleOf(file: string): string {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return "(untitled)";
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "user") continue;
    const message = o.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "user") continue;
    const c = message.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? (c.find((b) => (b as { type?: string }).type === "text") as { text?: string } | undefined)
              ?.text
          : undefined;
    if (text && text.trim()) return clip(text);
  }
  return "(untitled)";
}

/**
 * Sessions Claude Code has for this project, newest first. Reads at most `limit`
 * files' titles (the rest are ignored) to stay fast.
 */
export function listClaudeSessions(
  cwd: string,
  limit = 10,
  homeBase: string = homedir(),
): ClaudeSession[] {
  const dir = join(homeBase, ".claude", "projects", encodeProjectDir(cwd));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const stamped: Array<{ id: string; file: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!UUID_FILE.test(name)) continue; // skip agent-* sidechains and others
    const file = join(dir, name);
    let size = 0;
    let mtimeMs = 0;
    try {
      const st = statSync(file);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    if (size === 0) continue; // empty session
    stamped.push({ id: name.replace(/\.jsonl$/i, ""), file, mtimeMs });
  }
  stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stamped.slice(0, limit).map((s) => ({
    sessionId: s.id,
    title: titleOf(s.file),
    updatedAt: new Date(s.mtimeMs).toISOString(),
  }));
}
