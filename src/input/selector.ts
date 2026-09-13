/**
 * Selector — the accessible navigation state machine for a decision's options.
 *
 * Pure-ish and testable: it owns the index + "awaiting confirm" state and calls
 * the Announcer to speak moves, but does no terminal I/O itself. The stdin
 * runtime (keyboard.ts) feeds it keys; tests feed it synthetic keys.
 *
 * Contract: feed keys via `handleKey`; it resolves to a committed
 * `DecisionOption` when the user confirms a choice, or `null` to keep going.
 */

import type { Decision, DecisionOption } from "../types.js";
import type { Announcer } from "../announcer/announcer.js";

/** Minimal subset of a readline keypress we care about. */
export interface Key {
  name?: string; // "up" | "down" | "return" | "d" | "1".."9" ...
  sequence?: string;
}

export interface SelectorDeps {
  announcer: Announcer;
  /** High-stakes choices require a second Enter before committing. */
  requireConfirm: boolean;
}

export class Selector {
  private index = 0;
  private confirming = false;

  constructor(
    private readonly decision: Decision,
    private readonly deps: SelectorDeps,
  ) {}

  private get options(): DecisionOption[] {
    return this.decision.options;
  }

  private get current(): DecisionOption {
    return this.options[this.index];
  }

  /** Speak the starting option so the user knows where the cursor is. */
  async start(): Promise<void> {
    await this.deps.announcer.selection(this.current, this.index, this.options.length);
  }

  private async moveTo(index: number): Promise<void> {
    this.index = Math.max(0, Math.min(this.options.length - 1, index));
    this.confirming = false; // any movement cancels a pending confirm
    await this.deps.announcer.selection(this.current, this.index, this.options.length);
  }

  /**
   * Process one key. Returns the committed option, or null to keep navigating.
   */
  async handleKey(key: Key): Promise<DecisionOption | null> {
    const name = key.name ?? key.sequence ?? "";

    // Number keys jump straight to an option (1-based).
    if (/^[1-9]$/.test(name)) {
      const target = Number(name) - 1;
      if (target < this.options.length) await this.moveTo(target);
      return null;
    }

    switch (name) {
      case "up":
      case "k":
        await this.moveTo(this.index - 1);
        return null;
      case "down":
      case "j":
        await this.moveTo(this.index + 1);
        return null;
      case "d":
        await this.deps.announcer.details(this.decision);
        return null;
      case "r":
        // Re-hear the whole decision, then where the cursor currently is.
        await this.deps.announcer.repeat(this.decision);
        await this.deps.announcer.selection(this.current, this.index, this.options.length);
        return null;
      case "return":
      case "enter": {
        if (this.deps.requireConfirm && !this.confirming) {
          this.confirming = true;
          await this.deps.announcer.confirm(this.current);
          return null;
        }
        await this.deps.announcer.committed(this.current);
        return this.current;
      }
      default:
        return null;
    }
  }
}
