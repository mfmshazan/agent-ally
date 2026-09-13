/**
 * The wiring: a `canUseTool`-compatible handler that turns a raw SDK decision
 * into a committed result.
 *
 *   - permission prompts  -> { allow } / { deny }            (v0.1)
 *   - AskUserQuestion     -> { allow, updatedInput.answers } (v0.3)
 *
 * Presentation is delegated to a `present` function (the coordinator), so the
 * handler doesn't care whether the answer came from the terminal or the phone.
 */

import type { CanUseToolContext, PermissionResult } from "./types.js";
import type { PresentFn } from "./coordinator.js";
import { toDecision } from "./interceptor/toDecision.js";
import { buildAnswerInput } from "./interceptor/answer.js";

export interface HandlerDeps {
  /** Presents a decision on all channels and resolves to the chosen option. */
  present: PresentFn;
}

export function createCanUseTool(deps: HandlerDeps) {
  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    ctx: CanUseToolContext,
  ): Promise<PermissionResult> {
    const decision = toDecision(toolName, input, ctx);

    try {
      const chosen = await deps.present(decision);

      if (decision.kind === "question") {
        return {
          behavior: "allow",
          updatedInput: buildAnswerInput(decision.raw.input, chosen.label),
        };
      }
      if (chosen.value === "allow") return { behavior: "allow" };
      return { behavior: "deny", message: "Denied by the user via claude-ally." };
    } catch {
      // Ctrl+C, all channels failed, or any presentation error -> fail safe.
      return { behavior: "deny", message: "Cancelled via claude-ally." };
    }
  };
}
