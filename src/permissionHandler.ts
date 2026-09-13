/**
 * The wiring: a `canUseTool`-compatible handler that turns a raw SDK decision
 * into the accessible loop — normalize -> announce -> navigate -> commit ->
 * return the result.
 *
 *   - permission prompts  -> { allow } / { deny }          (v0.1)
 *   - AskUserQuestion     -> { allow, updatedInput.answers } (v0.3)
 *
 * Both decision types arrive through this one callback (proven by the MVP-0
 * spike) and are answered the way the v0.3 spike confirmed (see docs/FINDINGS.md).
 */

import type { CanUseToolContext, Decision, DecisionOption, PermissionResult } from "./types.js";
import type { Announcer } from "./announcer/announcer.js";
import { toDecision } from "./interceptor/toDecision.js";
import { buildAnswerInput } from "./interceptor/answer.js";
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
    await deps.announcer.announce(decision);

    try {
      if (decision.kind === "question") {
        // Answer by navigating to a choice and returning it as updatedInput.answers.
        const chosen = await prompt(decision, { requireConfirm: false });
        return { behavior: "allow", updatedInput: buildAnswerInput(decision.raw.input, chosen.label) };
      }

      // Permission prompt: allow/deny, with a second confirm on high-risk.
      const requireConfirm = decision.riskLevel === "high";
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
