/**
 * Claude Code adapter — the flagship. Drives a Claude Agent SDK `query()`
 * session, routing every decision through the accessibility engine via the
 * `canUseTool` callback, and surfacing Claude's text replies to be spoken.
 */

import { createCanUseTool } from "../permissionHandler.js";
import type { AgentAdapter, RunContext } from "./types.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude-code";

  async run(prompt: string, ctx: RunContext): Promise<void> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const canUseTool = createCanUseTool({ present: ctx.present });
    const options: Record<string, unknown> = { permissionMode: "default", canUseTool };

    for await (const message of query({ prompt, options } as never)) {
      const m = message as Record<string, unknown>;
      if (m.type === "assistant" && ctx.onText) {
        const content = (m.message as { content?: Array<{ type: string; text?: string }> })?.content;
        for (const block of content ?? []) {
          if (block.type === "text" && block.text) await ctx.onText(block.text);
        }
      }
    }
  }
}
