/**
 * Keyboard runtime — wires real terminal keypresses into a Selector.
 *
 * Separated from the Selector so the state machine stays testable without a
 * TTY. This file owns raw-mode stdin, readline keypress decoding, and cleanup.
 *
 * Accepts an AbortSignal so a coordinator can cancel this prompt when another
 * channel (e.g. the phone) answers first.
 */

import readline from "node:readline";
import type { Decision, DecisionOption } from "../types.js";
import type { Announcer } from "../announcer/announcer.js";
import { Selector, type Key } from "./selector.js";

export interface PromptDeps {
  announcer: Announcer;
  requireConfirm: boolean;
  signal?: AbortSignal;
  input?: NodeJS.ReadStream;
}

/**
 * Announce + navigate a decision on the terminal, resolving to the committed
 * option. Rejects on Ctrl+C or when `signal` aborts so callers can fail safe.
 */
export function promptDecision(decision: Decision, deps: PromptDeps): Promise<DecisionOption> {
  const input = deps.input ?? process.stdin;
  const selector = new Selector(decision, {
    announcer: deps.announcer,
    requireConfirm: deps.requireConfirm,
  });

  return new Promise<DecisionOption>((resolve, reject) => {
    if (deps.signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }

    readline.emitKeypressEvents(input);
    const wasRaw = input.isRaw ?? false;
    if (input.isTTY) input.setRawMode(true);
    input.resume();

    // Serialize async key handling so overlapping keypresses can't interleave
    // speech or double-commit.
    let chain: Promise<void> = Promise.resolve();

    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      deps.signal?.removeEventListener("abort", onAbort);
      if (input.isTTY) input.setRawMode(wasRaw);
      input.pause();
    };

    const onAbort = (): void => {
      cleanup();
      reject(new Error("aborted"));
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

    deps.signal?.addEventListener("abort", onAbort, { once: true });
    input.on("keypress", onKeypress);
    chain = chain.then(() => selector.start());
  });
}
