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
- 🎛️ **Profiles** pick your control surface: speech + keyboard, speech + phone,
  or **phone-only** (send prompts *and* approve actions from the phone)

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
agent-ally "your prompt"       # one turn
agent-ally                     # interactive session (+ phone QR by default)
agent-ally --no-phone          # laptop/voice only, no phone
```

**Phone control is on by default** — the QR prints on every launch (including
`--new` and `--resume`), so you can always scan and drive from your phone. Pass
`--no-phone` for a pure laptop/voice session.

## Profiles — different users, different needs

Not everyone needs the same surfaces. Pick a profile:

| Profile | Who it's for | Speech | Keyboard | Phone |
|---------|--------------|:------:|:--------:|:-----:|
| `voice` *(default)* | Blind/low-vision dev at the laptop | ✅ | ✅ | on by default |
| `full` | Voice at the laptop **and** phone | ✅ | ✅ | **prompts + answers** |
| `phone` | Laptop unattended — the phone is everything | — | — | **prompts + answers** |

```bash
agent-ally                          # voice + keyboard + phone QR (default)
agent-ally --no-phone               # voice + keyboard only
agent-ally --profile phone          # drive it entirely from your phone
agent-ally --profile phone --voice  # phone-driven, but also speak aloud
```

A prompt can come from **either** the keyboard or the phone — whichever you use
first drives the next turn; the other surface stays ready.

The phone page shows a text box: type what you want the agent to do, hit
**Send**, then approve or answer right there. Tap **📎 Attach** to send
screenshots or files: they're saved into the project so Claude can view images
and read/edit the files with its normal tools.

Requires Claude Code auth on this machine (the adapter reuses it).

> ⚠️ The phone link lets any device on your network approve the agent's actions.
> Use it only on a trusted network.

## Picks up where you left off

Each project keeps **multiple chats** — like the conversation list in an IDE
agent. Relaunching `agent-ally` reopens the current chat and **continues the same
conversation** — yesterday's plan is still in context, not just in the phone
transcript. Start another thread, list them, or switch between them:

```bash
agent-ally               # reopen and continue the last-used session
agent-ally --new         # start a brand-new chat for this project
agent-ally --list        # list this project's past sessions (numbered), then exit
agent-ally --resume 2    # reopen session #2 from the list (or by its id)
```

A new chat is auto-named after its first prompt. Inside a session you can type
`chats` to see the list, `switch <number>` to jump to another session live (no
exit/relaunch needed), or `history` to review the current chat's transcript.

`--list` shows **one unified list of past sessions** for this project — your
agent-ally chats *and* sessions you started in the Claude extension or CLI,
merged newest-first with the last-used one marked. Reopening any of them with
`--resume <number>` (or `switch <number>`) continues right where it left off;
extension/CLI sessions are adopted as agent-ally chats on first reopen.

Each chat has its own Claude session and its own transcript, stored per-project
under `~/.agent-ally/projects/`.

### Reading back the history

You move between phone and laptop, so the transcript is reachable from both:

- **On the phone** — the full conversation replays on connect, grouped by day
  (Today / Yesterday / date) with a time on each message. Scroll back to review
  what was planned before sending the next prompt.
- **On the laptop** — print the same transcript to the terminal (clean text your
  screen reader can read straight through), then exit:

  ```bash
  agent-ally --history
  ```

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
