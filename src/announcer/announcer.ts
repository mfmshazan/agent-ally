/**
 * Announcer — turns a normalized Decision into the spoken experience a blind
 * developer hears: an earcon that the agent is blocked on them, the decision
 * read aloud, options enumerated as a numbered list, the current selection
 * spoken on every move, and a spoken confirmation before anything commits.
 *
 * It holds no input logic and no SDK logic — just "say this decision out loud".
 * The Input handler (next piece) drives navigation and calls `selection()`.
 */

import type { Decision, DecisionOption, RiskLevel } from "../types.js";
import type { Speaker } from "./tts.js";
import type { Earcon } from "./earcons.js";

export type Verbosity = "terse" | "normal" | "verbose";

export interface AnnouncerDeps {
  speaker: Speaker;
  earcon: Earcon;
  verbosity?: Verbosity;
}

function riskPhrase(level: RiskLevel): string {
  switch (level) {
    case "high":
      return "High risk.";
    case "medium":
      return "Medium risk.";
    case "low":
      return "Low risk.";
  }
}

export class Announcer {
  private readonly speaker: Speaker;
  private readonly earcon: Earcon;
  private readonly verbosity: Verbosity;

  /**
   * Controls the utterance currently playing. Starting a new top-level utterance
   * aborts this, so a newer thing to say (a navigation move, an answer landing
   * from the phone, the next reply) interrupts the old speech instead of
   * overlapping it. All the speaks within one utterance share this signal, so an
   * utterance never cuts itself off mid-sentence.
   */
  private current: AbortController | null = null;

  constructor(deps: AnnouncerDeps) {
    this.speaker = deps.speaker;
    this.earcon = deps.earcon;
    this.verbosity = deps.verbosity ?? "normal";
  }

  /** Begin a fresh utterance, interrupting any speech still playing. */
  private begin(): AbortSignal {
    this.current?.abort();
    const ac = new AbortController();
    this.current = ac;
    return ac.signal;
  }

  /** Stop whatever is currently being spoken (e.g. another channel answered). */
  stop(): void {
    this.current?.abort();
    this.current = null;
  }

  /** Speak arbitrary text (e.g. Claude's assistant replies). */
  async say(text: string): Promise<void> {
    await this.speaker.speak(text, this.begin());
  }

  /** Announce a decision when it first appears: earcon + intro + options + hint. */
  async announce(decision: Decision): Promise<void> {
    const signal = this.begin();
    await this.earcon.play("blocking");
    // One speak call = one TTS process, so there are no silent startup gaps
    // between the intro, options, and hint sentences.
    const text = this.buildBody(decision) + (this.verbosity !== "terse" ? ` ${this.hint(decision)}` : "");
    await this.speaker.speak(text, signal);
  }

  /** Re-announce on demand (the "R to repeat" affordance). No earcon. */
  async repeat(decision: Decision): Promise<void> {
    const signal = this.begin();
    await this.speaker.speak(`${this.buildBody(decision)} ${this.hint(decision)}`, signal);
  }

  private buildBody(decision: Decision): string {
    const intro =
      decision.kind === "permission"
        ? `Permission needed. ${decision.title}.${decision.riskLevel === "low" ? "" : ` ${riskPhrase(decision.riskLevel)}`}`
        : `Claude is asking. ${decision.title}.`;
    const parts = decision.options.map((o, i) => `${i + 1}, ${o.label}`);
    return `${intro} Options: ${parts.join(". ")}.`;
  }

  private hint(decision: Decision): string {
    const base =
      "Use the arrow keys or number keys to choose, then press enter. Press R to repeat.";
    if (decision.kind === "permission" && decision.command) {
      return `${base} Press D to hear the full command.`;
    }
    return base;
  }

  /** Speak the currently-highlighted option. Called on every navigation move. */
  async selection(option: DecisionOption, index: number, total: number): Promise<void> {
    const position = `${index + 1} of ${total}`;
    const detail =
      this.verbosity === "verbose" && option.description ? `. ${option.description}` : "";
    await this.speaker.speak(`${position}, ${option.label}${detail}.`, this.begin());
  }

  /** Ask for an explicit second press before committing a high-stakes choice. */
  async confirm(option: DecisionOption): Promise<void> {
    await this.speaker.speak(`Confirm ${option.label}? Press enter again to confirm.`, this.begin());
  }

  /** A choice has been committed. */
  async committed(option: DecisionOption): Promise<void> {
    const signal = this.begin();
    await this.earcon.play("committed");
    await this.speaker.speak(`${option.label} selected.`, signal);
  }

  /** Read the full shell command on demand (the "details" affordance). */
  async details(decision: Decision): Promise<void> {
    const signal = this.begin();
    if (decision.kind === "permission" && decision.command) {
      await this.speaker.speak(`Full command: ${decision.command}`, signal);
    } else {
      await this.speaker.speak("No further details.", signal);
    }
  }

  /** Something went wrong (tool failed, couldn't present a decision, etc.). */
  async failure(message: string): Promise<void> {
    const signal = this.begin();
    await this.earcon.play("failure");
    await this.speaker.speak(message, signal);
  }
}
