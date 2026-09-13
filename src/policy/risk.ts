/**
 * Risk classification for a decision. Drives verbosity and whether we require
 * an extra spoken confirmation before committing. The high-risk shell patterns
 * mirror the list Claude Code's own auto-mode treats as dangerous.
 */

import type { RiskLevel } from "../types.js";

const DANGEROUS_SHELL = [
  /\brm\s+-[rf]/, // rm -rf / rm -f
  /\bgit\s+push\b.*(--force|-f)\b/, // force push
  /\bgit\s+reset\s+--hard/,
  /\bcurl\b[^|]*\|\s*(sh|bash)/, // curl | bash
  /\bwget\b[^|]*\|\s*(sh|bash)/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R/,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
  /\b(shutdown|reboot|halt)\b/,
  /\btruncate\b/,
  /\bterraform\s+destroy/,
  />\s*\/dev\/sd[a-z]/, // writing to a raw disk
];

/** Classify a shell command string. */
export function classifyCommand(command: string): RiskLevel {
  const cmd = command.toLowerCase();
  if (DANGEROUS_SHELL.some((re) => re.test(cmd))) return "high";
  return "medium"; // any shell execution is at least medium
}

/** Classify a permission decision by tool + input. */
export function classifyTool(toolName: string, input: Record<string, unknown>): RiskLevel {
  switch (toolName) {
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : "";
      return classifyCommand(command);
    }
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return "medium";
    case "Read":
    case "Glob":
    case "Grep":
    case "WebFetch":
    case "WebSearch":
      return "low";
    default:
      // Unknown tools are treated cautiously — fail safe.
      return "medium";
  }
}
