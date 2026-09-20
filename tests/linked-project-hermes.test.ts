import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "lib/workflow/linked-project-hermes.ts"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(process.cwd(), "app/api/operative/tasks/[id]/execute/route.ts"),
  "utf8",
);
const createRoute = fs.readFileSync(
  path.join(process.cwd(), "app/api/operative/tasks/route.ts"),
  "utf8",
);

test("linked-project Hermes uses prepared cloud runtime and short-lived OIDC", () => {
  assert.match(source, /cooperative-hermes-runtime-v2026-9-14/);
  assert.match(source, /getVercelOidcToken/);
  assert.match(source, /AI_GATEWAY_API_KEY: oidcToken/);
  assert.match(source, /HERMES_MAX_ITERATIONS: String\(MAX_TURNS\)/);
  assert.match(source, /Sandbox\.fork/);
  assert.match(source, /alibaba\/qwen3\.5-flash/);
});

test("linked-project Hermes is file-only and cannot directly deploy or push", () => {
  assert.match(source, /"--toolsets",[\s\S]*?"file"/);
  assert.match(source, /Do not commit, push, open a pull request, or deploy/);
  assert.match(source, /repositoryWritePerformed: false/);
  assert.match(source, /productionChangePerformed: false/);
  assert.match(source, /secretAccessPerformed: false/);
  assert.equal(source.includes('"--yolo"'), false);
  assert.equal(source.includes('"terminal"'), false);
  assert.equal(source.includes('"browser"'), false);
});

