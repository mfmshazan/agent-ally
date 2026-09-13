# MVP-0 Spike — the go/no-go gate

Before building anything real, we must confirm **how the Claude Agent SDK hands
us the two decision points** agent-ally intends to own. If these don't arrive as
structured callbacks, the whole "structured, not scraped" architecture changes.

## What the probe checks

| Decision point | SDK entry point (hypothesis) | What we need to confirm |
|----------------|------------------------------|--------------------------|
| Permission requests ("can I run this command?") | `canUseTool` callback | Exact request shape + exact `PermissionResult` return shape |
| Multiple-choice questions | `onElicitation` callback | That questions arrive **structurally** (not only as terminal UI) |

The docs are paraphrased and version-drifty, so the probe **dumps the real
runtime shapes** instead of trusting them. It then **denies/cancels everything**,
so nothing Claude proposes is actually executed — the probe is non-destructive.

## Run it

```bash
npm install
npm run spike
```

Requires Claude Code auth to already be set up on this machine (the SDK reuses it).

Everything observed is printed to the console and appended to
`src/spike/observations.log` (gitignored).

## Go / no-go

- ✅ **Go** — if `canUseTool` fires with a structured request *and* questions
  arrive structurally (via `onElicitation` or a stream message). Proceed to v0.1.
- ⚠️ **Partial** — if permissions are structured but questions are not: build
  v0.1 for permissions only; handle questions via a hooks fallback later.
- ❌ **No-go** — if neither arrives structurally: revisit the architecture
  (PTY interception) before writing more code.
