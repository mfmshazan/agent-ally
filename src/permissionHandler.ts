/**
 * The wiring: a `canUseTool`-compatible handler that turns a raw SDK decision
 * into the accessible loop — normalize -> announce -> navigate -> commit ->
 * return {allow|deny}.
 *
 * Scope for v0.1: permission prompts are fully handled. Multiple-choice
 * questions (AskUserQuestion) are announced but not yet answerable — returning
 * the selected answer through canUseTool is the open question deferred to v0.3
 * (see docs/FINDINGS.md), so for now we deny them with a clear spoken reason
 * rather than guess and commit the wrong thing.
 */

import type { CanUseToolContext, Decision, DecisionOption, PermissionResult } from "./types.js";
import type { Announcer } from "./announcer/announcer.js";
import { toDecision } from "./interceptor/toDecision.js";
import { promptDecision } from "./input/keyboard.js";

/** Drives one decision to a committed option. Injectable so tests skip the TTY. */
export type PromptFn = (
  decision: Decision,
  opts: { requireConfirm: boolean },
) => Promise<DecisionOption>;

export interface HandlerDeps {
  announcer: Announcer;
  /** Defaults to the real terminal prompt; tests inject a fake. */
  prompt?: PromptFn;
}

const QUESTION_DEFERRED =
  "claude-ally does not yet answer multiple-choice questions. Denying for now.";

export function createCanUseTool(deps: HandlerDeps) {
  const prompt: PromptFn =
    deps.prompt ??
    ((decision, opts) =>
      promptDecision(decision, { announcer: deps.announcer, requireConfirm: opts.requireConfirm }));

  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    ctx: CanUseToolContext,
  ): Promise<PermissionResult> {
    const decision = toDecision(toolName, input, ctx);

    // v0.1: questions are announced but not answerable yet.
    if (decision.kind === "question") {
      await deps.announcer.announce(decision);
      await deps.announcer.failure(QUESTION_DEFERRED);
      return { behavior: "deny", message: QUESTION_DEFERRED };
    }

    const requireConfirm = decision.riskLevel === "high";
    await deps.announcer.announce(decision);

    try {
      const chosen = await prompt(decision, { requireConfirm });
      if (chosen.value === "allow") return { behavior: "allow" };
      return { behavior: "deny", message: "Denied by the user via claude-ally." };
    } catch {
      // Ctrl+C or any prompt failure -> fail safe (deny).
      await deps.announcer.failure("Cancelled. Denying to stay safe.");
      return { behavior: "deny", message: "Cancelled via claude-ally." };
    }
  };
}
