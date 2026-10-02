import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export async function currentAgentOwnerRef() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? `coop-user:${user.id}` : null;
}

export type AgentWorkerAuthorization =
  | {
      authorized: true;
      mode: "platform";
      nodeId: null;
      ownerRef: null;
    }
  | {
      authorized: true;
      mode: "platform-node";
      nodeId: string;
      ownerRef: null;
    }
  | {
      authorized: true;
      mode: "node";
      nodeId: string;
      ownerRef: string;
    }
  | {
      authorized: false;
      mode: "none";
      nodeId: null;
      ownerRef: null;
    };

export function localWorkerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function authorizeAgentWorker(
  request: Request,
): Promise<AgentWorkerAuthorization> {
  if (localWorkerAuthorized(request)) {
    return {
      authorized: true,
      mode: "platform",
      nodeId: null,
      ownerRef: null,
    };
  }

  const nodeId = request.headers.get("x-cooperative-node-id")?.trim() || "";
  if (!nodeId || !(await authorizeUnisonNode(request, nodeId))) {
    return {
      authorized: false,
      mode: "none",
      nodeId: null,
      ownerRef: null,
    };
  }

  const admin = createAdminSupabaseClient();
  const { data: node, error } = await admin
    .from("unison_nodes")
    .select("id,owner_ref")
    .eq("id", nodeId)
    .maybeSingle();

  if (error || !node?.owner_ref) {
    if (error) {
      console.error("Agent worker node lookup failed", {
        nodeId: nodeId.slice(0, 160),
        detail: error.message.slice(0, 500),
      });
    }
    return {
      authorized: false,
      mode: "none",
      nodeId: null,
      ownerRef: null,
    };
  }

  if (node.owner_ref === "platform-private") {
    return {
      authorized: true,
      mode: "platform-node",
      nodeId: node.id,
      ownerRef: null,
    };
  }

  return {
    authorized: true,
    mode: "node",
    nodeId: node.id,
    ownerRef: node.owner_ref,
  };
}

export function agentWorkerCanAccessOwner(
  authorization: AgentWorkerAuthorization,
  ownerRef: string,
) {
  return (
    authorization.authorized &&
    (authorization.mode === "platform" ||
      authorization.ownerRef === ownerRef)
  );
}
