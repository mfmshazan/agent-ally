/**
 * v0.3 mini-spike — how do we ANSWER an AskUserQuestion?
 *
 * MVP-0 proved questions arrive via canUseTool; denying them produced an error
 * tool_result. This probe tests the next hypothesis: what does returning
 * `{ behavior: "allow" }` (optionally with updatedInput carrying a chosen
 * option) actually do? Does the SDK then:
 *   (a) expect us to supply the answer somewhere,
 *   (b) auto-produce a tool_result, or
 *   (c) error / hang?
 *
 * We allow everything, pick the FIRST option for any question via updatedInput,
 * and dump the entire subsequent stream so we can see whether Claude registers
 * the choice (e.g. says "you chose red"). Non-destructive: the only tool we
 * expect is the harmless echo plus the question itself.
 *
 * Run:  npm run spike:q
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "observations-q.log");

function record(label: string, payload: unknown): void {
  const seen = new WeakSet();
  const body = JSON.stringify(
    payload,
    (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (typeof v === "function") return `[Function ${v.name || "anon"}]`;
      return v;
    },
    2,
  );
  const line = `\n===== ${label} @ ${new Date().toISOString()} =====\n${body}\n`;
  process.stdout.write(line);
  appendFileSync(LOG, line);
}

async function main(): Promise<void> {
  writeFileSync(LOG, `agent-ally question-answer spike @ ${new Date().toISOString()}\n`);

  let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (err) {
    record("IMPORT_FAILED — run `npm install` first", { message: (err as Error).message });
    return;
  }

  const abort = new AbortController();
  const killer = setTimeout(() => abort.abort(), 90_000);

  const prompt =
    "Ask me to choose between two options: 'red' or 'blue'. " +
    "After I choose, tell me exactly which one I chose, then stop.";

  const options: Record<string, unknown> = {
    permissionMode: "default",
    maxTurns: 5,
    abortController: abort,

    canUseTool: async (toolName: string, input: Record<string, unknown>, ctx: unknown) => {
      record(`canUseTool toolName=${toolName}`, { input, ctx });

      if (toolName === "AskUserQuestion") {
        // HYPOTHESIS: selecting an option = allow with updatedInput carrying the
        // chosen label(s). We try the common shapes Claude Code uses. If the SDK
        // rejects or ignores this, the stream afterward tells us the truth.
        const q = (input as { questions?: Array<{ options?: Array<{ label: string }> }> })
          .questions?.[0];
        const firstLabel = q?.options?.[0]?.label ?? "red";
        const updatedInput = {
          ...input,
          // Several candidate answer encodings — we'll see which (if any) sticks:
          _selectedLabel: firstLabel,
          questions: (input as { questions?: unknown[] }).questions,
          answers: [{ header: "Choice", label: firstLabel }],
        };
        record("ANSWER ATTEMPT via allow+updatedInput", { firstLabel, updatedInput });
        return { behavior: "allow", updatedInput };
      }

      // Allow everything else so we actually reach the question.
      return { behavior: "allow" };
    },
  };

  try {
    for await (const message of query({ prompt, options } as never)) {
      const m = message as Record<string, unknown>;
      record(`STREAM type=${String(m.type)} subtype=${String(m.subtype)}`, message);
    }
    record("STREAM ENDED", "ok");
  } catch (err) {
    record("QUERY THREW", { name: (err as Error).name, message: (err as Error).message });
  } finally {
    clearTimeout(killer);
  }

  record("DONE", `Full log at ${LOG}`);
}

void main();
