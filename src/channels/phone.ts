/**
 * Phone channel — a tiny token-secured local web server. The phone opens a page
 * over the LAN, sees the current decision, and taps an option; the tap comes
 * back over a WebSocket and resolves the decision.
 *
 * Security: a random pairing token guards both the page and the socket. Only a
 * device that has the token (via the printed URL / QR) can answer — important,
 * because answering can approve shell commands. Use on a trusted network only.
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type { Decision, DecisionOption } from "../types.js";
import type { DecisionChannel } from "./types.js";
import type { HistoryEntry, HistoryStore } from "../history/store.js";

export interface PhoneChannelOptions {
  port?: number;
  token?: string;
  /** Tell the phone it may submit prompts (shows the composer). */
  acceptsPrompts?: boolean;
  /** Persist the transcript across sessions (per project). */
  store?: HistoryStore;
}

interface Pending {
  decision: Decision;
  resolve: (o: DecisionOption) => void;
}

/** Shape sent to the phone — no functions, no raw SDK internals. */
function serialize(decision: Decision) {
  return {
    toolUseId: decision.toolUseId,
    kind: decision.kind,
    title: decision.title,
    riskLevel: decision.kind === "permission" ? decision.riskLevel : undefined,
    command: decision.kind === "permission" ? decision.command : undefined,
    options: decision.options.map((o) => ({
      label: o.label,
      description: o.description,
      value: o.value,
    })),
  };
}

/** A one-line record of a resolved decision for the transcript. */
function answerSummary(decision: Decision, option: DecisionOption): string {
  if (decision.kind === "permission") {
    const verb = option.value === "allow" ? "✅ Allowed" : "⛔ Denied";
    return `${verb}: ${decision.title}`;
  }
  return `✅ Chose "${option.label}" — ${decision.title}`;
}

function firstLanAddress(): string {
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

export class PhoneChannel implements DecisionChannel {
  readonly name = "phone";
  readonly token: string;
  readonly port: number;
  readonly acceptsPrompts: boolean;

  private server?: http.Server;
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private pending: Pending | null = null;
  private readonly html: string;
  private promptHandler?: (text: string) => void;
  private lastStatus = { text: "Waiting…", busy: false };
  /** Server-side transcript so a reloaded / newly-joined phone sees the thread. */
  private readonly history: HistoryEntry[];
  private readonly maxHistory = 300;
  private readonly store?: HistoryStore;

  constructor(opts: PhoneChannelOptions = {}) {
    this.token = opts.token ?? randomBytes(8).toString("hex");
    this.port = opts.port ?? 4177;
    this.acceptsPrompts = opts.acceptsPrompts ?? false;
    this.store = opts.store;
    // Seed the in-memory thread from disk so past sessions show up.
    this.history = this.store?.load() ?? [];
    const here = dirname(fileURLToPath(import.meta.url));
    this.html = readFileSync(join(here, "client.html"), "utf8");
  }

  /** Register a callback for prompts typed on the phone. */
  onPrompt(handler: (text: string) => void): void {
    this.promptHandler = handler;
  }

  /** Push a line of the agent's reply (or a note) to the phone transcript. */
  log(role: "agent" | "you" | "system", text: string): void {
    this.remember(role, text);
    this.broadcast({ type: "log", role, text });
  }

  /** Append to the persistent transcript, trimming to the cap. */
  private remember(role: HistoryEntry["role"], text: string): void {
    const entry: HistoryEntry = { role, text };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    this.store?.append(entry);
  }

  /** Update the phone's status line and busy state (hides/shows composer). */
  status(text: string, busy: boolean): void {
    this.lastStatus = { text, busy };
    this.broadcast({ type: "status", text, busy });
  }

  /** URL to open on the phone (same Wi-Fi). */
  get url(): string {
    return `http://${firstLanAddress()}:${this.port}/?token=${this.token}`;
  }

  /** Start listening. Resolves once the server is up. */
  start(): Promise<void> {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost`);
      if (u.searchParams.get("token") !== this.token) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(this.html);
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const u = new URL(req.url ?? "/", `http://localhost`);
      if (u.searchParams.get("token") !== this.token) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    });

    wss.on("connection", (ws) => {
      this.clients.add(ws);
      // Tell the phone what it's allowed to do, replay the thread, then status.
      ws.send(JSON.stringify({ type: "hello", acceptsPrompts: this.acceptsPrompts }));
      ws.send(JSON.stringify({ type: "history", entries: this.history }));
      ws.send(JSON.stringify({ type: "status", ...this.lastStatus }));
      // Late-joining phone sees the in-flight decision immediately.
      if (this.pending) ws.send(JSON.stringify({ type: "decision", decision: serialize(this.pending.decision) }));
      ws.on("message", (raw) => this.onMessage(String(raw)));
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });

    this.server = server;
    this.wss = wss;
    return new Promise((resolve) => server.listen(this.port, resolve));
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  private onMessage(raw: string): void {
    let msg: { type?: string; toolUseId?: string; value?: string; text?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "prompt") {
      const text = (msg.text ?? "").trim();
      if (text && this.acceptsPrompts && this.promptHandler) {
        this.log("you", text);
        this.promptHandler(text);
      }
      return;
    }
    if (msg.type !== "answer" || !this.pending) return;
    if (msg.toolUseId !== this.pending.decision.toolUseId) return;
    const option = this.pending.decision.options.find((o) => o.value === msg.value);
    if (!option) return;
    const { decision, resolve } = this.pending;
    this.pending = null;
    this.broadcast({ type: "clear" });
    // Record what was asked and how it was answered, so it stays in the thread.
    this.log("system", answerSummary(decision, option));
    resolve(option);
  }

  present(decision: Decision, signal: AbortSignal): Promise<DecisionOption> {
    return new Promise<DecisionOption>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      this.pending = { decision, resolve };
      this.broadcast({ type: "decision", decision: serialize(decision) });
      signal.addEventListener(
        "abort",
        () => {
          if (this.pending?.decision.toolUseId === decision.toolUseId) {
            this.pending = null;
            this.broadcast({ type: "clear" });
          }
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }

  async close(): Promise<void> {
    for (const ws of this.clients) ws.close();
    this.wss?.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
