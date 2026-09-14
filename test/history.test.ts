/** HistoryStore tests — real temp files, no server. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore, defaultHistoryFile } from "../src/history/store.js";

const dir = mkdtempSync(join(tmpdir(), "agent-ally-hist-"));

try {
  // Round-trip: what we append is what we load back, in order.
  {
    const store = new HistoryStore(join(dir, "a.jsonl"));
    store.append({ role: "you", text: "remove c++" });
    store.append({ role: "agent", text: "on it" });
    store.append({ role: "system", text: "✅ Allowed: edit page.tsx" });
    const loaded = new HistoryStore(join(dir, "a.jsonl")).load();
    assert.deepEqual(loaded, [
      { role: "you", text: "remove c++" },
      { role: "agent", text: "on it" },
      { role: "system", text: "✅ Allowed: edit page.tsx" },
    ]);
  }

  // Cap: loading trims to the last N entries.
  {
    const file = join(dir, "b.jsonl");
    const store = new HistoryStore(file, 3);
    for (let i = 0; i < 10; i += 1) store.append({ role: "you", text: `m${i}` });
    const loaded = store.load();
    assert.deepEqual(loaded.map((e) => e.text), ["m7", "m8", "m9"]);
    // The trim is persisted, so a fresh load stays trimmed.
    assert.equal(new HistoryStore(file, 3).load().length, 3);
  }

  // Missing file loads as empty, not an error.
  {
    assert.deepEqual(new HistoryStore(join(dir, "missing.jsonl")).load(), []);
  }

  // Per-project keying: different dirs -> different files.
  {
    assert.notEqual(defaultHistoryFile("E:/proj/one"), defaultHistoryFile("E:/proj/two"));
  }

  console.log("history.test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
