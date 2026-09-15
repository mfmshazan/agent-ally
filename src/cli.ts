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
 * Phone control is ON by default (the QR prints on every launch); pass
 * --no-phone for a pure laptop/voice session.
 *
 * Usage:
 *   agent-ally "your prompt"                # one turn, then exit
 *   agent-ally                             # interactive session (+ phone QR)
 *   agent-ally --no-phone                   # laptop/voice only, no phone/QR
 *   agent-ally --profile phone            # drive everything from your phone
 *   agent-ally --profile phone --voice    # phone-driven, but also speak aloud
 *   agent-ally --silent                    # no audio; prints [SPEAK] lines
 *   agent-ally --new                       # start a brand-new chat for this project
 *   agent-ally --list                      # list this project's past sessions, then exit
 *   agent-ally --resume 2                  # reopen session #2 from --list (or by id)
 *   agent-ally --history                   # print the current chat's transcript, then exit
 *   agent-ally --port 5000                 # custom phone port
 *
 * Each project keeps multiple chats (like an IDE's conversation list). Relaunching
 * reopens the current chat and continues its thread; --new starts another, and
 * --list / --resume switch between them.
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
import { HistoryStore, defaultHistoryFile } from "./history/store.js";
import { SessionStore, defaultSessionFile } from "./history/session.js";
import { formatTranscript } from "./history/format.js";
import { ChatStore, NEW_CHAT_TITLE, type ChatMeta } from "./history/chats.js";
import { listClaudeSessions, type ClaudeSession } from "./history/claudeSessions.js";

interface Args {
  profile?: ProfileName;
  silent: boolean;
  phone: boolean;
  noPhone: boolean;
  voice: boolean;
  newChat: boolean;
  list: boolean;
  resume?: string;
  history: boolean;
  port?: number;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  let profile: ProfileName | undefined;
  let silent = false;
  let phone = false;
  let noPhone = false;
  let voice = false;
  let newChat = false;
  let list = false;
  let resume: string | undefined;
  let history = false;
  let port: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--silent") silent = true;
    else if (a === "--phone") phone = true;
    else if (a === "--no-phone") noPhone = true;
    else if (a === "--voice") voice = true;
    else if (a === "--new" || a === "--fresh") newChat = true;
    else if (a === "--list" || a === "--chats") list = true;
    else if (a === "--resume") resume = argv[(i += 1)];
    else if (a === "--history") history = true;
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
  return { profile, silent, phone, noPhone, voice, newChat, list, resume, history, port, prompt: rest.join(" ").trim() };
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
  /** A prior session id to continue (e.g. yesterday's plan for this project). */
  initialResume?: string;
  /** Persist the session id after each turn so it survives a restart. */
  onResume?: (sessionId: string) => void;
  /** The transcript store, so `history` at the prompt can print it locally. */
  historyStore?: HistoryStore;
  /** The chat registry + current chat id, for auto-titling and recency. */
  chatStore?: ChatStore;
  chatId?: string;
}

/**
 * Typed at the `you>` prompt, these print the saved transcript locally instead
 * of being sent to the agent — so a natural instinct like typing "history" (or
 * even "agent-ally --history") just works, rather than becoming a chat message.
 */
const HISTORY_COMMANDS = new Set(["history", "/history", "--history", "agent-ally --history"]);
const CHATS_COMMANDS = new Set(["chats", "/chats", "--list", "agent-ally --list"]);

/**
 * One interactive loop that serves every profile. Each turn it takes the next
 * prompt from whichever surface acts first — a line typed at the terminal or a
 * prompt sent from the phone — then runs it to completion (so decisions during
 * the turn own stdin uncontested) before accepting the next.
 */
async function runInteractive(opts: InteractiveOptions): Promise<void> {
  const { adapter, baseCtx, askTerminal, phoneQueue, phoneChannel, onResume, chatStore } = opts;
  // These change when you switch chats mid-session (the "switch" command).
  let historyStore = opts.historyStore;
  let chatId = opts.chatId;
  let resume: string | undefined = opts.initialResume;

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
      // Local commands — handled here, never sent to the agent.
      if (HISTORY_COMMANDS.has(trimmed.toLowerCase())) {
        console.log("\n" + formatTranscript(historyStore?.load() ?? []) + "\n");
        if (phoneChannel) phoneChannel.log("system", "📜 Transcript is above — scroll up to review.");
        continue;
      }
      if (CHATS_COMMANDS.has(trimmed.toLowerCase())) {
        console.log("");
        if (chatStore) printChats(chatStore, process.cwd());
        console.log("\n(Switch here with  switch <number>  — no need to relaunch.)\n");
        continue;
      }
      // "switch <n>" jumps to another chat live — no exit/relaunch, and it never
      // leaks to the agent as a prompt.
      const sw = trimmed.match(/^(?:switch|\/switch)\s+(.+)$/i);
      if (sw && chatStore) {
        const target = resolveResume(chatStore, process.cwd(), sw[1].trim());
        if (!target) {
          console.log(`No chat "${sw[1].trim()}". Type "chats" to list them.`);
          continue;
        }
        chatId = target.id;
        resume = target.sessionId;
        historyStore = new HistoryStore(chatStore.transcriptFile(target.id));
        phoneChannel?.setHistory(historyStore);
        const note = `Switched to: ${target.title}`;
        console.log(`\n💬 ${note}\n`);
        phoneChannel?.log("system", note);
        continue;
      }

      // Name a brand-new chat after its first real prompt.
      if (chatStore && chatId && chatStore.get(chatId)?.title === NEW_CHAT_TITLE) {
        chatStore.update(chatId, { title: trimmed.slice(0, 50) });
      }

      phoneChannel?.status("Working…", true);
      try {
        const next = (await adapter.run(trimmed, { ...baseCtx, resume })) || resume;
        if (next && next !== resume) {
          // Persist to whichever chat is current (it may have changed via switch).
          if (chatStore && chatId) chatStore.update(chatId, { sessionId: next });
          else onResume?.(next);
        }
        resume = next;
        if (chatStore && chatId) chatStore.touch(chatId);
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

/**
 * One-time migration: fold a pre-chat project (single shared transcript + a
 * single saved session) into the new multi-chat store as one "Previous chat",
 * so upgrading users don't lose their thread.
 */
function migrateLegacyChat(store: ChatStore, cwd: string): void {
  if (store.list().length > 0) return;
  const entries = new HistoryStore(defaultHistoryFile(cwd)).load();
  if (entries.length === 0) return;
  const chat = store.create("Previous chat");
  const dst = new HistoryStore(store.transcriptFile(chat.id));
  for (const e of entries) dst.append(e);
  const sessionId = new SessionStore(defaultSessionFile(cwd)).load();
  if (sessionId) store.update(chat.id, { sessionId });
}

/** Claude Code sessions for this project that agent-ally hasn't adopted yet. */
function externalSessions(store: ChatStore, cwd: string): ClaudeSession[] {
  const known = new Set(store.list().map((c) => c.sessionId).filter(Boolean));
  return listClaudeSessions(cwd).filter((s) => !known.has(s.sessionId));
}

/** Adopt an external Claude session as an agent-ally chat, and make it current. */
function adoptSession(store: ChatStore, s: ClaudeSession): ChatMeta {
  const existing = store.list().find((c) => c.sessionId === s.sessionId);
  if (existing) return store.switchTo(existing.id) ?? existing;
  const chat = store.create(s.title === "(untitled)" ? NEW_CHAT_TITLE : s.title.slice(0, 50));
  store.update(chat.id, { sessionId: s.sessionId });
  return store.get(chat.id) ?? chat;
}

/** One entry in the unified "past sessions" list, whatever its origin. */
interface SessionItem {
  title: string;
  updatedAt: string;
  isCurrent: boolean;
  chat?: ChatMeta; // an agent-ally chat…
  session?: ClaudeSession; // …or an as-yet-unadopted Claude session
}

/**
 * Every session for this project as one list, newest first: agent-ally chats
 * and Claude sessions from the extension/CLI, merged and sorted together. The
 * last-used one (agent-ally's current chat) is flagged.
 */
function unifiedSessions(store: ChatStore, cwd: string): SessionItem[] {
  const currentId = store.current()?.id;
  const items: SessionItem[] = store
    .list()
    .map((c) => ({ title: c.title, updatedAt: c.updatedAt, isCurrent: c.id === currentId, chat: c }));
  for (const s of externalSessions(store, cwd)) {
    items.push({ title: s.title, updatedAt: s.updatedAt, isCurrent: false, session: s });
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return items;
}

/**
 * Resolve a `--resume`/`switch` selector against the unified list shown by
 * `--list` (a 1-based position), or a chat id / raw session id. Returns the
 * now-current chat, or undefined.
 */
function resolveResume(store: ChatStore, cwd: string, selector: string): ChatMeta | undefined {
  const items = unifiedSessions(store, cwd);
  const n = Number(selector);
  let target: SessionItem | undefined;
  if (Number.isInteger(n) && n >= 1 && n <= items.length) target = items[n - 1];
  target ??= items.find((it) => it.chat?.id === selector || it.session?.sessionId === selector);
  if (!target) return undefined;
  return target.chat ? store.switchTo(target.chat.id) : adoptSession(store, target.session!);
}

/** Print every past session for this project as one list (for `--list`). */
function printChats(store: ChatStore, cwd: string): void {
  const items = unifiedSessions(store, cwd);
  if (items.length === 0) {
    console.log("No sessions yet. Start one with:  agent-ally");
    return;
  }
  console.log("Past sessions for this project (newest first):\n");
  items.forEach((it, i) => {
    const mark = it.isCurrent ? "   ← last used" : "";
    console.log(`  ${i + 1}. ${it.title}${mark}`);
    console.log(`      ${new Date(it.updatedAt).toLocaleString()}`);
  });
  console.log("\nReopen one:   agent-ally --resume <number>");
  console.log("New chat:     agent-ally --new");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  // Chats live per project; migrate any pre-chat data on first run.
  const chatStore = new ChatStore(cwd);
  migrateLegacyChat(chatStore, cwd);

  // `--list` shows every past session (agent-ally + extension/CLI) and exits.
  if (args.list) {
    printChats(chatStore, cwd);
    return;
  }

  // Choose which chat to open: an explicit --resume, a brand-new chat (--new),
  // or the current one (creating the first chat if none exists).
  let chat: ChatMeta;
  if (args.resume) {
    const found = resolveResume(chatStore, cwd, args.resume);
    if (!found) {
      console.error(`No chat "${args.resume}". Run  agent-ally --list  to see them.`);
      process.exit(1);
    }
    chat = found;
  } else if (args.newChat) {
    chat = chatStore.create();
  } else {
    chat = chatStore.currentOrCreate();
  }

  // Each chat has its own transcript; the phone persists to it and `history`
  // reads it back.
  const historyStore = new HistoryStore(chatStore.transcriptFile(chat.id));

  // `--history` prints this chat's transcript and exits — no session, no audio.
  if (args.history) {
    console.log(formatTranscript(historyStore.load()));
    return;
  }

  const surfaces = resolveSurfaces(args.profile, {
    phone: args.phone,
    noPhone: args.noPhone,
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
    phoneChannel = new PhoneChannel({
      port: args.port,
      acceptsPrompts: surfaces.phonePrompts,
      store: historyStore,
    });
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
  // Notes (e.g. auto-approved edits) go to the log/transcript but aren't spoken,
  // so opting into "allow all edits" actually stays quiet and fast.
  const onNote: RunContext["onNote"] = (t) => {
    phoneChannel?.log("system", t);
    console.log(t);
  };
  const baseCtx: RunContext = { present, onText, onNote };

  // Resume this chat's Claude session so relaunching continues its thread; save
  // the id back onto the chat as the SDK reports it.
  const initialResume = chat.sessionId;
  const onResume = (id: string): void => chatStore.update(chat.id, { sessionId: id });
  console.log(`\n💬 Chat: ${chat.title}`);
  if (initialResume) {
    const note = "Continuing this chat where you left off.";
    console.log(`↩️  ${note}  (--new for a fresh chat · --list to switch)`);
    // Don't persist this to the transcript — the phone already replays the
    // thread, and logging it every launch just piles up duplicate notes.
    if (surfaces.voice) await announcer.say(note);
  } else {
    console.log("   New chat.  (--list to see all chats for this project)");
  }

  // If the phone may drive the agent, funnel its prompts into a queue.
  let phoneQueue: PromptQueue | undefined;
  if (phoneChannel && surfaces.phonePrompts) {
    phoneQueue = new PromptQueue();
    phoneChannel.onPrompt((text) => phoneQueue!.push(text));
  }

  try {
    if (args.prompt) {
      // One-shot turn — still persist the session so a later run can resume it.
      if (chatStore.get(chat.id)?.title === NEW_CHAT_TITLE) {
        chatStore.update(chat.id, { title: args.prompt.slice(0, 50) });
      }
      const next = await adapter.run(args.prompt, { ...baseCtx, resume: initialResume });
      if (typeof next === "string" && next) onResume(next);
      chatStore.touch(chat.id);
    } else {
      if (surfaces.terminal) {
        console.log('Interactive session. Type a prompt, "history" to review, "chats" to list, or "exit" to quit.');
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
        initialResume,
        onResume,
        historyStore,
        chatStore,
        chatId: chat.id,
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
