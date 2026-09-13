/**
 * Coordinator tests — fake channels prove the race: first answer wins, losers
 * are aborted, and an all-fail rejects so the handler can deny.
 */

import assert from "node:assert/strict";
import { createPresenter } from "../src/coordinator.js";
import type { DecisionChannel } from "../src/channels/types.js";
import type { Decision, DecisionOption } from "../src/types.js";

const decision: Decision = {
  kind: "permission",
  toolUseId: "t",
  toolName: "Bash",
  title: "run a shell command",
  riskLevel: "medium",
  options: [
    { label: "Allow", value: "allow" },
    { label: "Deny", value: "deny" },
  ],
  raw: { toolName: "Bash", input: {} },
};

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
  await test("first channel to answer wins; the loser is aborted", async () => {
    let loserAborted = false;
    const fast: DecisionChannel = {
      name: "fast",
      present: async () => ({ label: "Allow", value: "allow" }) as DecisionOption,
    };
    const slow: DecisionChannel = {
      name: "slow",
      present: (_d, signal) =>
        new Promise<DecisionOption>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            loserAborted = true;
            reject(new Error("aborted"));
          });
        }),
    };
    const present = createPresenter([slow, fast]);
    const chosen = await present(decision);
    assert.equal(chosen.value, "allow");
    // give the microtask queue a tick for the abort to propagate
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(loserAborted, true);
  });

  await test("rejects only when every channel fails", async () => {
    const failing = (): DecisionChannel => ({
      name: "x",
      present: async () => {
        throw new Error("cancelled");
      },
    });
    const present = createPresenter([failing(), failing()]);
    await assert.rejects(() => present(decision));
  });

  console.log(`\n${passed} passed`);
}

await run();
