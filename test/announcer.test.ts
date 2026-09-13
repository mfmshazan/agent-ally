/**
 * Announcer tests. A capturing speaker records what would be spoken, so we can
 * assert the spoken flow without any audio. No tokens, no live SDK.
 */

import assert from "node:assert/strict";
import { Announcer } from "../src/announcer/announcer.js";
import { SilentEarcon } from "../src/announcer/earcons.js";
import type { Speaker } from "../src/announcer/tts.js";
import { toDecision } from "../src/interceptor/toDecision.js";

class CapturingSpeaker implements Speaker {
  public said: string[] = [];
  async speak(text: string): Promise<void> {
    this.said.push(text);
  }
}

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
  await test("announces a high-risk permission with risk + options", async () => {
    const speaker = new CapturingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    const d = toDecision("Bash", { command: "rm -rf build/" }, { toolUseID: "x" });
    await a.announce(d);
    const all = speaker.said.join(" | ");
    assert.match(all, /Permission needed/);
    assert.match(all, /High risk/);
    assert.match(all, /Options: 1, Allow\. 2, Deny\./);
  });

  await test("speaks current selection with position", async () => {
    const speaker = new CapturingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    await a.selection({ label: "Deny", value: "deny" }, 1, 2);
    assert.equal(speaker.said[0], "2 of 2, Deny.");
  });

  await test("confirm prompts for a second press", async () => {
    const speaker = new CapturingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    await a.confirm({ label: "Allow", value: "allow" });
    assert.match(speaker.said[0], /Confirm Allow\? Press enter again/);
  });

  await test("announces a question with its options", async () => {
    const speaker = new CapturingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    const d = toDecision(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which option do you choose?",
            header: "Choice",
            multiSelect: false,
            options: [
              { label: "red", description: "Choose red" },
              { label: "blue", description: "Choose blue" },
            ],
          },
        ],
      },
      { toolUseID: "x" },
    );
    await a.announce(d);
    const all = speaker.said.join(" | ");
    assert.match(all, /Claude is asking\. Which option do you choose\?/);
    assert.match(all, /Options: 1, red\. 2, blue\./);
  });

  await test("details reads the full command", async () => {
    const speaker = new CapturingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    const d = toDecision("Bash", { command: "echo hello | grep h" }, { toolUseID: "x" });
    await a.details(d);
    assert.match(speaker.said[0], /Full command: echo hello \| grep h/);
  });

  console.log(`\n${passed} passed`);
}

await run();
