/**
 * Selector tests — feed synthetic keys, assert navigation + confirm behaviour.
 * A fake announcer records which spoken events fired. No audio, no TTY.
 */

import assert from "node:assert/strict";
import { Selector, type Key } from "../src/input/selector.js";
import type { Announcer } from "../src/announcer/announcer.js";
import { toDecision } from "../src/interceptor/toDecision.js";
import type { Decision, DecisionOption } from "../src/types.js";

class FakeAnnouncer {
  selections: Array<{ label: string; index: number }> = [];
  confirmed: string[] = [];
  committedOpts: string[] = [];
  detailsCount = 0;
  async selection(o: DecisionOption, index: number): Promise<void> {
    this.selections.push({ label: o.label, index });
  }
  async confirm(o: DecisionOption): Promise<void> {
    this.confirmed.push(o.label);
  }
  async committed(o: DecisionOption): Promise<void> {
    this.committedOpts.push(o.label);
  }
  async details(): Promise<void> {
    this.detailsCount += 1;
  }
}

const permission: Decision = toDecision("Bash", { command: "rm -rf x" }, { toolUseID: "t" });

function make(requireConfirm: boolean): { sel: Selector; fake: FakeAnnouncer } {
  const fake = new FakeAnnouncer();
  const sel = new Selector(permission, {
    announcer: fake as unknown as Announcer,
    requireConfirm,
  });
  return { sel, fake };
}

const k = (name: string): Key => ({ name });

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
  await test("arrow down then enter commits the second option (no confirm)", async () => {
    const { sel, fake } = make(false);
    assert.equal(await sel.handleKey(k("down")), null);
    const committed = await sel.handleKey(k("return"));
    assert.equal(committed?.value, "deny");
    assert.deepEqual(fake.committedOpts, ["Deny"]);
  });

  await test("high-risk requires a second enter to commit", async () => {
    const { sel, fake } = make(true);
    // first enter -> confirm prompt, not committed
    assert.equal(await sel.handleKey(k("return")), null);
    assert.deepEqual(fake.confirmed, ["Allow"]);
    assert.deepEqual(fake.committedOpts, []);
    // second enter -> commit
    const committed = await sel.handleKey(k("return"));
    assert.equal(committed?.value, "allow");
  });

  await test("moving cancels a pending confirm", async () => {
    const { sel, fake } = make(true);
    await sel.handleKey(k("return")); // arm confirm on Allow
    await sel.handleKey(k("down")); // move to Deny -> cancels confirm
    const committed = await sel.handleKey(k("return")); // arms confirm on Deny, not commit
    assert.equal(committed, null);
    assert.deepEqual(fake.confirmed, ["Allow", "Deny"]);
  });

  await test("number key jumps to an option", async () => {
    const { sel, fake } = make(false);
    await sel.handleKey(k("2"));
    assert.equal(fake.selections.at(-1)?.index, 1);
  });

  await test("'d' reads details without committing", async () => {
    const { sel, fake } = make(false);
    const committed = await sel.handleKey(k("d"));
    assert.equal(committed, null);
    assert.equal(fake.detailsCount, 1);
  });

  console.log(`\n${passed} passed`);
}

await run();
