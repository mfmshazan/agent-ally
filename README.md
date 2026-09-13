# claude-ally

**An accessibility-first control layer for Claude Code's CLI.**

Claude Code narrates _what it did_ reasonably well for screen-reader users (thanks to
community tools like `claude-sonar` and `claude-a11y`). What's still missing is the
**interactive decision loop** — the blocking, high-stakes moments where Claude asks:

- _"Can I run this shell command?"_ (permission prompts)
- _"Which of these options do you want?"_ (multiple-choice questions)

These are arrow-key terminal widgets that screen readers handle poorly. `claude-ally`
makes those decision points fully **screen-reader drivable**:

- 🔊 **Announced** the instant they appear
- 🔢 **Options read out** as a linear, numbered list
- ➡️ **Current selection spoken** on every keystroke
- ✅ **Choice confirmed aloud** before it commits (extra confirm for risky actions)
- 🔔 **Distinct earcons** for _blocking_ (needs you) vs _committed_ vs _failure_

## Why this exists

Based on a real feature request from a blind accessibility architect
([anthropics/claude-code#70425](https://github.com/anthropics/claude-code/issues/70425)).
Existing tools solve **output narration** (one-way). `claude-ally` owns the
**interactive control loop** — the part that lets a blind developer _drive_ the agent,
not just hear it.

## Status

🚧 Early development. **v0.3 shipped.** Both decision types are driven by speech
+ keyboard through the Agent SDK's `canUseTool` callback:

- **Permission prompts** — announce → navigate → spoken confirm (high-risk needs
  two presses) → allow/deny.
- **Multiple-choice questions** (`AskUserQuestion`) — announce → navigate →
  select → the choice is returned to Claude as the answer.

Both mechanisms were validated by spikes first (see [docs/FINDINGS.md](docs/FINDINGS.md)).
**Next:** config (voice/rate/verbosity), multi-select questions, and recruiting
the GitHub-issue author as a test user.

### Run it

```bash
npm install
npm start -- "create a file hello.txt that says hi"   # triggers a permission prompt
npm start -- --silent "…"                              # no audio; prints [SPEAK] lines
npm test                                               # 20 tests, no tokens
```

Requires Claude Code auth on this machine (the SDK reuses it).

## Planned architecture

`claude-ally` runs Claude Code as an **engine subprocess** (via the Agent SDK /
`stream-json`) and renders its decision points for speech + keyboard, instead of
scraping the terminal UI.

```
REPL (your prompt) → Claude engine (canUseTool) → Decision Interceptor
     → Announcer (TTS + earcons) ↔ Input Handler (accessible keyboard nav)
```

| Component | Job |
|-----------|-----|
| Engine adapter | Drives Claude Code via the SDK; registers the permission callback |
| Decision Interceptor | Normalizes permission/question events into a uniform shape |
| Announcer | Speaks decisions, humanizes identifiers, plays earcons |
| Input Handler | Accessible keyboard navigation + spoken selection |
| Policy / Safety | Risk classification; fail-safe deny on ambiguity |

## License

MIT
