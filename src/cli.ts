#!/usr/bin/env node
/**
 * agent-ally CLI — drive an AI coding agent accessibly (speech + keyboard +
 * phone). Give a prompt for a single turn, or omit it for an interactive
 * session that keeps context across turns.
 *
 * Usage:
 *   agent-ally "your prompt"              # one turn, then exit
 *   agent-ally                            # interactive session (type prompts)
 *   agent-ally --phone                    # also answerable from your phone
 *   agent-ally --phone --port 5000        # custom port
 *   agent-ally --silent "…"               # no audio; prints [SPEAK] lines
 *
 * Requires Claude Code auth already set up on this machine (the adapter reuses it).
 */

import readline from "node:readline";
import { Announcer } from "./announcer/announcer.js";
import { createSpeaker } from "./announcer/tts.js";
import { createEarcon } from "./announcer/earcons.js";
import { TerminalChannel } from "./channels/terminal.js";
import { PhoneChannel } from "./channels/phone.js";
import type { DecisionChannel } from "./channels/types.js";
import { createPresenter } from "./coordinator.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import type { AgentAdapter, RunContext } from "./adapters/types.js";

interface Args {
  silent: boolean;
  phone: boolean;
  port?: number;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  let silent = false;
  let phone = false;
  let port: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--silent") silent = true;
    else if (a === "--phone") phone = true;
    else if (a === "--port") port = Number(argv[(i += 1)]);
    else rest.push(a);
  }
  return { silent, phone, port, prompt: rest.join(" ").trim() };
}

/**
 * Read one line in cooked mode, then fully close the interface so the decision
 * keyboard handler (raw mode) has clean control of stdin during the turn.
 * Resolves to null on EOF (Ctrl+D).
 */
function askLine(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      rl.close();
      resolve(value);
    };
    rl.question(question, (answer) => finish(answer));
    rl.on("close", () => finish(null));
  });
}

async function main(): Promise<void> {
  const { silent, phone, port, prompt } = parseArgs(process.argv.slice(2));

  const announcer = new Announcer({
    speaker: createSpeaker({ silent }),
    earcon: createEarcon({ silent }),
  });

  const channels: DecisionChannel[] = [new TerminalChannel({ announcer })];

  let phoneChannel: PhoneChannel | undefined;
  if (phone) {
    phoneChannel = new PhoneChannel({ port });
    await phoneChannel.start();
    console.log(`\n📱 Phone control ready — open this on your phone (same Wi-Fi):\n   ${phoneChannel.url}\n`);
    try {
      const qrcode = (await import("qrcode-terminal")).default;
      qrcode.generate(phoneChannel.url, { small: true });
    } catch {
      /* QR is optional */
    }
    console.log("⚠️  Anyone with this link can approve the agent's actions — use on a trusted network only.\n");
    await announcer.say("Phone control ready. Scan the code to connect.");
    channels.push(phoneChannel);
  }

  const present = createPresenter(channels);
  const adapter: AgentAdapter = new ClaudeAdapter();
  const baseCtx: RunContext = { present, onText: (t) => announcer.say(t) };

  try {
    if (prompt) {
      // One-shot turn.
      await adapter.run(prompt, baseCtx);
    } else {
      // Interactive session — keep context across turns via the returned id.
      console.log('Interactive session. Type a prompt, or "exit" to quit.\n');
      let resume: string | undefined;
      for (;;) {
        const line = await askLine("you> ");
        if (line === null) break; // Ctrl+D
        const text = line.trim();
        if (!text) continue;
        if (text === "exit" || text === "quit") break;
        try {
          resume = (await adapter.run(text, { ...baseCtx, resume })) || resume;
        } catch (err) {
          console.error(`\n${adapter.name} failed:`, (err as Error).message);
        }
      }
      console.log("\nBye.");
    }
  } catch (err) {
    console.error(`\n${adapter.name} failed:`, (err as Error).message);
    process.exitCode = 1;
  } finally {
    await phoneChannel?.close();
  }
}

void main();
