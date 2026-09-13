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

interface LineReader {
  /** Resolves with the typed line, or null on EOF / Ctrl+C / cancel. */
  line: Promise<string | null>;
  /** Abandon the read and release stdin (e.g. a phone prompt arrived first). */
  cancel: () => void;
}

/**
 * Read one line in cooked mode. Closing the interface (on submit, EOF, Ctrl+C,
 * or an explicit cancel) fully releases stdin so the decision keyboard handler
 * (raw mode) has clean control during the turn.
 */
function readLine(question: string): LineReader {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let done = false;
  let resolveLine!: (value: string | null) => void;
  const line = new Promise<string | null>((resolve) => (resolveLine = resolve));
  const finish = (value: string | null): void => {
    if (done) return;
    done = true;
    rl.close();
    resolveLine(value);
  };
  rl.question(question, (answer) => finish(answer));
  rl.on("close", () => finish(null));
  rl.on("SIGINT", () => finish(null)); // Ctrl+C at the prompt ends the session
  return { line, cancel: () => finish(null) };
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

interface InteractiveOptions {
  adapter: AgentAdapter;
  baseCtx: RunContext;
  /** Read typed prompts from the terminal (voice/full profiles). */
  askTerminal: boolean;
  /** Prompts submitted from the phone, if the phone may drive the agent. */
  phoneQueue?: PromptQueue;
  /** Present, when connected, so we can reflect busy/idle status on the phone. */
  phoneChannel?: PhoneChannel;
}

/**
 * One interactive loop that serves every profile. Each turn it takes the next
 * prompt from whichever surface acts first — a line typed at the terminal or a
 * prompt sent from the phone — then runs it to completion (so decisions during
 * the turn own stdin uncontested) before accepting the next.
 */
async function runInteractive(opts: InteractiveOptions): Promise<void> {
  const { adapter, baseCtx, askTerminal, phoneQueue, phoneChannel } = opts;
  let resume: string | undefined;

  // A single outstanding phone read, kept across iterations so a prompt that
  // arrives mid-turn is not dropped (a fresh next() would replace the waiter).
  let pendingPhone: Promise<{ src: "phone"; value: string | null }> | null = null;
  let phoneReady = false;
  const armPhone = (): void => {
    if (phoneQueue && !pendingPhone) {
      phoneReady = false;
      pendingPhone = phoneQueue.next().then((value) => {
        phoneReady = true;
        return { src: "phone" as const, value };
      });
    }
  };

  // In phone-only mode Ctrl+C can't come through the terminal reader, so wire it
  // to close the queue and end the loop.
  const onSigint = (): void => phoneQueue?.close();
  if (!askTerminal) process.on("SIGINT", onSigint);

  phoneChannel?.status("Ready — send a prompt.", false);

  try {
    for (;;) {
      let text: string | null;

      if (!askTerminal) {
        // Phone-only: the phone is the sole prompt source.
        text = await (phoneQueue as PromptQueue).next();
        if (text === null) break;
      } else {
        armPhone();
        if (phoneReady && pendingPhone) {
          // A phone prompt is already waiting — take it without opening a reader.
          const { value } = await pendingPhone;
          pendingPhone = null;
          if (value === null) break;
          text = value;
          process.stdout.write(`\n[phone] ${text}\n`);
        } else {
          const reader = readLine("you> ");
          type Won = { src: "term" | "phone"; value: string | null };
          const fromTerminal: Promise<Won> = reader.line.then((value) => ({ src: "term", value }));
          const racers: Promise<Won>[] = pendingPhone ? [fromTerminal, pendingPhone] : [fromTerminal];
          const winner = await Promise.race(racers);
          if (winner.src === "phone") {
            reader.cancel(); // release stdin for the upcoming turn
            pendingPhone = null;
            if (winner.value === null) break;
            text = winner.value;
            process.stdout.write(`\n[phone] ${text}\n`);
          } else {
            if (winner.value === null) break; // Ctrl+D / Ctrl+C at the prompt
            text = winner.value;
          }
        }
      }

      const trimmed = text.trim();
      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      phoneChannel?.status("Working…", true);
      try {
        resume = (await adapter.run(trimmed, { ...baseCtx, resume })) || resume;
      } catch (err) {
        const message = (err as Error).message;
        console.error(`\n${adapter.name} failed:`, message);
        phoneChannel?.log("system", `Error: ${message}`);
      }
      phoneChannel?.status("Ready — send a prompt.", false);
    }
  } finally {
    if (!askTerminal) process.off("SIGINT", onSigint);
  }
  console.log("\nBye.");
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

  // If the phone may drive the agent, funnel its prompts into a queue.
  let phoneQueue: PromptQueue | undefined;
  if (phoneChannel && surfaces.phonePrompts) {
    phoneQueue = new PromptQueue();
    phoneChannel.onPrompt((text) => phoneQueue!.push(text));
  }

  try {
    if (args.prompt) {
      // One-shot turn.
      await adapter.run(args.prompt, baseCtx);
    } else {
      if (surfaces.terminal) {
        console.log('Interactive session. Type a prompt, or "exit" to quit.');
        if (phoneQueue) console.log("(You can also send prompts from your phone.)");
        console.log("");
      } else {
        console.log("Waiting for prompts from your phone… (Ctrl+C to quit)\n");
      }
      await runInteractive({
        adapter,
        baseCtx,
        askTerminal: surfaces.terminal,
        phoneQueue,
        phoneChannel,
      });
    }
  } catch (err) {
    console.error(`\n${adapter.name} failed:`, (err as Error).message);
    process.exitCode = 1;
  } finally {
    await phoneChannel?.close();
  }
}

void main();
