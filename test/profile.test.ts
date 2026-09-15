import assert from "node:assert";
import { resolveSurfaces } from "../src/config/profile.js";

// Default (voice) — speech + keyboard, and phone control is on by default so the
// QR is always available.
{
  const s = resolveSurfaces("voice");
  assert.deepEqual(s, { voice: true, terminal: true, phone: true, phonePrompts: true });
}

// --no-phone opts out for a pure laptop/voice session.
{
  const s = resolveSurfaces("voice", { noPhone: true });
  assert.deepEqual(s, { voice: true, terminal: true, phone: false, phonePrompts: false });
}

// full — voice + keyboard, and the phone can both prompt and answer.
{
  const s = resolveSurfaces("full");
  assert.equal(s.voice, true);
  assert.equal(s.terminal, true);
  assert.equal(s.phone, true);
  assert.equal(s.phonePrompts, true);
}

// phone — phone is the whole surface: no voice, no terminal, phone drives prompts.
{
  const s = resolveSurfaces("phone");
  assert.deepEqual(s, { voice: false, terminal: false, phone: true, phonePrompts: true });
}

// --voice override turns speech back on for the phone profile.
{
  const s = resolveSurfaces("phone", { voice: true });
  assert.equal(s.voice, true);
  assert.equal(s.phonePrompts, true);
}

// --silent override forces voice off even on a voice profile.
{
  const s = resolveSurfaces("voice", { silent: true });
  assert.equal(s.voice, false);
  assert.equal(s.terminal, true);
}

// --phone adds a fully usable phone (prompts + answers) on top of voice.
{
  const s = resolveSurfaces("voice", { phone: true });
  assert.equal(s.phone, true);
  assert.equal(s.terminal, true);
  assert.equal(s.phonePrompts, true); // the phone gets an input field
}

// Default profile is voice when none supplied (phone on by default).
{
  const s = resolveSurfaces();
  assert.equal(s.terminal, true);
  assert.equal(s.phone, true);
}

console.log("profile.test: ok");
