import Link from "next/link";
import { redirect } from "next/navigation";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getUnisonViewer } from "@/lib/unison/access";
import UnisonNodeActions from "./node-actions";
import LiveNodeStatus from "../live-node-status";

function hours(seconds: number) {
  if (!seconds) return "0h";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)}h`;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function nodeStatus(node: { state: string; last_seen_at: string }) {
  const lastSeen = Date.parse(node.last_seen_at);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 90_000) return "offline";
  return node.state;
}

export default async function UnisonContributorDashboard() {
  const viewer = await getUnisonViewer();
  if (!viewer) redirect("/login?next=/unison/dashboard");
  if (!viewer.contributor) redirect("/unison/join");

  const admin = createAdminSupabaseClient();
  const [{ data: nodes }, { data: usage }] = await Promise.all([
    admin
      .from("unison_nodes")
      .select("id,display_name,node_class,state,platform,capabilities,resources,policy,worker_version,first_seen_at,last_seen_at")
      .eq("contributor_user_id", viewer.user.id)
      .order("first_seen_at", { ascending: false }),
    admin
      .from("unison_usage_ledger")
      .select("id,node_id,source_job_type,status,compute_seconds,gpu_seconds,earned_cents,estimated_external_cost_cents,completed_at,created_at")
      .eq("contributor_user_id", viewer.user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const nodeRows = nodes ?? [];
  const usageRows = usage ?? [];
  const completed = usageRows.filter((entry) => entry.status === "completed");
  const computeSeconds = completed.reduce((sum, entry) => sum + Number(entry.compute_seconds || 0), 0);
  const earnedCents = completed.reduce((sum, entry) => sum + Number(entry.earned_cents || 0), 0);
  const avoidedCents = completed.reduce(
    (sum, entry) => sum + Number(entry.estimated_external_cost_cents || 0),
    0,
  );
  const onlineNodes = nodeRows.filter((node) => nodeStatus(node) !== "offline").length;

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/unison" className="brand">UNISON</Link>
        <div className="nav-links">
          <Link href="/unison/join">Add a PC</Link>
          {viewer.isOwner ? <Link href="/unison/owner">Owner dashboard</Link> : null}
          <div className="badge">{viewer.contributor.display_name}</div>
        </div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Contributor dashboard</div>
        <h1>Your compute. Your contribution.</h1>
        <p>
          See what your devices have contributed to CoOperative and the earnings attached
          to verified usage. Compensation rates are not enabled yet, so tracked earnings
          remain at zero until a rate is deliberately published.
        </p>
      </section>

      <LiveNodeStatus
        scope="mine"
        title="Your nodes"
      />

      <section className="metrics unison-metrics">
        <div className="metric"><span>Devices online</span><strong>{onlineNodes}/{nodeRows.length}</strong></div>
        <div className="metric"><span>Completed jobs</span><strong>{completed.length}</strong></div>
        <div className="metric"><span>Compute contributed</span><strong>{hours(computeSeconds)}</strong></div>
        <div className="metric"><span>Tracked earnings</span><strong>{money(earnedCents)}</strong></div>
        <div className="metric"><span>External cost avoided</span><strong>{money(avoidedCents)}</strong></div>
      </section>

      <section className="unison-stack">
        <div className="service-head">
          <div>
            <div className="eyebrow">My devices</div>
            <h2>Enrolled Unison nodes</h2>
          </div>
          <Link className="secondary-cta" href="/unison/join">Add another PC</Link>
        </div>

        {nodeRows.length ? (
          <div className="unison-list">
            {nodeRows.map((node) => {
              const resources = (node.resources || {}) as {
                cpuLogical?: number;
                memoryTotalMb?: number;
                gpus?: Array<{ name?: string; memoryTotalMb?: number | null }>;
                textModelPlan?: {
                  revision?: string;
                  backend?: string;
                  models?: { fast?: string; quality?: string; heavy?: string; vision?: string };
                  selectionReason?: string;
                };
                textBenchmark?: {
                  profile?: string;
                  model?: string;
                  provider?: string;
                  outputTokens?: number;
                  latencyMs?: number;
                  tokensPerSecond?: number | null;
                  recordedAt?: string;
                };
              };
              const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
              const policy = (node.policy || {}) as {
                idleScope?: "session" | "machine";
                idleThresholdSeconds?: number;
              };
              const status = nodeStatus(node);
              return (
                <article className="card unison-device" key={node.id}>
                  <div className="service-head">
                    <div>
                      <strong>{node.display_name}</strong>
                      <p>{resources.gpus?.[0]?.name || "CPU / GPU details pending heartbeat"}</p>
                    </div>
                    <span className={`agent-status ${status === "busy" ? "running" : status === "idle" ? "completed" : ""}`}>
                      {status}
                    </span>
                  </div>
                  <div className="service-tags">
                    <span>{resources.cpuLogical || "?"} logical CPUs</span>
                    <span>{resources.memoryTotalMb ? `${Math.round(resources.memoryTotalMb / 1024)} GB RAM` : "RAM pending"}</span>
                    <span>{policy.idleScope === "machine" ? "Whole-PC idle" : "Profile idle"}</span>
                    {capabilities.includes("local_personal_chat") ? <span>Personal Local AI ready</span> : null}
                    {capabilities.includes("local_ai_images") ? <span>Image understanding</span> : null}
                    {capabilities.includes("local_ai_image_generation") ? <span>Image creation</span> : null}
                    {capabilities.includes("local_ai_files") ? <span>Files</span> : null}
                    {capabilities.includes("local_ai_web_search") ? <span>Web search</span> : null}
                    {capabilities.includes("local_ai_voice") ? <span>Voice</span> : null}
                    {capabilities.includes("local_ai_projects") ? <span>Projects</span> : null}
                    {capabilities.includes("local_ai_auto_model") ? <span>Auto model</span> : null}
                    <span>{node.worker_version || "Worker version pending"}</span>
                    <span>Last seen {new Date(node.last_seen_at).toLocaleString()}</span>
                  </div>
                  {resources.textModelPlan?.models ? (
                    <div className="unison-stack">
                      <p>
                        <strong>Adaptive text:</strong>{" "}
                        {resources.textModelPlan.backend || "local"} · Fast{" "}
                        <code>{resources.textModelPlan.models.fast || "pending"}</code> · Quality{" "}
                        <code>{resources.textModelPlan.models.quality || "pending"}</code>
                        {resources.textModelPlan.models.heavy
                          ? <> · Heavy candidate <code>{resources.textModelPlan.models.heavy}</code></>
                          : null}
                        {resources.textModelPlan.models.vision
                          ? <> · Vision <code>{resources.textModelPlan.models.vision}</code></>
                          : null}
                      </p>
                      {resources.textBenchmark?.model ? (
                        <p>
                          <strong>Latest benchmark:</strong>{" "}
                          {resources.textBenchmark.model}
                          {typeof resources.textBenchmark.tokensPerSecond === "number"
                            ? ` · ${resources.textBenchmark.tokensPerSecond.toFixed(1)} tok/s`
                            : ""}
                          {typeof resources.textBenchmark.latencyMs === "number"
                            ? ` · ${(resources.textBenchmark.latencyMs / 1000).toFixed(1)}s`
                            : ""}
                        </p>
                      ) : (
                        <p>Real throughput benchmark will appear after this node completes text work.</p>
                      )}
                    </div>
                  ) : null}
                  <UnisonNodeActions nodeId={node.id} status={status} />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <strong>No computers enrolled yet.</strong>
            <p>Create a one-time pairing code and install the Windows bootstrap on your first PC.</p>
          </div>
        )}
      </section>

      <section className="unison-stack">
        <div>
          <div className="eyebrow">Contribution history</div>
          <h2>Recent verified usage</h2>
        </div>
        {usageRows.length ? (
          <div className="unison-table-wrap">
            <table className="unison-table">
              <thead><tr><th>When</th><th>Node</th><th>Work</th><th>Compute</th><th>Status</th><th>Earnings</th></tr></thead>
              <tbody>
                {usageRows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.completed_at || entry.created_at).toLocaleString()}</td>
                    <td>{entry.node_id || "Unknown"}</td>
                    <td>{entry.source_job_type.replaceAll("_", " ")}</td>
                    <td>{hours(Number(entry.compute_seconds || 0))}</td>
                    <td>{entry.status}</td>
                    <td>{money(Number(entry.earned_cents || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card"><p>No completed Unison workloads have been recorded for this account yet.</p></div>
        )}
      </section>
    </main>
  );
}
