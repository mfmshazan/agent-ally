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
  await test("allow -> { behavior: 'allow', updatedInput: original input }", async () => {
    const canUseTool = createCanUseTool({ present: picks("allow") });
    const input = { file_path: "a.txt", old_string: "x", new_string: "y" };
    const res = await canUseTool("Edit", input, ctx);
    // Must echo the input back, or the SDK runs the tool with no arguments.
    assert.deepEqual(res, { behavior: "allow", updatedInput: input });
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

  await test("allow_all_edits auto-approves later edits without re-prompting", async () => {
    let presentCalls = 0;
    const present: PresentFn = async () => {
      presentCalls += 1;
      return { label: "Allow all edits this turn", value: "allow_all_edits" } as DecisionOption;
    };
    const notes: string[] = [];
    const canUseTool = createCanUseTool({ present, onAutoApprove: (d) => notes.push(d.title) });

    const edit = { file_path: "a.txt", old_string: "x", new_string: "y" };
    const first = await canUseTool("Edit", edit, ctx); // prompts once, opts in
    const second = await canUseTool("Write", { file_path: "b.txt", content: "hi" }, ctx); // auto

    assert.equal(first.behavior, "allow");
    assert.equal(second.behavior, "allow");
    assert.equal(presentCalls, 1, "should only prompt for the first edit");
    assert.equal(notes.length, 1, "auto-approval should be noted for the log");
  });

  await test("allow_all_edits does NOT auto-approve shell commands", async () => {
    let presentCalls = 0;
    const present: PresentFn = async () => {
      presentCalls += 1;
      return { label: "Allow all edits this turn", value: "allow_all_edits" } as DecisionOption;
    };
    const canUseTool = createCanUseTool({ present });
    await canUseTool("Edit", { file_path: "a.txt" }, ctx); // opt in
    await canUseTool("Bash", { command: "rm -rf build" }, ctx); // must still prompt
    assert.equal(presentCalls, 2, "shell commands are never auto-approved");
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
