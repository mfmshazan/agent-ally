/**
 * Turn machine-shaped identifiers into something that reads correctly aloud.
 * Straight from a real pain point in anthropics/claude-code#70425: raw tool
 * names like `mcp__<uuid>__getJiraIssue` are unintelligible through a screen
 * reader.
 */

/** "getJiraIssue" / "get_jira_issue" -> "get jira issue" */
export function splitIdentifier(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/[_-]+/g, " ") // snake_case / kebab-case
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Humanize a tool name for speech.
 *   "Bash"                      -> "run a shell command"
 *   "AskUserQuestion"           -> "ask a question"
 *   "mcp__abc123__getJiraIssue" -> "external tool: get jira issue"
 *   "Edit"                      -> "edit a file"
 */
export function humanizeToolName(toolName: string): string {
  const mcp = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcp) return `external tool: ${splitIdentifier(mcp[1])}`;

  switch (toolName) {
    case "Bash":
      return "run a shell command";
    case "Read":
      return "read a file";
    case "Write":
      return "write a file";
    case "Edit":
      return "edit a file";
    case "Glob":
      return "search for files";
    case "Grep":
      return "search file contents";
    case "WebFetch":
      return "fetch a web page";
    case "WebSearch":
      return "search the web";
    case "AskUserQuestion":
      return "ask a question";
    default:
      return splitIdentifier(toolName);
  }
}

/**
 * Summarize a shell command for speech: short commands are read verbatim;
 * long / piped ones are described by step count so we don't read 200 chars of
 * flags aloud (the user can ask for "details" to hear the full command).
 */
export function summarizeCommand(command: string): string {
  const trimmed = command.trim();
  const steps = trimmed.split(/\s*(?:\||&&|;)\s*/).filter(Boolean);
  if (trimmed.length <= 60 && steps.length === 1) return trimmed;
  if (steps.length > 1) {
    return `a shell command with ${steps.length} steps; say "details" to hear the full command`;
  }
  return `a shell command; say "details" to hear the full command`;
}
