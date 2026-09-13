/**
 * Tests for the Decision Interceptor, replaying the REAL fixtures captured by
 * the MVP-0 spike (see docs/FINDINGS.md). No tokens, no live SDK.
 *
 * Run:  npm test
 */

import assert from "node:assert/strict";
import { toDecision } from "../src/interceptor/toDecision.js";
import { humanizeToolName } from "../src/interceptor/humanize.js";

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

// --- Fixture 1: the real Bash call from the spike -------------------------
test("Bash echo -> medium-risk permission decision", () => {
  const d = toDecision(
    "Bash",
    { command: "echo agent-ally-probe", description: "Echo agent-ally-probe" },
    { toolUseID: "toolu_01Tduna3QZyi26dSMcEtBYH1" },
  );
  assert.equal(d.kind, "permission");
  if (d.kind !== "permission") return;
  assert.equal(d.toolUseId, "toolu_01Tduna3QZyi26dSMcEtBYH1");
  assert.equal(d.riskLevel, "medium");
  assert.equal(d.command, "echo agent-ally-probe");
  assert.match(d.title, /run a shell command/);
  assert.deepEqual(
    d.options.map((o) => o.value),
    ["allow", "deny"],
  );
});

// --- Fixture 2: the real AskUserQuestion call from the spike ---------------
test("AskUserQuestion -> question decision with options", () => {
  const d = toDecision(
    "AskUserQuestion",
    {
      questions: [
        {
          question: "Which option do you choose?",
          header: "Choice",
          multiSelect: false,
          options: [
            { label: "red", description: "Choose red" },
            { label: "blue", description: "Choose blue" },
          ],
        },
      ],
    },
    { toolUseID: "toolu_01RcSExrrmq9sqLFPAZgKhTu" },
  );
  assert.equal(d.kind, "question");
  if (d.kind !== "question") return;
  assert.equal(d.title, "Which option do you choose?");
  assert.equal(d.header, "Choice");
  assert.equal(d.multiSelect, false);
  assert.deepEqual(
    d.options.map((o) => o.value),
    ["red", "blue"],
  );
});

// --- Risk classification ---------------------------------------------------
test("rm -rf is classified high risk", () => {
  const d = toDecision("Bash", { command: "rm -rf build/" }, { toolUseID: "x" });
  assert.equal(d.kind === "permission" && d.riskLevel, "high");
});

test("git force push is high risk", () => {
  const d = toDecision("Bash", { command: "git push --force origin main" }, { toolUseID: "x" });
  assert.equal(d.kind === "permission" && d.riskLevel, "high");
});

test("Read is low risk", () => {
  const d = toDecision("Read", { file_path: "/tmp/x" }, { toolUseID: "x" });
  assert.equal(d.kind === "permission" && d.riskLevel, "low");
});

// --- Humanizer -------------------------------------------------------------
test("mcp tool names become readable", () => {
  assert.equal(humanizeToolName("mcp__abc123__getJiraIssue"), "external tool: get jira issue");
});

console.log(`\n${passed} passed`);
