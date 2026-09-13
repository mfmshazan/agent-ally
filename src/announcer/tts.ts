/**
 * Text-to-speech — a thin, pluggable seam over the OS's built-in speech engine.
 *
 * v0.1 ships a working Windows implementation (SAPI via PowerShell's
 * System.Speech) because that's the maintainer's platform; macOS (`say`) and
 * Linux (`spd-say`/`espeak-ng`) are wired the same way. A ConsoleSpeaker is used
 * in tests / headless runs so nothing tries to make noise in CI.
 *
 * Utterances are awaited, so callers get natural sequencing: speak one thing,
 * await it, speak the next — announcements never overlap. Each `speak` also
 * takes an optional AbortSignal; aborting kills the underlying speech process
 * immediately, so a newer utterance (e.g. after the user answers on their phone)
 * can barge in instead of playing over the top of the old one.
 */

import { spawn } from "node:child_process";

export interface Speaker {
  /**
   * Speak `text` and resolve when the utterance finishes, is aborted, or is
   * skipped. Never rejects. If `signal` aborts, stop speaking promptly.
   */
  speak(text: string, signal?: AbortSignal): Promise<void>;
}

export interface SpeakerOptions {
  /** Relative speaking rate. Maps per-engine; 0 is normal. */
  rate?: number;
}

/**
 * Run a command, feed `text` on stdin, resolve on clean exit. Never rejects.
 * If `signal` aborts, the child is killed so speech stops promptly.
 */
function runWithStdin(
  command: string,
  args: string[],
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve();
      return;
    }
    const onAbort = (): void => {
      try {
        child?.kill();
      } catch {
        /* already gone */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    child.on("error", done);
    child.on("close", done);
    child.stdin.on("error", () => {
      /* EPIPE when killed mid-write — ignore */
    });
    child.stdin.end(text);
  });
}

/** Windows SAPI via PowerShell. Text is passed on stdin to avoid quoting hell. */
class WindowsSpeaker implements Speaker {
  constructor(private readonly rate: number) {}
  speak(text: string, signal?: AbortSignal): Promise<void> {
    const script =
      "Add-Type -AssemblyName System.Speech;" +
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      `$s.Rate = ${Math.max(-10, Math.min(10, this.rate))};` +
      "$s.Speak([Console]::In.ReadToEnd());";
    return runWithStdin(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      text,
      signal,
    );
  }
}

/** macOS `say`. Reads the utterance from stdin via /dev/stdin. */
class MacSpeaker implements Speaker {
  constructor(private readonly rate: number) {}
  speak(text: string, signal?: AbortSignal): Promise<void> {
    // say rate is words-per-minute; map 0 -> 180, each step ~ 15 wpm.
    const wpm = Math.max(90, 180 + this.rate * 15);
    return runWithStdin("say", ["-r", String(wpm), "-f", "/dev/stdin"], text, signal);
  }
}

/** Linux speech-dispatcher (`spd-say`), falling back to `espeak-ng`. */
class LinuxSpeaker implements Speaker {
  constructor(private readonly rate: number) {}
  speak(text: string, signal?: AbortSignal): Promise<void> {
    // spd-say -r takes -100..100; -e waits for the utterance to finish.
    const rate = Math.max(-100, Math.min(100, this.rate * 10));
    return runWithStdin("spd-say", ["-w", "-r", String(rate), "-e"], text, signal);
  }
}

/** No audio — prints what would be spoken. Used in tests and headless runs. */
export class ConsoleSpeaker implements Speaker {
  async speak(text: string, _signal?: AbortSignal): Promise<void> {
    console.log(`[SPEAK] ${text}`);
  }
}

/**
 * Pick a speaker for the current platform. Pass `{ silent: true }` (tests/CI)
 * to force the ConsoleSpeaker.
 */
export function createSpeaker(
  opts: SpeakerOptions & { silent?: boolean } = {},
): Speaker {
  if (opts.silent) return new ConsoleSpeaker();
  const rate = opts.rate ?? 0;
  switch (process.platform) {
    case "win32":
      return new WindowsSpeaker(rate);
    case "darwin":
      return new MacSpeaker(rate);
    case "linux":
      return new LinuxSpeaker(rate);
    default:
      return new ConsoleSpeaker();
  }
}
