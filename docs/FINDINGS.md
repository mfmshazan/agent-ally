# MVP-0 Spike — Findings (GATE: ✅ GO)

Ran `npm run spike` against Claude Code 2.0.77 / Agent SDK. Real observed shapes
(source: `src/spike/observations.log`).

## 1. `canUseTool` is called with POSITIONAL args

```ts
canUseTool(
  toolName: string,                       // e.g. "Bash", "AskUserQuestion"
  input: Record<string, unknown>,         // the tool's input object
  ctx: { signal: AbortSignal; toolUseID: string },
): Promise<PermissionResult>
```

The docs' `{ toolName, toolUse }` request object is **wrong** — it's three
positional arguments.

## 2. Return contract (confirmed)

```ts
type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };
```

Returning `{ behavior: "deny", message }` produced a `tool_result` with
`is_error: true` and a `permission_denials` entry in the final result.

⚠️ **Allow must echo the input.** Returning a bare `{ behavior: "allow" }` runs
the approved tool with **no arguments** — file edits/writes fail as if "the
system is blocking file modifications." Always return
`{ behavior: "allow", updatedInput: input }` (the original input, unchanged).

## 3. ⭐ Questions arrive through `canUseTool`, not `onElicitation`

`AskUserQuestion` is a normal tool (it's in the session `tools` list). When
Claude asks a question, `canUseTool` fires with:

```ts
toolName === "AskUserQuestion"
input === {
  questions: [{
    question: string,
    header: string,
    multiSelect: boolean,
    options: { label: string, description: string }[],
  }]
}
```

`onElicitation` was **never invoked**. => Both decision types share ONE entry
point; branch on `toolName`.

## 4. Incidental observations

- Safe commands (`echo`) are auto-approved and **never reach `canUseTool`** — only
  actions that need a decision do. Good: we intercept exactly the blocking moments.
- The run billed ~$0.14 (default model `claude-sonnet-4-5`, plus haiku subtasks).
  **Tests must replay recorded fixtures — never hit the live SDK.**
- `signal` is an `AbortSignal` (not JSON-serializable); `toolUseID` is the
  `toolu_...` id, needed to correlate with the stream.

## v0.3 — Answering AskUserQuestion (RESOLVED)

Second mini-spike (`npm run spike:q`) confirmed the answer mechanism:

```ts
// Select option(s) by returning allow with an `answers` array in updatedInput:
return {
  behavior: "allow",
  updatedInput: {
    ...input,
    answers: [{ header: question.header, label: chosenLabel }],
  },
};
```

The SDK converted this into a `tool_result` and Claude responded "I see you
chose **Red**." — i.e. the selection registered. Notes:

- The structured `answers` array is the real payload; the SDK's human-readable
  summary string showed a cosmetic `"[object Object]"` but Claude read `answers`
  correctly.
- Each answer is `{ header, label }`. Use the question's own `header` and the
  chosen option's `label`.
- Verified for **single-select** (`multiSelect: false`). Multi-select answer
  shape is still TODO (probably a label array or multiple entries).
