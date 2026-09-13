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

  constructor(deps: AnnouncerDeps) {
    this.speaker = deps.speaker;
    this.earcon = deps.earcon;
    this.verbosity = deps.verbosity ?? "normal";
  }

  /** Speak arbitrary text (e.g. Claude's assistant replies). */
  async say(text: string): Promise<void> {
    await this.speaker.speak(text);
  }

  /** Announce a decision when it first appears: earcon + intro + options list. */
  async announce(decision: Decision): Promise<void> {
    await this.earcon.play("blocking");

    if (decision.kind === "permission") {
      const risk = decision.riskLevel === "low" ? "" : ` ${riskPhrase(decision.riskLevel)}`;
      await this.speaker.speak(`Permission needed. ${decision.title}.${risk}`);
    } else {
      await this.speaker.speak(`Claude is asking. ${decision.title}.`);
    }

    await this.speakOptionList(decision.options);

    const hint =
      decision.kind === "permission" && decision.command
        ? `Use the arrow keys or number keys to choose, then press enter. Say "details" to hear the full command.`
        : "Use the arrow keys or number keys to choose, then press enter.";
    if (this.verbosity !== "terse") await this.speaker.speak(hint);
  }

  private async speakOptionList(options: DecisionOption[]): Promise<void> {
    const parts = options.map((o, i) => `${i + 1}, ${o.label}`);
    await this.speaker.speak(`Options: ${parts.join(". ")}.`);
  }

  /** Speak the currently-highlighted option. Called on every navigation move. */
  async selection(option: DecisionOption, index: number, total: number): Promise<void> {
    const position = `${index + 1} of ${total}`;
    const detail =
      this.verbosity === "verbose" && option.description ? `. ${option.description}` : "";
    await this.speaker.speak(`${position}, ${option.label}${detail}.`);
  }

  /** Ask for an explicit second press before committing a high-stakes choice. */
  async confirm(option: DecisionOption): Promise<void> {
    await this.speaker.speak(`Confirm ${option.label}? Press enter again to confirm.`);
  }

  /** A choice has been committed. */
  async committed(option: DecisionOption): Promise<void> {
    await this.earcon.play("committed");
    await this.speaker.speak(`${option.label} selected.`);
  }

  /** Read the full shell command on demand (the "details" affordance). */
  async details(decision: Decision): Promise<void> {
    if (decision.kind === "permission" && decision.command) {
      await this.speaker.speak(`Full command: ${decision.command}`);
    } else {
      await this.speaker.speak("No further details.");
    }
  }

  /** Something went wrong (tool failed, couldn't present a decision, etc.). */
  async failure(message: string): Promise<void> {
    await this.earcon.play("failure");
    await this.speaker.speak(message);
  }
}
