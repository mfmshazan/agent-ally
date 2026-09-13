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

/**
 * A speaker whose utterances only finish when their signal aborts — lets us
 * assert that a newer utterance interrupts (barges in on) an in-flight one.
 */
class BlockingSpeaker implements Speaker {
  public aborted: string[] = [];
  speak(text: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener(
        "abort",
        () => {
          this.aborted.push(text);
          resolve();
        },
        { once: true },
      );
    });
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

  await test("a new utterance barges in on one still playing", async () => {
    const speaker = new BlockingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    const first = a.say("first, long announcement"); // hangs until aborted
    const second = a.say("second"); // begins a new utterance → aborts the first
    await first;
    assert.deepEqual(speaker.aborted, ["first, long announcement"]);
    a.stop(); // release the second so the test doesn't hang
    await second;
  });

  await test("stop() silences the current utterance", async () => {
    const speaker = new BlockingSpeaker();
    const a = new Announcer({ speaker, earcon: new SilentEarcon() });
    const p = a.say("talking…");
    a.stop();
    await p;
    assert.deepEqual(speaker.aborted, ["talking…"]);
  });

  console.log(`\n${passed} passed`);
}

await run();
