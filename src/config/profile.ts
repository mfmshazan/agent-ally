/**
 * Profiles map "who is using this and how" to a concrete set of control
 * surfaces. Different users need different things:
 *
 *   - voice  — blind/low-vision dev at the laptop: speech + keyboard. (default)
 *   - full   — voice + keyboard at the laptop AND a phone that can both send
 *              prompts and answer decisions; whichever surface acts first wins.
 *   - phone  — the laptop is unattended; the phone is the WHOLE control surface:
 *              it sends the prompts AND approves permissions. No speech, no
 *              terminal keyboard. (This is the "just use my phone" experience.)
 *
 * The rest of the app never sees profile names — only the resolved `Surfaces`.
 */

export type ProfileName = "voice" | "full" | "phone";

export interface Surfaces {
  /** Speak announcements and replies via TTS. */
  voice: boolean;
  /** Terminal is an input surface: keyboard decision nav + typed prompts. */
  terminal: boolean;
  /** Phone is connected as a decision channel. */
  phone: boolean;
  /** Phone may also submit the prompts that drive the agent. */
  phonePrompts: boolean;
}

export interface CliOverrides {
  /** `--phone`: add a fully usable phone (prompts + answers) to any profile. */
  phone?: boolean;
  /** `--no-phone`: turn the phone off for a pure laptop/voice session. */
  noPhone?: boolean;
  /** `--silent`: force voice off. */
  silent?: boolean;
  /** `--voice`: force voice on (e.g. voice + phone-driven prompts). */
  voice?: boolean;
}

const BASE: Record<ProfileName, Surfaces> = {
  voice: { voice: true, terminal: true, phone: false, phonePrompts: false },
  full: { voice: true, terminal: true, phone: true, phonePrompts: true },
  phone: { voice: false, terminal: false, phone: true, phonePrompts: true },
};

export const DEFAULT_PROFILE: ProfileName = "voice";

export function isProfileName(v: string): v is ProfileName {
  return v === "voice" || v === "full" || v === "phone";
}

/**
 * Resolve a profile (plus explicit CLI overrides) into the surfaces to wire up.
 * Overrides win over the profile's defaults. Guarantees at least one input
 * surface exists (if neither terminal nor phone would be active, phone is
 * enabled — otherwise the agent could never be prompted).
 *
 * Phone control is ON by default so the QR is always available to scan; pass
 * `--no-phone` for a pure laptop/voice session.
 */
export function resolveSurfaces(
  profile: ProfileName = DEFAULT_PROFILE,
  overrides: CliOverrides = {},
): Surfaces {
  const s: Surfaces = { ...BASE[profile] };
  if (overrides.silent) s.voice = false;
  if (overrides.voice) s.voice = true;
  // Phone is a fully usable surface (prompts + answers) unless explicitly off.
  // (--phone stays accepted as an explicit on, but it's the default now.)
  if (overrides.noPhone) {
    s.phone = false;
    s.phonePrompts = false;
  } else {
    s.phone = true;
    s.phonePrompts = true;
  }
  // Never end up with no way to drive the agent.
  if (!s.terminal && !s.phone) {
    s.phone = true;
    s.phonePrompts = true;
  }
  return s;
}
