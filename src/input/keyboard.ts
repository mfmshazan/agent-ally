/**
 * Keyboard runtime — wires real terminal keypresses into a Selector.
 *
 * Separated from the Selector so the state machine stays testable without a
 * TTY. This file owns raw-mode stdin, readline keypress decoding, and cleanup.
 */

import readline from "node:readline";
import type { Decision, DecisionOption } from "../types.js";
import type { Announcer } from "../announcer/announcer.js";
import { Selector, type Key } from "./selector.js";

export interface PromptDeps {
  announcer: Announcer;
  requireConfirm: boolean;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

/**
 * Announce + navigate a decision on the terminal, resolving to the committed
 * option. Ctrl+C rejects with an AbortError-style error so callers can fail safe
 * (deny).
 */
export function promptDecision(decision: Decision, deps: PromptDeps): Promise<DecisionOption> {
  const input = deps.input ?? process.stdin;
  const selector = new Selector(decision, {
    announcer: deps.announcer,
    requireConfirm: deps.requireConfirm,
  });

  return new Promise<DecisionOption>((resolve, reject) => {
    readline.emitKeypressEvents(input);
    const wasRaw = input.isRaw ?? false;
    if (input.isTTY) input.setRawMode(true);
    input.resume();

    // Serialize async key handling so overlapping keypresses can't interleave
    // speech or double-commit.
    let chain: Promise<void> = Promise.resolve();

    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      if (input.isTTY) input.setRawMode(wasRaw);
      input.pause();
    };

    const onKeypress = (_str: string, key: Key & { ctrl?: boolean }): void => {
      if (key && key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }
      chain = chain.then(async () => {
        const committed = await selector.handleKey(key ?? {});
        if (committed) {
          cleanup();
          resolve(committed);
        }
      });
    };

    input.on("keypress", onKeypress);
    chain = chain.then(() => selector.start());
  });
}
