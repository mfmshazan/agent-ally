/** listClaudeSessions — reads Claude Code's own session store (temp fake home). */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listClaudeSessions, encodeProjectDir } from "../src/history/claudeSessions.js";

const base = mkdtempSync(join(tmpdir(), "agent-ally-claude-"));
const cwd = "E:/Web Projects/code-collab";

try {
  // The project-folder encoding matches Claude Code's scheme.
  assert.equal(encodeProjectDir("E:\\Web Projects\\code-collab"), "E--Web-Projects-code-collab");

  const dir = join(base, ".claude", "projects", encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });

  // A real session: title comes from the first user prompt.
  const sid = "11111111-2222-3333-4444-555555555555";
  writeFileSync(
    join(dir, sid + ".jsonl"),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Build the editor panel" }] },
    }) + "\n",
  );
  // Empty session -> skipped.
  writeFileSync(join(dir, "99999999-2222-3333-4444-555555555555.jsonl"), "");
  // Sub-agent sidechain (agent-*) -> skipped by name.
  writeFileSync(
    join(dir, "agent-abc123.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: "x" } }) + "\n",
  );

  const sessions = listClaudeSessions(cwd, 15, base);
  assert.equal(sessions.length, 1, "only the non-empty UUID session");
  assert.equal(sessions[0].sessionId, sid);
  assert.equal(sessions[0].title, "Build the editor panel");

  // Unknown project -> empty, no throw.
  assert.deepEqual(listClaudeSessions("E:/nope", 15, base), []);

  console.log("claudeSessions.test: ok");
} finally {
  rmSync(base, { recursive: true, force: true });
}
