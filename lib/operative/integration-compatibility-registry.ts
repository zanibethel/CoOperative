export type CompatibilityTarget =
  | "cooperative-executor-contract"
  | "supabase"
  | "vercel-workflow"
  | "vercel-sandbox"
  | "vercel-ai-gateway"
  | "hermes-agent";

export interface CompatibilityRule {
  id: string;
  targets: readonly CompatibilityTarget[];
  component: string;
  appliesTo: string;
  symptom: string;
  rootCause: string;
  knownGoodPattern: string;
  avoidPatterns: readonly string[];
  enforcementPaths: readonly string[];
  learnedAt: string;
  status: "active";
}

/**
 * Durable, version-aware integration knowledge.
 *
 * These entries are lessons CoOperative has already paid to learn. New
 * playbooks must review the relevant rules before deterministic code, shell,
 * or AI execution is allowed to start.
 */
export const INTEGRATION_COMPATIBILITY_RULES: readonly CompatibilityRule[] = [
  {
    id: "executor-canonical-hermes-name",
    targets: ["cooperative-executor-contract"],
    component: "CoOperative executor contract",
    appliesTo: "Cloud Operative schema/runtime contract as of 2026-09-18",
    symptom: "Executor selection fails before Hermes starts.",
    rootCause: "Application code used cloud-hermes while the canonical database value is hermes-cloud-operative.",
    knownGoodPattern: "Use hermes-cloud-operative everywhere application code, events, and cost ledger refer to the Cloud Hermes executor.",
    avoidPatterns: ["cloud-hermes"],
    enforcementPaths: [
      "lib/operative/playbook-registry.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "workflow-oidc-use-helper",
    targets: ["vercel-workflow", "vercel-ai-gateway"],
    component: "Vercel Workflow OIDC",
    appliesTo: "@vercel/oidc 3.2.0 + Vercel Workflow",
    symptom: "Workflow step cannot obtain Vercel OIDC identity.",
    rootCause: "Workflow steps did not expose process.env.VERCEL_OIDC_TOKEN as expected.",
    knownGoodPattern: "Call getVercelOidcToken() inside the Workflow step and pass the short-lived token only into the disposable Sandbox as AI_GATEWAY_API_KEY.",
    avoidPatterns: [
      "process.env.VERCEL_OIDC_TOKEN",
      "long-lived provider API key for the governed Hermes route",
    ],
    enforcementPaths: [
      "lib/workflow/hermes-model-smoke.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "sandbox-shell-statements-must-be-separated",
    targets: ["vercel-sandbox", "hermes-agent"],
    component: "Vercel Sandbox shell invocation",
    appliesTo: "Prepared Hermes runtime cooperative-hermes-runtime-v2026-9-14",
    symptom: "timeout reports an empty/missing executable even though Hermes is installed.",
    rootCause: "Shell setup fragments were concatenated with spaces instead of executable statement separators.",
    knownGoodPattern: "Tokenize Hermes argv, quote each argument safely, join shell setup statements with explicit semicolons, and verify test -x before exec.",
    avoidPatterns: ["joining shell setup fragments with spaces", "unquoted user-derived shell fragments"],
    enforcementPaths: [
      "lib/workflow/hermes-model-smoke.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "sandbox-staged-source-has-no-git-metadata",
    targets: ["vercel-sandbox"],
    component: "Vercel Sandbox staged source",
    appliesTo: "CoOperative cloud self-check",
    symptom: "git rev-parse HEAD exits 128 in an otherwise healthy Sandbox.",
    rootCause: "Staged Sandbox source does not guarantee a .git directory.",
    knownGoodPattern: "Verify staged application files such as package.json instead of requiring Git metadata unless the playbook explicitly clones a repository.",
    avoidPatterns: ["assuming .git exists in staged Sandbox source"],
    enforcementPaths: [
      "lib/operative/playbook-registry.ts",
      "tests/playbook-registry.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "workflow-required-for-long-cloud-work",
    targets: ["vercel-workflow", "vercel-sandbox"],
    component: "Long-running Vercel cloud execution",
    appliesTo: "Cloud Operative long-running playbooks",
    symptom: "Browser/server request owns execution until the Sandbox stream is terminated.",
    rootCause: "Long-running work was tied to a synchronous request lifecycle.",
    knownGoodPattern: "Use Vercel Workflow for durable long-running orchestration; the browser only starts work and reads canonical progress/results.",
    avoidPatterns: ["holding a browser request open for long-running Hermes work"],
    enforcementPaths: [
      "app/api/operative/tasks/[id]/execute/route.ts",
      "lib/workflow/hermes-runtime.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "hermes-v0213-global-flags-before-subcommand",
    targets: ["hermes-agent"],
    component: "Hermes Agent CLI",
    appliesTo: "Hermes Agent v0.21.3 / release v2026.9.14",
    symptom: "Hermes prints CLI help and rejects a valid-looking global flag.",
    rootCause: "Top-level flags such as --usage-file were placed after the chat subcommand.",
    knownGoodPattern: "Place Hermes global options before any subcommand. Keep subcommand-specific options after the subcommand only.",
    avoidPatterns: ["hermes chat ... --usage-file ..."],
    enforcementPaths: [
      "lib/workflow/hermes-model-smoke.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "hermes-v0213-minimum-context-64k",
    targets: ["hermes-agent", "vercel-ai-gateway"],
    component: "Hermes Agent model compatibility",
    appliesTo: "Hermes Agent v0.21.3 / release v2026.9.14",
    symptom: "Hermes fails agent initialization before the model request.",
    rootCause: "Selected model reports a context window below Hermes Agent's 64,000-token minimum.",
    knownGoodPattern: "Preflight the AI Gateway model catalog and reject missing or sub-64K models before Hermes launch.",
    avoidPatterns: ["alibaba/qwen-3-14b for this Hermes release without an authoritative >=64K context override"],
    enforcementPaths: [
      "lib/workflow/hermes-model-smoke.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "hermes-v0213-usage-file-requires-scripted-oneshot",
    targets: ["hermes-agent", "vercel-ai-gateway"],
    component: "Hermes Agent usage accounting",
    appliesTo: "Hermes Agent v0.21.3 / release v2026.9.14",
    symptom: "Hermes creates a session/model path but no required usage-file JSON is emitted.",
    rootCause: "The chat --oneshot path did not emit the governed usage report even with the global --usage-file option.",
    knownGoodPattern: "For bounded governed model calls that require usage accounting, use the top-level scripted -z/--oneshot path with --usage-file and a fixed safely quoted prompt.",
    avoidPatterns: ["hermes chat --oneshot when usage-file accounting is mandatory"],
    enforcementPaths: [
      "lib/workflow/hermes-model-smoke.ts",
      "tests/hermes-model-smoke.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "hermes-prompt-size-diagnostic-must-be-bounded",
    targets: ["hermes-agent", "vercel-sandbox"],
    component: "Hermes Agent diagnostics",
    appliesTo: "Prepared Hermes runtime cooperative-hermes-runtime-v2026-9-14",
    symptom: "Disposable verification fork hangs until Vercel terminates the request.",
    rootCause: "hermes prompt-size --json was too expensive/slow for the lightweight runtime verification path.",
    knownGoodPattern: "Use bounded hermes --version and hermes --help checks for runtime proof; reserve expensive diagnostics for an explicit diagnostic task.",
    avoidPatterns: ["hermes prompt-size --json in the routine prepared-runtime verification path"],
    enforcementPaths: [
      "lib/workflow/hermes-runtime.ts",
      "tests/hermes-workflow.test.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "prepared-hermes-runtime-reuse",
    targets: ["hermes-agent", "vercel-sandbox"],
    component: "Prepared Hermes runtime",
    appliesTo: "Hermes Agent v0.21.3 / release v2026.9.14",
    symptom: "Repeated tasks pay cold-install latency/cost or risk configuration drift.",
    rootCause: "Reinstalling Hermes for every task duplicates deterministic setup work.",
    knownGoodPattern: "Reuse the named prepared Sandbox snapshot cooperative-hermes-runtime-v2026-9-14 and fork disposable Sandboxes from it; reinstall only if the prepared runtime is actually missing/broken.",
    avoidPatterns: ["reinstalling Hermes on every task"],
    enforcementPaths: [
      "lib/workflow/hermes-runtime.ts",
      "lib/workflow/hermes-model-smoke.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
  {
    id: "supabase-trusted-writes-preserve-owner-gates",
    targets: ["supabase", "cooperative-executor-contract"],
    component: "Supabase trusted Cloud Operative writes",
    appliesTo: "CoOperative canonical task/event/cost ledger",
    symptom: "Server-side execution risks bypassing RLS/owner approval semantics.",
    rootCause: "The trusted server client can bypass RLS, so route-level auth/authz and explicit owner gates remain mandatory.",
    knownGoodPattern: "Authenticate the owner first, preserve explicit approval gates, then use the server-only admin client only for canonical trusted writes.",
    avoidPatterns: ["client-side fabrication of task events/cost entries", "using trusted writes to bypass approval gates"],
    enforcementPaths: [
      "app/api/operative/tasks/[id]/execute/route.ts",
      "lib/supabase/admin.ts",
    ],
    learnedAt: "2026-09-18",
    status: "active",
  },
];
