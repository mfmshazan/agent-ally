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

export interface PhoneChannelOptions {
  port?: number;
  token?: string;
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

  private server?: http.Server;
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private pending: Pending | null = null;
  private readonly html: string;

  constructor(opts: PhoneChannelOptions = {}) {
    this.token = opts.token ?? randomBytes(8).toString("hex");
    this.port = opts.port ?? 4177;
    const here = dirname(fileURLToPath(import.meta.url));
    this.html = readFileSync(join(here, "client.html"), "utf8");
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
    let msg: { type?: string; toolUseId?: string; value?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "answer" || !this.pending) return;
    if (msg.toolUseId !== this.pending.decision.toolUseId) return;
    const option = this.pending.decision.options.find((o) => o.value === msg.value);
    if (!option) return;
    const { resolve } = this.pending;
    this.pending = null;
    this.broadcast({ type: "clear" });
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
