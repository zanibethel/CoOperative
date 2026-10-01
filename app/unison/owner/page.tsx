import Link from "next/link";
import { redirect } from "next/navigation";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getUnisonViewer } from "@/lib/unison/access";
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

function statusOf(node: { state: string; last_seen_at: string }) {
  const seen = Date.parse(node.last_seen_at);
  return !Number.isFinite(seen) || Date.now() - seen > 90_000 ? "offline" : node.state;
}

export default async function UnisonOwnerDashboard() {
  const viewer = await getUnisonViewer();
  if (!viewer) redirect("/login?next=/unison/owner");
  if (!viewer.isOwner) redirect("/unison/dashboard");

  const admin = createAdminSupabaseClient();
  const [{ data: contributors }, { data: nodes }, { data: usage }] = await Promise.all([
    admin
      .from("unison_contributors")
      .select("user_id,display_name,contact_email,status,payout_status,joined_at")
      .order("joined_at", { ascending: false }),
    admin
      .from("unison_nodes")
      .select("id,display_name,contributor_user_id,node_class,state,resources,first_seen_at,last_seen_at")
      .order("first_seen_at", { ascending: false }),
    admin
      .from("unison_usage_ledger")
      .select("id,contributor_user_id,node_id,source_job_type,status,compute_seconds,earned_cents,estimated_external_cost_cents,completed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const contributorRows = contributors ?? [];
  const nodeRows = nodes ?? [];
  const usageRows = usage ?? [];
  const completed = usageRows.filter((entry) => entry.status === "completed");
  const totalSeconds = completed.reduce((sum, entry) => sum + Number(entry.compute_seconds || 0), 0);
  const earnedCents = completed.reduce((sum, entry) => sum + Number(entry.earned_cents || 0), 0);
  const avoidedCents = completed.reduce(
    (sum, entry) => sum + Number(entry.estimated_external_cost_cents || 0),
    0,
  );
  const onlineNodes = nodeRows.filter((node) => statusOf(node) !== "offline").length;

  const nodeCountByContributor = new Map<string, number>();
  for (const node of nodeRows) {
    if (!node.contributor_user_id) continue;
    nodeCountByContributor.set(
      node.contributor_user_id,
      (nodeCountByContributor.get(node.contributor_user_id) || 0) + 1,
    );
  }

  const usageByContributor = new Map<string, { jobs: number; seconds: number; earnings: number }>();
  for (const entry of completed) {
    if (!entry.contributor_user_id) continue;
    const current = usageByContributor.get(entry.contributor_user_id) || {
      jobs: 0,
      seconds: 0,
      earnings: 0,
    };
    current.jobs += 1;
    current.seconds += Number(entry.compute_seconds || 0);
    current.earnings += Number(entry.earned_cents || 0);
    usageByContributor.set(entry.contributor_user_id, current);
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/unison" className="brand">UNISON / OWNER</Link>
        <div className="nav-links">
          <Link href="/unison/dashboard">My contributor view</Link>
          <Link href="/">CoOperative</Link>
          <div className="badge">Platform reporting</div>
        </div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">CoOperative owner dashboard</div>
        <h1>People-powered infrastructure, visible end to end.</h1>
        <p>
          Track contributor signups, enrolled hardware, live node availability,
          verified compute usage, and the earnings ledger without mixing this data
          into RaiseHub.
        </p>
      </section>

      <LiveNodeStatus
        scope="owner"
        title="Network nodes"
      />

      <section className="metrics unison-metrics">
        <div className="metric"><span>Contributors</span><strong>{contributorRows.length}</strong></div>
        <div className="metric"><span>Nodes online</span><strong>{onlineNodes}/{nodeRows.length}</strong></div>
        <div className="metric"><span>Completed jobs</span><strong>{completed.length}</strong></div>
        <div className="metric"><span>Compute contributed</span><strong>{hours(totalSeconds)}</strong></div>
        <div className="metric"><span>Earnings ledger</span><strong>{money(earnedCents)}</strong></div>
        <div className="metric"><span>External cost avoided</span><strong>{money(avoidedCents)}</strong></div>
      </section>

      <section className="unison-stack">
        <div>
          <div className="eyebrow">Signups</div>
          <h2>Unison contributors</h2>
        </div>
        {contributorRows.length ? (
          <div className="unison-table-wrap">
            <table className="unison-table">
              <thead><tr><th>Contributor</th><th>Joined</th><th>Nodes</th><th>Jobs</th><th>Compute</th><th>Earnings</th><th>Status</th></tr></thead>
              <tbody>
                {contributorRows.map((contributor) => {
                  const totals = usageByContributor.get(contributor.user_id);
                  return (
                    <tr key={contributor.user_id}>
                      <td><strong>{contributor.display_name}</strong><br /><span>{contributor.contact_email}</span></td>
                      <td>{new Date(contributor.joined_at).toLocaleString()}</td>
                      <td>{nodeCountByContributor.get(contributor.user_id) || 0}</td>
                      <td>{totals?.jobs || 0}</td>
                      <td>{hours(totals?.seconds || 0)}</td>
                      <td>{money(totals?.earnings || 0)}</td>
                      <td>{contributor.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card"><p>No contributors have joined yet.</p></div>
        )}
      </section>

      <section className="unison-stack">
        <div>
          <div className="eyebrow">Infrastructure</div>
          <h2>Enrolled nodes</h2>
        </div>
        {nodeRows.length ? (
          <div className="unison-list">
            {nodeRows.map((node) => {
              const resources = (node.resources || {}) as {
                cpuLogical?: number;
                memoryTotalMb?: number;
                gpus?: Array<{ name?: string }>;
              };
              const contributor = contributorRows.find((row) => row.user_id === node.contributor_user_id);
              const status = statusOf(node);
              return (
                <article className="card unison-device" key={node.id}>
                  <div className="service-head">
                    <div>
                      <strong>{node.display_name}</strong>
                      <p>{contributor ? `${contributor.display_name} · ${contributor.contact_email}` : node.node_class}</p>
                    </div>
                    <span className="agent-status">{status}</span>
                  </div>
                  <div className="service-tags">
                    <span>{resources.gpus?.[0]?.name || "GPU pending"}</span>
                    <span>{resources.cpuLogical || "?"} logical CPUs</span>
                    <span>{resources.memoryTotalMb ? `${Math.round(resources.memoryTotalMb / 1024)} GB RAM` : "RAM pending"}</span>
                    <span>Last seen {new Date(node.last_seen_at).toLocaleString()}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card"><p>No Unison nodes have paired yet.</p></div>
        )}
      </section>

      <section className="unison-stack">
        <div>
          <div className="eyebrow">Usage</div>
          <h2>Recent network work</h2>
        </div>
        {usageRows.length ? (
          <div className="unison-table-wrap">
            <table className="unison-table">
              <thead><tr><th>When</th><th>Node</th><th>Work</th><th>Compute</th><th>Status</th><th>Earnings</th></tr></thead>
              <tbody>
                {usageRows.slice(0, 100).map((entry) => (
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
          <div className="card"><p>No network usage has been recorded yet.</p></div>
        )}
      </section>
    </main>
  );
}
