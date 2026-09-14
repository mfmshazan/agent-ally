/** SessionStore tests — real temp files, no SDK. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, defaultSessionFile } from "../src/history/session.js";

const dir = mkdtempSync(join(tmpdir(), "agent-ally-sess-"));

try {
  // Round-trip: the last saved id is what we load back.
  {
    const file = join(dir, "a.json");
    new SessionStore(file).save("sess-123");
    assert.equal(new SessionStore(file).load(), "sess-123");
    // Saving again overwrites (we only keep the latest).
    new SessionStore(file).save("sess-456");
    assert.equal(new SessionStore(file).load(), "sess-456");
  }

  // Missing file loads as undefined, not an error (start fresh).
  {
    assert.equal(new SessionStore(join(dir, "missing.json")).load(), undefined);
  }

  // Corrupt file is tolerated -> undefined.
  {
    const file = join(dir, "bad.json");
    writeFileSync(file, "{not json", "utf8");
    assert.equal(new SessionStore(file).load(), undefined);
  }

  // Per-project keying: different dirs -> different files.
  {
    assert.notEqual(defaultSessionFile("E:/proj/one"), defaultSessionFile("E:/proj/two"));
  }

  console.log("session.test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
