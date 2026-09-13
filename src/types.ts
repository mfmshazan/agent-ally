/**
 * Types for claude-ally, grounded in the REAL shapes observed in the MVP-0
 * spike (see docs/FINDINGS.md), not the paraphrased docs.
 */

/** The context object the Agent SDK passes as the 3rd arg to canUseTool. */
export interface CanUseToolContext {
  signal: AbortSignal;
  toolUseID: string;
}

/** What canUseTool must return. Confirmed against a live run. */
export type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/** The raw input shape for the AskUserQuestion tool. */
export interface AskUserQuestionInput {
  questions: {
    question: string;
    header: string;
    multiSelect: boolean;
    options: { label: string; description: string }[];
  }[];
}

export type RiskLevel = "low" | "medium" | "high";

/** One selectable choice, uniform across permissions and questions. */
export interface DecisionOption {
  /** Spoken + shown label, e.g. "Allow" or "red". */
  label: string;
  /** Longer spoken detail, e.g. "Choose red" or "Allow and don't ask again". */
  description?: string;
  /** The machine value this option maps back to when committed. */
  value: string;
}

/**
 * A normalized decision point — the single shape the announcer + input handler
 * operate on, regardless of whether it came from a permission prompt or a
 * multiple-choice question.
 */
export type Decision =
  | {
      kind: "permission";
      toolUseId: string;
      toolName: string;
      /** Humanized one-line summary of what Claude wants to do. */
      title: string;
      riskLevel: RiskLevel;
      /** The raw shell command, when the tool is Bash. */
      command?: string;
      options: DecisionOption[];
      raw: { toolName: string; input: Record<string, unknown> };
    }
  | {
      kind: "question";
      toolUseId: string;
      /** The question text Claude is asking. */
      title: string;
      header: string;
      multiSelect: boolean;
      options: DecisionOption[];
      raw: { toolName: string; input: Record<string, unknown> };
    };
