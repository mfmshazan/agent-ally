/**
 * Decision Interceptor — the heart of agent-ally.
 *
 * Normalizes the raw positional args the Agent SDK hands `canUseTool` into a
 * single uniform `Decision` shape the announcer + input handler operate on.
 * Pure and synchronous: no I/O, no speech, trivially unit-testable against the
 * recorded spike fixtures.
 */

import type {
  AskUserQuestionInput,
  CanUseToolContext,
  Decision,
  DecisionOption,
} from "../types.js";
import { humanizeToolName, summarizeCommand } from "./humanize.js";
import { classifyTool } from "../policy/risk.js";

/** Standard allow / deny options offered for a permission prompt. */
function permissionOptions(): DecisionOption[] {
  return [
    { label: "Allow", description: "Allow this action", value: "allow" },
    { label: "Deny", description: "Deny this action", value: "deny" },
  ];
}

function asAskUserQuestion(input: Record<string, unknown>): AskUserQuestionInput | null {
  const questions = (input as unknown as AskUserQuestionInput).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  return input as unknown as AskUserQuestionInput;
}

export function toDecision(
  toolName: string,
  input: Record<string, unknown>,
  ctx: Pick<CanUseToolContext, "toolUseID">,
): Decision {
  const toolUseId = ctx.toolUseID;
  const raw = { toolName, input };

  if (toolName === "AskUserQuestion") {
    const parsed = asAskUserQuestion(input);
    // Spike showed one question per call in practice; we take the first and
    // surface its choices. (Multi-question batches are a later refinement.)
    const q = parsed?.questions[0];
    const options: DecisionOption[] = (q?.options ?? []).map((o) => ({
      label: o.label,
      description: o.description,
      value: o.label,
    }));
    return {
      kind: "question",
      toolUseId,
      title: q?.question ?? "Claude is asking a question",
      header: q?.header ?? "Question",
      multiSelect: q?.multiSelect ?? false,
      options,
      raw,
    };
  }

  // Everything else is a permission prompt.
  const command = typeof input.command === "string" ? (input.command as string) : undefined;
  const action = humanizeToolName(toolName);
  const title = command
    ? `Claude wants to ${action}: ${summarizeCommand(command)}`
    : `Claude wants to ${action}`;

  return {
    kind: "permission",
    toolUseId,
    toolName,
    title,
    riskLevel: classifyTool(toolName, input),
    command,
    options: permissionOptions(),
    raw,
  };
}
