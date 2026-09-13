/**
 * Permission handler tests — inject a fake prompt so no TTY/audio is needed.
 * Verifies the canUseTool return contract our spike confirmed.
 */

import assert from "node:assert/strict";
import { createCanUseTool, type PromptFn } from "../src/permissionHandler.js";
import type { Announcer } from "../src/announcer/announcer.js";
import type { CanUseToolContext, DecisionOption } from "../src/types.js";

class FakeAnnouncer {
  announced = 0;
  failures: string[] = [];
  async announce(): Promise<void> {
    this.announced += 1;
  }
  async failure(msg: string): Promise<void> {
    this.failures.push(msg);
  }
}

const ctx: CanUseToolContext = { signal: new AbortController().signal, toolUseID: "t" };

function handlerWith(prompt: PromptFn) {
  const fake = new FakeAnnouncer();
  const canUseTool = createCanUseTool({ announcer: fake as unknown as Announcer, prompt });
  return { canUseTool, fake };
}

const pick = (value: string): PromptFn => async () =>
  ({ label: value, value }) as DecisionOption;

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
    const { canUseTool } = handlerWith(pick("allow"));
    const res = await canUseTool("Bash", { command: "ls" }, ctx);
    assert.deepEqual(res, { behavior: "allow" });
  });

  await test("deny -> { behavior: 'deny', message }", async () => {
    const { canUseTool } = handlerWith(pick("deny"));
    const res = await canUseTool("Bash", { command: "ls" }, ctx);
    assert.equal(res.behavior, "deny");
  });

  await test("question -> allow with the chosen answer", async () => {
    const { canUseTool } = handlerWith(pick("Red"));
    const res = await canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which color?",
            header: "Color",
            multiSelect: false,
            options: [
              { label: "Red", description: "" },
              { label: "Blue", description: "" },
            ],
          },
        ],
      },
      ctx,
    );
    assert.equal(res.behavior, "allow");
    assert.deepEqual(
      res.behavior === "allow" ? (res.updatedInput as { answers: unknown }).answers : null,
      [{ header: "Color", label: "Red" }],
    );
  });

  await test("prompt failure (Ctrl+C) fails safe to deny", async () => {
    const throwing: PromptFn = async () => {
      throw new Error("cancelled");
    };
    const { canUseTool } = handlerWith(throwing);
    const res = await canUseTool("Bash", { command: "rm -rf /" }, ctx);
    assert.equal(res.behavior, "deny");
  });

  console.log(`\n${passed} passed`);
}

await run();
