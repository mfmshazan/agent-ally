/**
 * Multiple chats per project — like the conversation list in an IDE agent.
 * Each chat has its own Claude session (so resuming continues the right thread)
 * and its own transcript file, and you can list them and switch between them.
 *
 * Layout:  <base>/projects/<slug>-<hash>/
 *            index.json        registry: { current, chats: [meta...] }
 *            <chatId>.jsonl    that chat's transcript (see HistoryStore)
 *
 * All writes are best-effort and never throw — losing chat metadata must not
 * crash a working session.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface ChatMeta {
  id: string;
  title: string;
  /** Claude session id, for resuming this chat's thread. */
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Index {
  current?: string;
  chats: ChatMeta[];
}

/** The default title given to a chat until its first prompt names it. */
export const NEW_CHAT_TITLE = "New chat";

function projectKey(cwd: string): string {
  const slug =
    cwd
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-40) || "project";
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

export class ChatStore {
  private readonly dir: string;
  private readonly indexFile: string;
  private index: Index;

  constructor(cwd: string, baseDir: string = join(homedir(), ".agent-ally")) {
    this.dir = join(baseDir, "projects", projectKey(cwd));
    this.indexFile = join(this.dir, "index.json");
    this.index = this.read();
  }

  private read(): Index {
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, "utf8")) as Index;
      if (parsed && Array.isArray(parsed.chats)) return parsed;
    } catch {
      /* no index yet */
    }
    return { chats: [] };
  }

  private write(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2) + "\n", "utf8");
    } catch {
      /* best effort */
    }
  }

  private genId(): string {
    return (
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6)
    );
  }

  /** All chats, most recently active first. */
  list(): ChatMeta[] {
    return [...this.index.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): ChatMeta | undefined {
    return this.index.chats.find((c) => c.id === id);
  }

  current(): ChatMeta | undefined {
    return this.index.current ? this.get(this.index.current) : undefined;
  }

  /** Start a new chat and make it current. */
  create(title: string = NEW_CHAT_TITLE): ChatMeta {
    const now = new Date().toISOString();
    const meta: ChatMeta = { id: this.genId(), title, createdAt: now, updatedAt: now };
    this.index.chats.push(meta);
    this.index.current = meta.id;
    this.write();
    return meta;
  }

  /** The current chat, or a fresh one if none exists yet. */
  currentOrCreate(): ChatMeta {
    return this.current() ?? this.create();
  }

  switchTo(id: string): ChatMeta | undefined {
    const meta = this.get(id);
    if (meta) {
      this.index.current = id;
      this.write();
    }
    return meta;
  }

  /** Resolve a 1-based list position (as shown by `--list`) or a chat id. */
  resolve(selector: string): ChatMeta | undefined {
    const n = Number(selector);
    if (Number.isInteger(n) && n >= 1) return this.list()[n - 1];
    return this.get(selector);
  }

  update(id: string, patch: Partial<Pick<ChatMeta, "title" | "sessionId">>): void {
    const meta = this.get(id);
    if (!meta) return;
    if (patch.title !== undefined) meta.title = patch.title;
    if (patch.sessionId !== undefined) meta.sessionId = patch.sessionId;
    meta.updatedAt = new Date().toISOString();
    this.write();
  }

  /** Mark a chat as just-active (moves it to the top of the list). */
  touch(id: string): void {
    const meta = this.get(id);
    if (!meta) return;
    meta.updatedAt = new Date().toISOString();
    this.write();
  }

  /** Where a chat's transcript lives (hand this to a HistoryStore). */
  transcriptFile(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }
}
