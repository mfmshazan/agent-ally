/**
 * MVP-0 spike — the go/no-go probe for agent-ally.
 *
 * Goal: discover the EXACT runtime shapes the Claude Agent SDK hands us at the
 * two decision points agent-ally will own:
 *   1. permission requests  -> `canUseTool` callback
 *   2. multiple-choice questions / elicitation -> `onElicitation` callback
 *
 * We do NOT trust the docs for the precise field names (they're paraphrased and
 * version-drifty). Instead we dump whatever actually arrives, then DENY/cancel
 * everything so the probe is non-destructive — nothing Claude proposes is run.
 *
 * Run:  npm run spike
 * Needs: Claude Code auth already set up on this machine (the SDK reuses it).
 *
 * Everything observed is printed to the console AND appended to
 * src/spike/observations.log so we can read the shapes back afterward.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The SDK is loaded dynamically so the probe still starts (and logs a clear
// message) even if `npm install` hasn't been run yet.
const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "observations.log");

function record(label: string, payload: unknown): void {
  // `getCircularReplacer` guards against the SDK handing us objects with cycles.
  const seen = new WeakSet();
  const body = JSON.stringify(
    payload,
    (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      if (typeof value === "function") return `[Function ${value.name || "anon"}]`;
      return value;
    },
    2,
  );
  const line = `\n===== ${label} @ ${new Date().toISOString()} =====\n${body}\n`;
  process.stdout.write(line);
  appendFileSync(LOG, line);
}

async function main(): Promise<void> {
  writeFileSync(LOG, `agent-ally spike run @ ${new Date().toISOString()}\n`);

  let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (err) {
    record("IMPORT_FAILED — run `npm install` first", {
      message: (err as Error).message,
    });
    return;
  }

  const abort = new AbortController();
  const killer = setTimeout(() => abort.abort(), 90_000);

  // A prompt engineered to force BOTH decision points:
  //  - the shell command triggers a Bash permission request (-> canUseTool)
  //  - the explicit "ask me" nudges an AskUserQuestion-style prompt (-> onElicitation)
  const prompt =
    "First, run the shell command `echo agent-ally-probe`. " +
    "Then ask me to choose between two options: 'red' or 'blue'. " +
    "Do not do anything else.";

  const options: Record<string, unknown> = {
    permissionMode: "default",
    maxTurns: 3,
    abortController: abort,

    // DECISION POINT 1 — permission requests.
    canUseTool: async (...args: unknown[]) => {
      record("canUseTool CALLED — raw args", args);
      // Return the historically-correct Agent SDK deny shape. If the SDK rejects
      // this shape, the error it throws tells us the real one — that's a result,
      // not a failure.
      return { behavior: "deny", message: "probe: denying to stay non-destructive" };
    },

    // DECISION POINT 2 — multiple-choice / elicitation prompts.
    onElicitation: async (...args: unknown[]) => {
      record("onElicitation CALLED — raw args", args);
      return { action: "cancel" };
    },
  };

  record("QUERY OPTIONS (keys only)", Object.keys(options));

  try {
    for await (const message of query({ prompt, options } as never)) {
      const m = message as Record<string, unknown>;
      // Dump the type up front (cheap to scan) then the whole message.
      record(`STREAM MESSAGE type=${String(m.type)} subtype=${String(m.subtype)}`, message);
    }
    record("STREAM ENDED", "query() iterator completed normally");
  } catch (err) {
    record("QUERY THREW", {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    });
  } finally {
    clearTimeout(killer);
  }

  record("DONE", `Full log written to ${LOG}`);
}

void main();
