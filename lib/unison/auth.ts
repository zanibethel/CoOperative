import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function authorizeUnisonNode(
  request: Request,
  nodeId?: string | null,
) {
  const token = bearerToken(request);
  if (!token) return false;

  const legacy =
    process.env.UNISON_NODE_SHARED_SECRET ||
    process.env.INFERENCE_LOCAL_TOKEN;

  // Temporary compatibility for already-running trusted workers.
  if (legacy && token === legacy) return true;

  if (!nodeId) return false;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("unison_nodes")
    .select("id")
    .eq("id", nodeId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("Unison node auth lookup failed", {
      nodeId: nodeId.slice(0, 160),
      detail: error.message.slice(0, 500),
    });
    return false;
  }

  return Boolean(data);
}
