import assert from "node:assert";
import { resolveSurfaces } from "../src/config/profile.js";

// Default (voice) — speech + keyboard, no phone.
{
  const s = resolveSurfaces("voice");
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

// Legacy --phone adds the phone channel on top of the voice profile.
{
  const s = resolveSurfaces("voice", { phone: true });
  assert.equal(s.phone, true);
  assert.equal(s.terminal, true);
}

// Default profile is voice when none supplied.
{
  const s = resolveSurfaces();
  assert.equal(s.terminal, true);
  assert.equal(s.phone, false);
}

console.log("profile.test: ok");
