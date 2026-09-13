# agent-ally

**An accessibility-first control layer for AI coding agents — driven by speech,
keyboard, and your phone.**

The name is a pun: **a11y** (accessibility) + **ally** (a helper on your side).

AI coding agents pause to ask the developer things — *"Can I run this command?"*,
*"Which option do you want?"* — and in the terminal those are arrow-key widgets
that screen readers handle poorly. They're also the **highest-stakes** moments
(approving a shell command, a file write). agent-ally makes those **decision
points** fully drivable without sight:

- 🔊 **Announced** the instant they appear (text-to-speech + distinct earcons)
- 🔢 **Options read out** as a numbered list; **current selection spoken** on every move
- ✅ **Confirmed aloud** before committing (high-risk actions need a second press)
- 🔁 **Press `R` to repeat** anything you missed
- 📱 **Answerable from your phone** over your Wi-Fi (accessible web page), or the
  laptop — whichever responds first wins; the work stays on the laptop

## Why "agent" not "claude"

The accessibility engine (speech, keyboard, phone) is **agent-agnostic** — it
just needs a decision to present. Only the *interception* is agent-specific, so
agent-ally is built around a pluggable **adapter** seam:

```
Adapter (per agent)              Accessibility engine (universal)
  └─ Claude Code (flagship) ──►  announce · navigate · phone · answer
     (future: other open agents, or a generic terminal wrapper)
```

Today the **Claude Code adapter** (via the Agent SDK's `canUseTool`) is the solid,
validated one. Other agents can plug in as they expose a decision hook.

## Status

🚧 Early development.

- **v0.1** — permission prompts fully driven by speech + keyboard.
- **v0.3** — multiple-choice questions (`AskUserQuestion`) answered, not just announced.
- **v0.4** — answer decisions from your phone (LAN, token-secured).
- **Now** — installable command + adapter seam (Claude is the first adapter).

Both interception mechanisms were validated by spikes first — see
[docs/FINDINGS.md](docs/FINDINGS.md).

## Run it

```bash
npm install
npm start -- "create a file hello.txt that says hi"     # terminal only
npm start -- --phone "ask me to pick cat or dog"        # + phone (scan the QR)
npm test                                                 # no tokens (replays fixtures)
```

Install as a command you can run in **any project**:

```bash
npm run build && npm link     # then, from any project folder:
agent-ally --phone "your prompt"
```

Requires Claude Code auth on this machine (the adapter reuses it).

> ⚠️ `--phone` lets any device with the printed link approve the agent's actions.
> Use it only on a trusted network.

## Keys

| Key | Action |
|-----|--------|
| ↑ / ↓ (or `j`/`k`) | Move between options (each spoken) |
| `1`–`9` | Jump to an option |
| `R` | Repeat the whole decision |
| `D` | Read the full shell command |
| Enter | Select (high-risk needs a 2nd Enter) |
| Ctrl+C | Cancel → denies safely |

## License

MIT