test("linked-project Hermes preserves usage, cost and deterministic verification", () => {
  assert.match(source, /--usage-file/);
  assert.match(source, /resolveModelCost/);
  assert.match(source, /actual_spend_microunits: evidence\.costMicrounits/);
  assert.match(source, /cost_ledger_entries/);
  assert.match(source, /git",\s*args: \["diff", "--check"\]/);
  assert.match(source, /projectPlaybook\.buildCommands\(\)/);
  assert.match(source, /verificationSucceeded/);
});

test("linked-project Hermes returns a bounded reviewable patch and blocks secret paths", () => {
  assert.match(source, /MAX_PATCH_BYTES = 160_000/);
  assert.match(source, /git",\s*args: \["diff", "--binary", "--no-ext-diff"\]/);
  assert.match(source, /patchTouchesBlockedPath/);
  assert.match(source, /\.vercel/);
  assert.match(source, /\.env/);
  assert.equal(source.includes('"--max-turns"'), false);
  assert.equal(source.includes('"--run-budget"'), false);
  assert.equal(source.includes('"--checkpoints"'), false);
  assert.equal(source.includes('"--source"'), false);
  assert.match(source, /const HERMES_COMMAND_TIMEOUT_SECONDS = 540/);
  assert.match(source, /"timeout " \+\s*HERMES_COMMAND_TIMEOUT_SECONDS \+\s*'s "\$HERMES_BIN" '/);
  assert.match(source, /new TextEncoder\(\)\.encode\(value\)\.byteLength/);
  assert.equal(source.includes("Buffer.byteLength"), false);
  assert.match(source, /export TERMINAL_CWD=/);
  assert.match(source, /Repository root: /);
  assert.match(source, /Prefer absolute paths under/);
});

test("task dispatcher sends project-scoped workflow requests to linked Hermes", () => {
  assert.match(route, /linkedProjectHermesWorkflow/);
  assert.match(route, /playbook\.projectKey/);
  assert.match(route, /request: task\.description \|\| task\.title/);
  assert.match(route, /maxSpendMicrounits/);
  assert.match(route, /compatibilityReview/);
  assert.match(route, /MODEL_SPEND_CAP_REQUIRED/);
});


test("failed Hermes execution still preserves metered evidence before final status", () => {
  assert.match(source, /hermesExitCode/);
  assert.match(source, /hermesError/);
  assert.match(source, /Usage\/cost evidence and any partial patch were preserved/);
  assert.match(source, /amount_microunits: evidence\.costMicrounits/);
});


test("linked-project Hermes finalization records verifying state and avoids duplicate cost rows on replay", () => {
  assert.match(source, /status: "verifying"/);
  assert.match(source, /from_status: "executing"/);
  assert.match(source, /to_status: "verifying"/);
  assert.match(source, /select\("id,executor,cost_category"\)/);
  assert.match(source, /existingKeys\.has\("hermes-cloud-operative:ai-tokens"\)/);
  assert.match(source, /existingKeys\.has\("vercel-sandbox:sandbox-compute"\)/);
});

test("linked-project Hermes patch tasks cannot succeed with an empty patch", () => {
  assert.match(source, /sourceChangesProduced = evidence\.changedFiles\.length > 0/);
  assert.match(source, /Hermes completed without producing source changes/);
  assert.match(source, /evidence\.changedFiles\.length > 0/);
});


test("paid linked-project Hermes reasoning never auto-retries", () => {
  assert.match(source, /import \{ FatalError, sleep \} from "workflow"/);
  assert.match(source, /startLinkedProjectHermesDetached\.maxRetries = 0/);
  assert.match(source, /new FatalError/);
  assert.match(source, /do not blind-retry/i);
});

test("timeout-style linked Hermes failures include structured recovery advice", () => {
  assert.match(source, /failureAdviceFor/);
  assert.match(source, /Split this request before another paid run/);
  assert.match(source, /retrySafety: "do-not-blind-retry"/);
  assert.match(source, /costStatus: "unresolved"/);
  assert.match(source, /failureAdvice/);
});


test("timeout recovery preserves the exact failure and provides a bounded executable phase", () => {
  assert.match(source, /executablePrompt\?: string/);
  assert.match(source, /firstRecoveryPhasePrompt/);
  assert.match(source, /Implement only Phase 1/);
  assert.match(source, /const terminalMessage = timedOut/);
  assert.match(source, /throw new FatalError\(terminalMessage\)/);
  assert.match(source, /existingPreciseError/);
  assert.match(source, /effectiveMessage/);
});


test("bounded linked-project coding patches the pinned oneshot path so four iterations are real", () => {
  assert.match(source, /const MAX_TURNS = 4/);
  assert.match(source, /const MAX_EXPECTED_API_CALLS = MAX_TURNS \+ 1/);
  assert.match(source, /HERMES_MAX_ITERATIONS: String\(MAX_TURNS\)/);
  assert.match(source, /hermes_cli\.oneshot/);
  assert.match(source, /max_iterations=max\(1, int\(os\.getenv\("HERMES_MAX_ITERATIONS", "4"\)\)\),/);
  assert.match(source, /py_compile\.compile/);
  assert.match(source, /hermes_iteration_guard_verified/);
  assert.match(source, /No paid model call was started/);
  assert.match(source, /iterationGuardRespected/);
  assert.match(source, /apiCalls > 0 && apiCalls <= MAX_EXPECTED_API_CALLS/);
  assert.match(source, /const HERMES_COMMAND_TIMEOUT_SECONDS = 540/);
  assert.match(source, /timeout: 12 \* 60 \* 1000/);
  assert.match(source, /deadlineAt: startedAt \+ 11 \* 60 \* 1000/);
});

test("an already-bounded Phase 1 timeout recommends fixing the worker instead of splitting forever", () => {
  assert.match(source, /const alreadyBounded/);
  assert.match(source, /Fix the Hermes worker before another paid run/);
  assert.match(source, /Do not split the Phase 1 request again/);
  assert.match(source, /retrySafety: "safe-after-fix"/);
});


test("long Hermes reasoning is detached and polled through durable workflow sleeps", () => {
  assert.match(source, /import \{ FatalError, sleep \} from "workflow"/);
  assert.match(source, /startLinkedProjectHermesDetached/);
  assert.match(source, /detached: true/);
  assert.match(source, /await sleep\("10s"\)/);
  assert.match(source, /pollLinkedProjectHermesDetached/);
  assert.match(source, /collectLinkedProjectHermesPatch/);
  assert.match(source, /runLinkedProjectVerificationStep/);
  assert.match(source, /executionMode: "detached-sandbox-process"/);
  assert.equal(source.includes("const hermes = await sandbox.runCommand"), false);
});

test("paid detached Hermes launch cannot auto-retry", () => {
  assert.match(source, /startLinkedProjectHermesDetached\.maxRetries = 0/);
});


test("diff-check failure preserves patch, usage and exact deterministic evidence", () => {
  assert.match(source, /const stdoutText = await result\.stdout\(\)/);
  assert.match(source, /const stderrText = await result\.stderr\(\)/);
  assert.match(source, /runDiffCheck\("git diff --check"\)/);
  assert.match(source, /diffCheckSucceeded/);
  assert.match(source, /verificationSteps: VerificationStep\[\] = \[\.\.\.patchEvidence\.diffCheckSteps\]/);
  assert.match(source, /patch and usage\/cost evidence were preserved/);
  assert.match(source, /collectLinkedProjectHermesPatch\.maxRetries = 0/);
  assert.equal(source.includes("Hermes produced a patch that failed git diff --check:"), false);
});


test("known git diff whitespace failures are repaired deterministically before any AI escalation", () => {
  assert.match(source, /parseSafeDiffWhitespaceIssues/);
  assert.match(source, /trailing whitespace\\\./);
  assert.match(source, /new blank line at EOF\\\./);
  assert.match(source, /CoOperative deterministic whitespace repair/);
  assert.match(source, /git diff --check · after deterministic repair/);
  assert.match(source, /deterministicRepairs/);
  assert.match(source, /repairableIssues\.length > 0/);
  assert.equal(source.includes("space before tab in indent."), false);
});

test("verification failure keeps structured repair advice instead of collapsing to a generic failure", () => {
  assert.match(source, /const failureAdvice =/);
  assert.match(source, /Patch preserved — targeted Hermes repair available/);
  assert.match(source, /failureAdviceFor\(finalError, input\.request\)/);
  assert.match(source, /\.\.\.\(failureAdvice \? \{ failureAdvice \} : \{\}\)/);
});


test("targeted Hermes repair reapplies preserved patch before any model reasoning", () => {
  assert.match(source, /repairSourceTaskId\?: string \| null/);
  assert.match(source, /TARGETED REPAIR MODE/);
  assert.match(source, /sandbox\.fs\.writeFile/);
  assert.match(source, /args: \["apply", "--binary", "--whitespace=nowarn", repairPatchPath\]/);
  assert.match(source, /No model call was made/);
  assert.match(source, /targeted_repair_patch_seeded/);
  assert.match(source, /repairSourceTaskId: input\.taskId/);
  assert.match(source, /Patch preserved — targeted Hermes repair available/);
});

test("targeted repair task lineage is validated and passed through dispatcher", () => {
  assert.match(createRoute, /repairSourceTaskId/);
  assert.match(createRoute, /REPAIR_SOURCE_INVALID/);
  assert.match(createRoute, /same linked-project playbook with a preserved patch/);
  assert.match(route, /repairSourceTaskId/);
  assert.match(route, /repairSourceTaskId,/);
});


test("targeted repair re-checks the preserved patch against the original owner exclusions", () => {
  assert.match(source, /\.select\("id,status,playbook_key,description,result"\)/);
  assert.match(source, /ORIGINAL OWNER REQUEST AND EXCLUSIONS/);
  assert.match(source, /Remove any out-of-scope changes that violate its explicit exclusions/);
});


test("git status path parsing preserves the first character of changed source paths", () => {
  assert.match(source, /\.filter\(\(line\) => line\.trim\(\)\.length > 0\)/);
  assert.match(source, /\.map\(\(line\) => line\.slice\(3\)\.trim\(\)\)/);
  assert.equal(source.includes(".map((line) => line.trim())\n    .filter(Boolean)\n    .map((line) => line.slice(3)"), false);
});


test("Hermes iteration shim runs in the Hermes-installed Python environment before any spend", () => {
  assert.match(source, /HERMES_REAL=.*readlink -f/);
  assert.match(source, /HERMES_PY=.*dirname/);
  assert.match(source, /IFS= read -r SHEBANG/);
  assert.match(source, /persistPreModelFailure/);
  assert.match(source, /actual_spend_microunits: 0/);
  assert.match(source, /paidModelCallStarted: false/);
  assert.equal(source.includes('cmd: "python",\n    args: ["-c", iterationGuardScript]'), false);
});


test("Hermes guard shell invokes the resolved interpreter with the guard script as python -c input", () => {
  assert.match(source, /exec "\$HERMES_PY" -c "\$1"/);
  assert.match(source, /exec "\$HERMES_PY" -c "\$1" "\$2"/);
  assert.equal(source.includes('exec "$HERMES_PY" "$@"'), false);
});


test("Hermes guard shell preserves multiline if/case syntax instead of semicolon-joining blocks", () => {
  assert.match(source, /\]\.join\("\\n"\)/);
  assert.match(source, /hermesPythonShell \+ '\\nexec "\$HERMES_PY" -c "\$1"'/);
  assert.match(source, /hermesPythonShell \+ '\\nexec "\$HERMES_PY" -c "\$1" "\$2"'/);
  assert.equal(source.includes('].join("; ");'), false);
});
