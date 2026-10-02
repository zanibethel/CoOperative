import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { nodeMembership } from "@/lib/unison/node-access";

export const runtime = "nodejs";
export const maxDuration = 30;

const nodeSchema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

const roleSchema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  userId: z.string().uuid(),
  role: z.enum(["admin", "member"]),
});

const revokeSchema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  userId: z.string().uuid(),
});

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = nodeSchema.parse({
      nodeId: new URL(request.url).searchParams.get("nodeId"),
    });
    const admin = createAdminSupabaseClient();
    const requester = await nodeMembership(admin, userId, parsed.nodeId);
    if (!requester) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (requester.role === "member") {
      return NextResponse.json({
        members: [
          {
            userId: requester.userId,
            role: requester.role,
            status: "active",
          },
        ],
      });
    }

    const { data, error } = await admin
      .from("unison_node_users")
      .select("user_id,role,status,linked_at,updated_at")
      .eq("node_id", parsed.nodeId)
      .order("linked_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json(
      {
        members: (data || []).map((row) => ({
          userId: row.user_id,
          role: row.role,
          status: row.status,
          linkedAt: row.linked_at,
          updatedAt: row.updated_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read node access.";
    return NextResponse.json(
      { error: "Could not read node access.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = roleSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const requester = await nodeMembership(admin, userId, input.nodeId);
    if (requester?.role !== "owner") {
      return NextResponse.json(
        { error: "Only the device owner can change access roles." },
        { status: 403 },
      );
    }

    const target = await nodeMembership(admin, input.userId, input.nodeId);
    if (!target || target.role === "owner") {
      return NextResponse.json(
        { error: "The requested member cannot be changed." },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from("unison_node_users")
      .update({
        role: input.role,
        updated_at: new Date().toISOString(),
      })
      .eq("node_id", input.nodeId)
      .eq("user_id", input.userId)
      .eq("status", "active");
    if (error) throw error;

    return NextResponse.json({ ok: true, role: input.role });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not update node access.";
    return NextResponse.json(
      { error: "Could not update node access.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = revokeSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const requester = await nodeMembership(admin, userId, input.nodeId);
    if (!requester || requester.role === "member") {
      return NextResponse.json(
        { error: "Only a device owner or admin can revoke access." },
        { status: 403 },
      );
    }

    const target = await nodeMembership(admin, input.userId, input.nodeId);
    if (!target) {
      return NextResponse.json({ ok: true });
    }
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "The device owner's access cannot be revoked here." },
        { status: 409 },
      );
    }
    if (requester.role === "admin" && target.role !== "member") {
      return NextResponse.json(
        { error: "Admins can revoke members, not other admins." },
        { status: 403 },
      );
    }

    const now = new Date().toISOString();
    const { error: membershipError } = await admin
      .from("unison_node_users")
      .update({ status: "revoked", updated_at: now })
      .eq("node_id", input.nodeId)
      .eq("user_id", input.userId);
    if (membershipError) throw membershipError;

    const { error: tokenError } = await admin
      .from("unison_node_profile_tokens")
      .update({ revoked_at: now })
      .eq("node_id", input.nodeId)
      .eq("user_id", input.userId)
      .is("revoked_at", null);
    if (tokenError) throw tokenError;

    const { error: settingsError } = await admin
      .from("personal_ai_settings")
      .update({ preferred_node_id: null, updated_at: now })
      .eq("user_id", input.userId)
      .eq("preferred_node_id", input.nodeId);
    if (settingsError) throw settingsError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not revoke node access.";
    return NextResponse.json(
      { error: "Could not revoke node access.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
