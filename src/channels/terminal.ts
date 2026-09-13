/**
 * Terminal channel — the original speak + keyboard experience, now expressed as
 * a DecisionChannel so it can race against the phone. High-risk permissions
 * require the second-Enter confirm; questions don't.
 */

import type { Decision, DecisionOption } from "../types.js";
import type { Announcer } from "../announcer/announcer.js";
import { promptDecision } from "../input/keyboard.js";
import type { DecisionChannel } from "./types.js";

/** Injectable prompt so tests can skip the TTY. */
export type TerminalPromptFn = (
  decision: Decision,
  opts: { requireConfirm: boolean; signal: AbortSignal },
) => Promise<DecisionOption>;

export interface TerminalChannelDeps {
  announcer: Announcer;
  prompt?: TerminalPromptFn;
}

export class TerminalChannel implements DecisionChannel {
  readonly name = "terminal";
  private readonly announcer: Announcer;
  private readonly prompt: TerminalPromptFn;

  constructor(deps: TerminalChannelDeps) {
    this.announcer = deps.announcer;
    this.prompt =
      deps.prompt ??
      ((decision, opts) =>
        promptDecision(decision, {
          announcer: this.announcer,
          requireConfirm: opts.requireConfirm,
          signal: opts.signal,
        }));
  }

  async present(decision: Decision, signal: AbortSignal): Promise<DecisionOption> {
    // If another channel (the phone) answers first, silence our speech at once
    // rather than letting the announcement play over the next thing spoken.
    const onAbort = (): void => this.announcer.stop();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.announcer.announce(decision);
      const requireConfirm = decision.kind === "permission" && decision.riskLevel === "high";
      return await this.prompt(decision, { requireConfirm, signal });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
