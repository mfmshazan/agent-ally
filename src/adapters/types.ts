/**
 * An AgentAdapter connects a specific AI coding agent to agent-ally's universal
 * accessibility engine. Its job: drive the agent, and for each decision the
 * agent raises, call `present` (which announces + navigates across channels) and
 * feed the chosen result back to the agent in that agent's own format.
 *
 * The Claude Code adapter (via the Agent SDK's canUseTool) is the flagship.
 * Other agents implement this same interface as they expose a decision hook.
 */

import type { PresentFn } from "../coordinator.js";

export interface RunContext {
  /** Present a decision on all channels; resolves to the chosen option. */
  present: PresentFn;
  /** Called with the agent's user-facing text so it can be spoken. */
  onText?: (text: string) => void | Promise<void>;
}

export interface AgentAdapter {
  /** Short identifier, e.g. "claude-code". */
  readonly name: string;
  /** Run one request to completion, routing decisions through `ctx.present`. */
  run(prompt: string, ctx: RunContext): Promise<void>;
}
