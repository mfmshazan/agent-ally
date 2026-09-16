# agent-ally

[![npm version](https://img.shields.io/npm/v/agent-ally)](https://www.npmjs.com/package/agent-ally)
[![npm downloads](https://img.shields.io/npm/dm/agent-ally)](https://www.npmjs.com/package/agent-ally)
[![license](https://img.shields.io/npm/l/agent-ally)](LICENSE)

**An accessibility-first control layer for AI coding agents — driven by speech,
keyboard, and your phone.**

The name is a pun: **a11y** (accessibility) + **ally** (a helper on your side).

---

## The problem

AI coding agents (like Claude Code) pause mid-task to ask the developer for
permission — *"Can I run this command?"*, *"Which option do you want?"*. In the
terminal those decisions use arrow-key widgets and streaming output that **screen
readers handle poorly**. They are also the **highest-stakes moments** in the
whole session: approving a shell command, allowing a file write, choosing between
options. Skipping or guessing them is not safe.

agent-ally solves this by wrapping the agent's decision loop in a fully
accessible experience — every decision is **announced**, **navigated by
keyboard**, and **confirmed aloud** before anything commits. You can also approve
decisions from your **phone over Wi-Fi**, so you are never tied to the terminal.

---

## Demo

https://github.com/user-attachments/assets/82c9d17d-67ac-467d-8b08-21d61fe1774f

---

## What it does

| Feature | Description |
|---------|-------------|
| 🔊 **Spoken decisions** | Every permission prompt and multiple-choice question is read aloud the instant it appears — earcon, then full text, then your options as a numbered list. |
| 🔢 **Keyboard navigation** | Arrow keys / number keys move between options; each move is spoken. Enter commits (high-risk needs a second Enter). `R` replays the whole decision. `D` reads the full shell command. |
| ✅ **Spoken confirmation** | The committed choice is spoken aloud before the agent continues. High-risk actions require an explicit second press. |
| 📱 **Phone control** | Scan a QR code at launch, then send prompts and approve decisions from a web page on your phone — over your local Wi-Fi network. No app to install. |
| 📎 **File & photo uploads** | Tap the attach button on the phone page to send screenshots or files. They are saved into your project so Claude can view images and read or edit files with its normal tools. |
| 💬 **Multiple chats** | Each project keeps a conversation list like an IDE agent panel. Relaunch and continue any past chat; start a new thread whenever you want. |
| 🗂️ **Cross-device history** | The transcript replays on the phone (grouped by day with timestamps) and prints to the terminal with `--history`. Move between phone and laptop without losing the thread. |
| 🔁 **Session resume** | Reopening a chat resumes the same Claude session — yesterday's plan is still in context, not just in the transcript. |

---

## How it works

```
You  ──► agent-ally ──► Claude Code (AI agent)
              │                │
         speaks &         pauses on
         navigates        every decision
         decisions   ◄────────┘
              │
         Phone (Wi-Fi) ◄──► same decisions, from anywhere
```

agent-ally sits between you and the AI agent. When the agent needs a decision
it calls agent-ally, which announces it on all your active surfaces (terminal
voice + phone) and waits for your answer. The first surface to receive an answer
wins; the others are silenced.

The **Claude Code adapter** (via the Claude Agent SDK's `canUseTool` hook) is
the flagship integration. The engine itself is agent-agnostic — other agents can
plug in through the same adapter interface.

---

## Setup (new machine)

Follow these steps once on any machine where you want to use agent-ally.

### Step 1 — Install Node.js 18+

Download from [nodejs.org](https://nodejs.org) and install. Verify:

```bash
node --version   # should print v18.x or higher
```

### Step 2 — Install and authenticate Claude Code

agent-ally drives Claude through the Claude Agent SDK, so **Claude Code must be
installed and signed in with your own Anthropic account** on that machine.

```bash
npm install -g @anthropic-ai/claude-code
claude          # follow the login prompt to authenticate
claude --version  # verify it works
```

> Claude Code requires an [Anthropic account](https://claude.ai) with an active
> subscription or API access. agent-ally reuses that auth — there is no
> separate API key to configure.

### Step 3 — Install agent-ally

```bash
npm install -g agent-ally
```

That's it. The `agent-ally` command is now available globally in every terminal
session on that machine. No cloning, no building — npm handles everything.

### Step 4 — Use it in any project

```bash
cd ~/my-project           # go to YOUR project (any folder on your machine)
agent-ally                # start an interactive session with phone QR
agent-ally "add a README" # or run a single prompt and exit
```

agent-ally runs Claude inside **your** project's directory. It reads and writes
your files, never the agent-ally folder itself.

---

## Quick start (if already set up)

```bash
cd ~/my-project

agent-ally                # interactive session — phone QR printed automatically
agent-ally "your prompt"  # one-shot prompt, then exit
agent-ally --no-phone     # voice + keyboard only, no QR
```

---

## All commands

### Starting a session

```bash
agent-ally                          # interactive session, phone QR printed by default
agent-ally "your prompt here"       # one-shot: run a single prompt and exit
agent-ally --no-phone               # interactive, no phone surface (voice + keyboard only)
agent-ally --profile phone          # phone is everything — no terminal input needed
agent-ally --profile phone --voice  # phone-driven, but also speak decisions aloud
agent-ally --silent                 # no audio; prints [SPEAK] lines instead (useful for CI/debug)
agent-ally --https                  # serve the phone over HTTPS so its mic (voice input) works
agent-ally --port 5000              # use a custom port for the phone server (default: random)
```

### Managing chats

Each project keeps **multiple independent chats** — like the conversation list
in VS Code's Copilot or Cursor. Every chat has its own Claude session and its
own transcript.

```bash
agent-ally                  # reopen and continue the last-used chat for this project
agent-ally --new            # start a brand-new chat (auto-named after the first prompt)
agent-ally --list           # list all past chats for this project (numbered), then exit
agent-ally --resume 2       # reopen chat number 2 from the list
agent-ally --resume <id>    # reopen a chat by its full id
```

**Inside a running session** you can type these at the `you>` prompt:

```
chats              # print the chat list for this project
switch 2           # jump to chat number 2 live — no need to exit and relaunch
switch <id>        # jump by full chat id
history            # print this chat's full transcript inline
exit               # end the session (also: quit, or Ctrl+D, or Ctrl+C)
```

### Reviewing history

```bash
agent-ally --history        # print the current chat's full transcript, then exit
```

On the phone the full conversation replays automatically when you connect,
grouped by day (Today / Yesterday / date) with a timestamp on each message.
Scroll up to review what was planned before sending the next prompt.

---

## Phone control

Phone control is **on by default**. Every time you launch agent-ally a QR code
is printed in the terminal. Scan it with your phone (same Wi-Fi network) and
you get a web page where you can:

- **Send prompts** — type what you want the agent to do and tap Send.
- **Approve or deny** — every permission request appears on the phone at the
  same time as the terminal announcement; tap to answer from either surface.
- **Attach files or photos** — tap the 📎 button to pick files from your phone.
  They are saved into the project folder so Claude can read images and edit files
  directly.
- **Hear replies aloud** — tap 🔊 in the header to have decisions and the agent's
  replies spoken on the phone (uses the phone's built-in voice).

```bash
agent-ally                # phone on (default) — QR printed on every launch
agent-ally --no-phone     # opt out for a pure laptop/voice session
```

### Talk to it from your phone (voice input)

To **speak** your prompts on the phone (not just type), the page must be served
over HTTPS — browsers only allow microphone access on a secure connection. Add
the `--https` flag:

```bash
agent-ally --https        # serve the phone over HTTPS so its mic works
```

Then, on the phone:

1. Scan the QR — it now points to `https://…`.
2. Chrome shows a one-time **"Your connection is not private"** warning (the
   certificate is self-signed). Tap **Advanced → Proceed** to accept it. This
   happens once per phone.
3. A 🎤 mic button appears in the message bar. Tap it, speak, and it transcribes
   and sends automatically.

Without `--https`, the phone still types, taps approvals, uploads files, and can
speak replies (🔊) — only the voice **input** (mic) needs the secure connection.

> ⚠️ The phone link lets any device on your local network approve the agent's
> actions. Use it only on a trusted network (home, personal hotspot).

---

## Profiles

Different users need different surfaces. A profile sets the defaults:

| Profile | Best for | Speech | Keyboard | Phone |
|---------|----------|:------:|:--------:|:-----:|
| `voice` *(default)* | Blind / low-vision dev at the laptop | ✅ | ✅ | QR by default |
| `full` | Voice at the laptop **and** full phone answers | ✅ | ✅ | ✅ |
| `phone` | Laptop unattended — phone drives everything | — | — | ✅ |

```bash
agent-ally                          # voice profile (speech + keyboard + phone QR)
agent-ally --no-phone               # voice profile, no phone
agent-ally --profile full           # voice + full phone prompts and answers
agent-ally --profile phone          # phone-only — no terminal input
agent-ally --profile phone --voice  # phone-only, but also speak decisions aloud
agent-ally --profile voice --silent # keyboard only, no audio
```

---

## Keyboard shortcuts (during a decision)

These work while agent-ally is waiting for your answer at a permission or
question prompt:

| Key | Action |
|-----|--------|
| `↑` / `↓` or `k` / `j` | Move between options (each spoken immediately) |
| `1` – `9` | Jump directly to that option (1-based) |
| `R` | Repeat the full decision — earcon + text + options + hint |
| `D` | Read the full shell command (permission prompts only) |
| `Enter` | Commit the highlighted option |
| `Enter` *(second press)* | Confirm a high-risk action after the first press |
| `Ctrl+C` | Cancel — safely denies the current decision |

---

## How decisions are announced

When the AI agent needs a decision, this is what you hear:

1. **Earcon** — two tones that signal "the agent is blocked on you".
2. **Intro** — `"Permission needed. <what the agent wants to do>. <risk level>."`
   or `"Claude is asking. <question>."` for multiple-choice questions.
3. **Options** — `"Options: 1, Allow. 2, Deny. 3, Allow all edits."` (all in
   one breath — no gaps between items).
4. **Hint** — `"Use the arrow keys or number keys to choose, then press enter.
   Press R to repeat. Press D to hear the full command."`
5. **Selection** — as soon as you move, the new option is spoken:
   `"2 of 3, Deny."`
6. **Confirmation** — when you commit: `"Allow selected."` High-risk choices ask
   `"Confirm Allow? Press enter again to confirm."` before committing.

---

## Data & privacy

- **Transcripts** are stored locally under `~/.agent-ally/projects/` — one
  folder per project, one file per chat. Nothing is sent to a remote server by
  agent-ally itself.
- **Claude's API calls** go through the Claude Agent SDK and Anthropic's servers,
  exactly as they would with Claude Code directly. agent-ally adds no additional
  network calls.
- **The phone server** is local-only (LAN). The access token is generated fresh
  each launch and is only valid on your local network.

---

## Project structure

```
src/
  adapters/      # Agent adapters (claude.ts is the flagship)
  announcer/     # Text-to-speech + earcons (tts.ts, announcer.ts, earcons.ts)
  channels/      # Decision surfaces (terminal.ts, phone.ts, client.html)
  config/        # Profiles and surface resolution (profile.ts)
  history/       # Transcript, session, multi-chat store, Claude session reader
  input/         # Keyboard navigation state machine (selector.ts, keyboard.ts)
  interceptor/   # SDK decision normalisation (toDecision.ts, answer.ts)
  policy/        # Risk classification (risk.ts)
  coordinator.ts # Races channels; first answer wins
  permissionHandler.ts  # canUseTool wiring
  cli.ts         # Entry point — argument parsing, surface setup, interactive loop
test/            # Node assert tests (no tokens; fixture-driven)
docs/
  FINDINGS.md    # Spike notes: how canUseTool interception was validated
```

---

## Contributing & feedback

This is accessibility software. **Real-world feedback from screen-reader users
is the most valuable contribution.** If a decision does not read well, an earcon
is unclear, a keyboard shortcut is surprising, or the phone flow trips up your
assistive technology — please open an issue.

Bug reports and pull requests are welcome. Run `npm test` before submitting.

If you find agent-ally useful, consider commenting on
[Claude Code issue #11002](https://github.com/anthropics/claude-code/issues/11002)
— the open request for a native `--screen-reader` mode in Claude Code. Linking
your experience there helps make the case to Anthropic.

---

## Related work

- **[BlindPilot](https://github.com/serrebidev/BlindPilot)** — screen-reader-first
  desktop frontend for coding agents (native wxPython). Its approach is to bypass
  permission prompts entirely (YOLO mode). agent-ally takes the opposite approach:
  make the permission step itself accessible without skipping it.
- **[Claude Code issue #11002](https://github.com/anthropics/claude-code/issues/11002)**
  — open request for a native `--screen-reader` flag in Claude Code.
- **[Screen Reader Programmers in the Vibe Coding Era (arXiv 2506.13270)](https://arxiv.org/abs/2506.13270)**
  — academic survey of how blind developers adapt to AI coding tools.

---

## License

MIT
