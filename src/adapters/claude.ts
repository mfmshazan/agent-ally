/**
 * Claude Code adapter — the flagship. Drives a Claude Agent SDK `query()`
 * session, routing every decision through the accessibility engine via the
 * `canUseTool` callback, and surfacing Claude's text replies to be spoken.
 */

import { createCanUseTool } from "../permissionHandler.js";
import type { AgentAdapter, RunContext } from "./types.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude-code";

  async run(prompt: string, ctx: RunContext): Promise<string | void> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const canUseTool = createCanUseTool({ present: ctx.present });
    const options: Record<string, unknown> = { permissionMode: "default", canUseTool };
    // Resuming a prior session keeps context across turns in interactive mode.
    if (ctx.resume) options.resume = ctx.resume;

    let sessionId: string | undefined = ctx.resume;
    for await (const message of query({ prompt, options } as never)) {
      const m = message as Record<string, unknown>;
      if (m.type === "system" && m.subtype === "init" && typeof m.session_id === "string") {
        sessionId = m.session_id;
      }
      if (m.type === "assistant" && ctx.onText) {
        const content = (m.message as { content?: Array<{ type: string; text?: string }> })?.content;
        for (const block of content ?? []) {
          if (block.type === "text" && block.text) await ctx.onText(block.text);
        }
      }
    }
    return sessionId;
  }
}
