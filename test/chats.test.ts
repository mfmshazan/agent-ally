/** ChatStore tests — real temp dir as the base, no home writes. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore, NEW_CHAT_TITLE } from "../src/history/chats.js";

const base = mkdtempSync(join(tmpdir(), "agent-ally-chats-"));
const cwd = "E:/proj/demo";

try {
  // No chats initially; currentOrCreate makes one and marks it current.
  {
    const store = new ChatStore(cwd, base);
    assert.deepEqual(store.list(), []);
    const c = store.currentOrCreate();
    assert.equal(c.title, NEW_CHAT_TITLE);
    assert.equal(store.current()?.id, c.id);
  }

  // Persistence: a new instance sees the same chat (and its current pointer).
  {
    const store = new ChatStore(cwd, base);
    assert.equal(store.list().length, 1);
    assert.ok(store.current());
  }

  // Create a second chat -> it becomes current; list is newest-first.
  {
    const store = new ChatStore(cwd, base);
    const first = store.current()!;
    const second = store.create("Build the editor");
    assert.equal(store.current()?.id, second.id);
    const ids = store.list().map((c) => c.id);
    assert.equal(ids[0], second.id, "newest first");
    assert.ok(ids.includes(first.id));

    // Resolve by 1-based position and by id.
    assert.equal(store.resolve("1")?.id, second.id);
    assert.equal(store.resolve(second.id)?.id, second.id);
    assert.equal(store.resolve("999"), undefined);

    // Switch back to the first, persists.
    store.switchTo(first.id);
    assert.equal(new ChatStore(cwd, base).current()?.id, first.id);
  }

  // Update sets session id + title and each chat has a distinct transcript file.
  {
    const store = new ChatStore(cwd, base);
    const [a, b] = store.list();
    store.update(a.id, { sessionId: "sess-a", title: "Renamed" });
    const reloaded = new ChatStore(cwd, base).get(a.id)!;
    assert.equal(reloaded.sessionId, "sess-a");
    assert.equal(reloaded.title, "Renamed");
    assert.notEqual(store.transcriptFile(a.id), store.transcriptFile(b.id));
  }

  // Different projects are isolated.
  {
    const other = new ChatStore("E:/proj/other", base);
    assert.deepEqual(other.list(), []);
  }

  console.log("chats.test: ok");
} finally {
  rmSync(base, { recursive: true, force: true });
}
