/** Tests for the AskUserQuestion answer-builder (v0.3). */

import assert from "node:assert/strict";
import { buildAnswerInput } from "../src/interceptor/answer.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("builds answers array using the question's header + chosen label", () => {
  const input = {
    questions: [
      {
        question: "Which color?",
        header: "Color",
        multiSelect: false,
        options: [{ label: "Red" }, { label: "Blue" }],
      },
    ],
  };
  const out = buildAnswerInput(input, "Blue");
  assert.deepEqual((out as { answers: unknown }).answers, [{ header: "Color", label: "Blue" }]);
  // original input is preserved (spread), not mutated
  assert.ok("questions" in out);
});

test("falls back to 'Choice' header when missing", () => {
  const out = buildAnswerInput({ questions: [] }, "X");
  assert.deepEqual((out as { answers: unknown }).answers, [{ header: "Choice", label: "X" }]);
});

console.log(`\n${passed} passed`);
