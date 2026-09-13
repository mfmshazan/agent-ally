#!/usr/bin/env node
/**
 * agent-ally CLI — run a Claude Code session whose decisions are driven
 * accessibly by speech + keyboard, and optionally from your phone.
 *
 * Usage:
 *   npm start -- "your prompt"                 # terminal only
 *   npm start -- --phone "your prompt"         # also answerable from your phone
 *   npm start -- --phone --port 5000 "…"       # custom port
 *   npm start -- --silent "…"                  # no audio; prints [SPEAK] lines
 *
 * Requires Claude Code auth already set up on this machine (the SDK reuses it).
 */

import { Announcer } from "./announcer/announcer.js";
import { createSpeaker } from "./announcer/tts.js";
import { createEarcon } from "./announcer/earcons.js";
import { TerminalChannel } from "./channels/terminal.js";
import { PhoneChannel } from "./channels/phone.js";
import type { DecisionChannel } from "./channels/types.js";
import { createPresenter } from "./coordinator.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import type { AgentAdapter } from "./adapters/types.js";

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

async function main(): Promise<void> {
  const { silent, phone, port, prompt } = parseArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm start -- [--phone] [--port N] [--silent] "your prompt"');
    process.exitCode = 1;
    return;
  }

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

  try {
    await adapter.run(prompt, { present, onText: (t) => announcer.say(t) });
  } catch (err) {
    console.error(`\n${adapter.name} failed:`, (err as Error).message);
    process.exitCode = 1;
  } finally {
    await phoneChannel?.close();
  }
}

void main();
