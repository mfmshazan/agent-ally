/**
 * Earcons — short non-speech audio cues for decision lifecycle events, so a
 * screen-reader user can tell *by ear* that the agent is blocked on them vs.
 * that a choice committed vs. that something failed, without parsing words.
 *
 * Pluggable like the Speaker. v0.1 implements Windows (console beeps via
 * PowerShell); other platforms fall back to Silent for now (speech still
 * carries the meaning). Never throws, never blocks meaningfully.
 */

import { spawn } from "node:child_process";

export type EarconKind = "blocking" | "committed" | "failure";

export interface Earcon {
  play(kind: EarconKind): Promise<void>;
}

function runSilent(command: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: "ignore" });
    } catch {
      resolve();
      return;
    }
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

/** Distinct beep patterns per event on Windows via [console]::beep. */
class WindowsEarcon implements Earcon {
  private static readonly PATTERNS: Record<EarconKind, string> = {
    // rising two-tone = "your turn, blocked on you"
    blocking: "[console]::beep(880,120);[console]::beep(1320,160)",
    // single bright tone = "committed"
    committed: "[console]::beep(1320,120)",
    // low tone = "failure"
    failure: "[console]::beep(200,320)",
  };
  play(kind: EarconKind): Promise<void> {
    return runSilent("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WindowsEarcon.PATTERNS[kind],
    ]);
  }
}

/** No audio — used on unsupported platforms, tests, and headless runs. */
export class SilentEarcon implements Earcon {
  async play(): Promise<void> {
    /* speech carries the meaning */
  }
}

export function createEarcon(opts: { silent?: boolean } = {}): Earcon {
  if (opts.silent) return new SilentEarcon();
  if (process.platform === "win32") return new WindowsEarcon();
  return new SilentEarcon();
}
