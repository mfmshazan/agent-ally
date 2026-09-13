/**
 * A DecisionChannel presents a decision to a human and resolves to the option
 * they chose. The terminal (speak + keyboard) and the phone (web page) are both
 * channels; the coordinator races them so either device can answer.
 */

import type { Decision, DecisionOption } from "../types.js";

export interface DecisionChannel {
  /** A short name for logging ("terminal", "phone"). */
  readonly name: string;
  /**
   * Present `decision` and resolve with the chosen option. Must reject (or
   * never resolve) if `signal` aborts — that's how a losing channel is told
   * another channel already answered.
   */
  present(decision: Decision, signal: AbortSignal): Promise<DecisionOption>;
  /** Release resources (sockets, listeners). */
  close?(): Promise<void>;
}
