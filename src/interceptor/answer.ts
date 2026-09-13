/**
 * Build the `updatedInput` that answers an AskUserQuestion, in the exact shape
 * the v0.3 mini-spike confirmed the SDK accepts (see docs/FINDINGS.md):
 *
 *   { behavior: "allow", updatedInput: { ...input, answers: [{ header, label }] } }
 *
 * Verified for single-select. Multi-select is a later refinement.
 */

import type { AskUserQuestionInput } from "../types.js";

export function buildAnswerInput(
  rawInput: Record<string, unknown>,
  chosenLabel: string,
): Record<string, unknown> {
  const input = rawInput as unknown as AskUserQuestionInput;
  const header = input.questions?.[0]?.header ?? "Choice";
  return {
    ...rawInput,
    answers: [{ header, label: chosenLabel }],
  };
}
