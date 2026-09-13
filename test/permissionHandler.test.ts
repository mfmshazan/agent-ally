/**
 * Permission handler tests — inject a `present` function (the coordinator) so
 * no TTY/audio/channels are needed. Verifies the canUseTool return contract.
 */

import assert from "node:assert/strict";
import { createCanUseTool } from "../src/permissionHandler.js";
import type { PresentFn } from "../src/coordinator.js";
import type { CanUseToolContext, DecisionOption } from "../src/types.js";

const ctx: CanUseToolContext = { signal: new AbortController().signal, toolUseID: "t" };

const picks = (value: string, label = value): PresentFn => async () =>
  ({ label, value }) as DecisionOption;

let passed = 0;
function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(
    () => {
      passed += 1;
      console.log(`  ok  ${name}`);
    },
    (err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    },
  );
}

async function run(): Promise<void> {
  await test("allow -> { behavior: 'allow' }", async () => {
    const canUseTool = createCanUseTool({ present: picks("allow") });
    assert.deepEqual(await canUseTool("Bash", { command: "ls" }, ctx), { behavior: "allow" });
  });

  await test("deny -> { behavior: 'deny', message }", async () => {
    const canUseTool = createCanUseTool({ present: picks("deny") });
    const res = await canUseTool("Bash", { command: "ls" }, ctx);
    assert.equal(res.behavior, "deny");
  });

  await test("question -> allow with the chosen answer", async () => {
    const canUseTool = createCanUseTool({ present: picks("Red", "Red") });
    const res = await canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Which color?", header: "Color", multiSelect: false, options: [] }] },
      ctx,
    );
    assert.equal(res.behavior, "allow");
    assert.deepEqual(
      res.behavior === "allow" ? (res.updatedInput as { answers: unknown }).answers : null,
      [{ header: "Color", label: "Red" }],
    );
  });

  await test("present failure (Ctrl+C / all channels) fails safe to deny", async () => {
    const canUseTool = createCanUseTool({
      present: async () => {
        throw new Error("cancelled");
      },
    });
    const res = await canUseTool("Bash", { command: "rm -rf /" }, ctx);
    assert.equal(res.behavior, "deny");
  });

  console.log(`\n${passed} passed`);
}

await run();
