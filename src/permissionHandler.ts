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
import { isEditTool } from "./policy/risk.js";

export interface HandlerDeps {
  /** Presents a decision on all channels and resolves to the chosen option. */
  present: PresentFn;
  /** Called when a decision is auto-approved without prompting (for the log). */
  onAutoApprove?: (decision: ReturnType<typeof toDecision>) => void;
}

/**
 * Build a `canUseTool` handler. State (the "allow all edits" opt-in) lives in
 * this closure, so it lasts exactly one turn — a fresh handler is created per
 * run, and the opt-in resets automatically on the next prompt.
 */
export function createCanUseTool(deps: HandlerDeps) {
  let autoApproveEdits = false;

  const allow = (input: Record<string, unknown>): PermissionResult => ({
    behavior: "allow",
    // Echo the original input back on allow. The SDK runs the approved tool
    // with `updatedInput`; omitting it makes edits/writes run with no arguments
    // and fail ("the system is blocking file modifications").
    updatedInput: input,
  });

  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    ctx: CanUseToolContext,
  ): Promise<PermissionResult> {
    const decision = toDecision(toolName, input, ctx);

    // Already opted in to auto-approving edits this turn — don't ask again.
    if (decision.kind === "permission" && autoApproveEdits && isEditTool(toolName)) {
      deps.onAutoApprove?.(decision);
      return allow(input);
    }

    try {
      const chosen = await deps.present(decision);

      if (decision.kind === "question") {
        return {
          behavior: "allow",
          updatedInput: buildAnswerInput(decision.raw.input, chosen.label),
        };
      }
      if (chosen.value === "allow_all_edits") {
        autoApproveEdits = true; // remember for the rest of this turn
        return allow(decision.raw.input);
      }
      if (chosen.value === "allow") return allow(decision.raw.input);
      return { behavior: "deny", message: "Denied by the user via agent-ally." };
    } catch {
      // Ctrl+C, all channels failed, or any presentation error -> fail safe.
      return { behavior: "deny", message: "Cancelled via agent-ally." };
    }
  };
}
