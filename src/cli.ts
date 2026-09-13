/**
 * claude-ally CLI (v0.1) — run a Claude Code session whose permission prompts
 * are driven accessibly by speech + keyboard.
 *
 * Usage:
 *   npm start -- "your prompt here"
 *   npm start -- --silent "your prompt"     # no audio; prints [SPEAK] lines
 *
 * Requires Claude Code auth already set up on this machine (the SDK reuses it).
 */

import { Announcer } from "./announcer/announcer.js";
import { createSpeaker } from "./announcer/tts.js";
import { createEarcon } from "./announcer/earcons.js";
import { createCanUseTool } from "./permissionHandler.js";

function parseArgs(argv: string[]): { silent: boolean; prompt: string } {
  const args = [...argv];
  let silent = false;
  const rest: string[] = [];
  for (const a of args) {
    if (a === "--silent") silent = true;
    else rest.push(a);
  }
  return { silent, prompt: rest.join(" ").trim() };
}

async function main(): Promise<void> {
  const { silent, prompt } = parseArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm start -- [--silent] "your prompt"');
    process.exitCode = 1;
    return;
  }

  let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch {
    console.error("Run `npm install` first (the Agent SDK isn't installed).");
    process.exitCode = 1;
    return;
  }

  const announcer = new Announcer({
    speaker: createSpeaker({ silent }),
    earcon: createEarcon({ silent }),
  });
  const canUseTool = createCanUseTool({ announcer });

  const options: Record<string, unknown> = { permissionMode: "default", canUseTool };

  for await (const message of query({ prompt, options } as never)) {
    const m = message as Record<string, unknown>;
    // Speak Claude's text replies so the whole loop is audible, not just prompts.
    if (m.type === "assistant") {
      const content = (m.message as { content?: Array<{ type: string; text?: string }> })?.content;
      for (const block of content ?? []) {
        if (block.type === "text" && block.text) await announcer.say(block.text);
      }
    }
  }
}

void main();
