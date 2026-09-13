#!/usr/bin/env node
/**
 * agent-ally CLI — drive an AI coding agent accessibly. Pick the control
 * surface(s) that fit you via a profile:
 *
 *   voice  (default) — speech + keyboard at the laptop.
 *   full             — speech + keyboard, plus a phone that can answer decisions.
 *   phone            — the phone is everything: it sends prompts AND approves
 *                      permissions. Laptop can be unattended. No speech.
 *
 * Usage:
 *   agent-ally "your prompt"                # one turn, then exit
 *   agent-ally                             # interactive session (voice profile)
 *   agent-ally --profile full             # + phone answers decisions
 *   agent-ally --profile phone            # drive everything from your phone
 *   agent-ally --phone                     # legacy: add phone to current profile
 *   agent-ally --profile phone --voice    # phone-driven, but also speak aloud
 *   agent-ally --silent                    # no audio; prints [SPEAK] lines
 *   agent-ally --port 5000                 # custom phone port
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
import { isProfileName, resolveSurfaces, type ProfileName } from "./config/profile.js";

interface Args {
  profile?: ProfileName;
  silent: boolean;
  phone: boolean;
  voice: boolean;
  port?: number;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  let profile: ProfileName | undefined;
  let silent = false;
  let phone = false;
  let voice = false;
  let port: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--silent") silent = true;
    else if (a === "--phone") phone = true;
    else if (a === "--voice") voice = true;
    else if (a === "--port") port = Number(argv[(i += 1)]);
    else if (a === "--profile") {
      const name = argv[(i += 1)];
      if (!name || !isProfileName(name)) {
        console.error(`Unknown profile "${name ?? ""}". Use: voice | full | phone.`);
        process.exit(1);
      }
      profile = name;
    } else rest.push(a);
  }
  return { profile, silent, phone, voice, port, prompt: rest.join(" ").trim() };
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

/** A minimal single-consumer async queue for prompts arriving off a socket. */
class PromptQueue {
  private items: string[] = [];
  private waiter: ((v: string | null) => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(text);
    } else {
      this.items.push(text);
    }
  }

  next(): Promise<string | null> {
    if (this.items.length) return Promise.resolve(this.items.shift() as string);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => (this.waiter = resolve));
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const surfaces = resolveSurfaces(args.profile, {
    phone: args.phone,
    silent: args.silent,
    voice: args.voice,
  });

  const announcer = new Announcer({
    speaker: createSpeaker({ silent: !surfaces.voice }),
    earcon: createEarcon({ silent: !surfaces.voice }),
  });

  const channels: DecisionChannel[] = [];
  if (surfaces.terminal) channels.push(new TerminalChannel({ announcer }));

  let phoneChannel: PhoneChannel | undefined;
  if (surfaces.phone) {
    phoneChannel = new PhoneChannel({ port: args.port, acceptsPrompts: surfaces.phonePrompts });
    await phoneChannel.start();
    console.log(`\n📱 Phone control ready — open this on your phone (same Wi-Fi):\n   ${phoneChannel.url}\n`);
    try {
      const qrcode = (await import("qrcode-terminal")).default;
      qrcode.generate(phoneChannel.url, { small: true });
    } catch {
      /* QR is optional */
    }
    console.log("⚠️  Anyone with this link can drive the agent — use on a trusted network only.\n");
    if (surfaces.voice) await announcer.say("Phone control ready. Scan the code to connect.");
    channels.push(phoneChannel);
  }

  const present = createPresenter(channels);
  const adapter: AgentAdapter = new ClaudeAdapter();

  // Route the agent's replies to whichever surfaces are active.
  const onText: RunContext["onText"] = async (t) => {
    if (surfaces.voice) await announcer.say(t);
    phoneChannel?.log("agent", t);
    if (!surfaces.terminal) console.log(`\n${t}\n`);
  };
  const baseCtx: RunContext = { present, onText };

  try {
    if (args.prompt) {
      // One-shot turn.
      await adapter.run(args.prompt, baseCtx);
    } else if (surfaces.terminal) {
      // Terminal-driven interactive session — prompts typed at the laptop.
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
    } else if (phoneChannel) {
      // Phone-driven session — prompts arrive from the phone; laptop unattended.
      console.log("Waiting for prompts from your phone… (Ctrl+C to quit)\n");
      const queue = new PromptQueue();
      phoneChannel.onPrompt((text) => queue.push(text));
      const stop = (): void => queue.close();
      process.on("SIGINT", stop);
      phoneChannel.status("Ready — send a prompt.", false);

      let resume: string | undefined;
      for (;;) {
        const text = await queue.next();
        if (text === null) break;
        phoneChannel.status("Working…", true);
        try {
          resume = (await adapter.run(text, { ...baseCtx, resume })) || resume;
          phoneChannel.status("Ready — send a prompt.", false);
        } catch (err) {
          const message = (err as Error).message;
          console.error(`\n${adapter.name} failed:`, message);
          phoneChannel.log("system", `Error: ${message}`);
          phoneChannel.status("Ready — send a prompt.", false);
        }
      }
      process.off("SIGINT", stop);
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
