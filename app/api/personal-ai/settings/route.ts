import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { nodeMembership } from "@/lib/unison/node-access";

export const runtime = "nodejs";
export const maxDuration = 30;

const mediaContentPreferenceSchema = z.enum([
  "sfw_only",
  "adult_allowed",
  "prefer_adult_capable",
  "require_adult_capable",
]);

const patchSchema = z.object({
  hostedHistoryEnabled: z.boolean().optional(),
  improvementOptIn: z.boolean().optional(),
  remoteEnabled: z.boolean().optional(),
  preferredNodeId: z.string().min(1).max(160).nullable().optional(),
  mediaContentPreference: mediaContentPreferenceSchema.optional(),
  adultContentAcknowledged: z.boolean().optional(),
});

async function readSettings(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("personal_ai_settings")
    .select(
      "user_id,hosted_history_enabled,improvement_opt_in,remote_enabled,preferred_node_id,media_content_preference,adult_content_acknowledged_at,created_at,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: created, error: createError } = await admin
    .from("personal_ai_settings")
    .insert({ user_id: userId })
    .select(
      "user_id,hosted_history_enabled,improvement_opt_in,remote_enabled,preferred_node_id,media_content_preference,adult_content_acknowledged_at,created_at,updated_at",
    )
    .single();

  if (createError) throw createError;
  return created;
}

function serialize(row: Awaited<ReturnType<typeof readSettings>>) {
  return {
    hostedHistoryEnabled: row.hosted_history_enabled,
    improvementOptIn: row.improvement_opt_in,
    remoteEnabled: row.remote_enabled,
    preferredNodeId: row.preferred_node_id,
    mediaContentPreference: row.media_content_preference,
    adultContentAcknowledgedAt: row.adult_content_acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(
      { settings: serialize(await readSettings(userId)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not load Personal AI settings.";
    return NextResponse.json(
      { error: "Could not load Personal AI settings.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = patchSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    if (input.preferredNodeId) {
      const membership = await nodeMembership(admin, userId, input.preferredNodeId);
      if (!membership) {
        return NextResponse.json(
          { error: "This account is not authorized to use that node." },
          { status: 403 },
        );
      }
    }

    await readSettings(userId);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.hostedHistoryEnabled !== undefined) {
      update.hosted_history_enabled = input.hostedHistoryEnabled;
    }
    if (input.improvementOptIn !== undefined) {
      update.improvement_opt_in = input.improvementOptIn;
    }
    if (input.remoteEnabled !== undefined) {
      update.remote_enabled = input.remoteEnabled;
    }
    if (input.preferredNodeId !== undefined) {
      update.preferred_node_id = input.preferredNodeId;
    }
    if (input.mediaContentPreference !== undefined) {
      if (
        input.mediaContentPreference !== "sfw_only" &&
        input.adultContentAcknowledged !== true
      ) {
        return NextResponse.json(
          {
            error:
              "Adult-capable media preferences require an explicit 18+ acknowledgment.",
          },
          { status: 400 },
        );
      }

      update.media_content_preference = input.mediaContentPreference;
      if (input.mediaContentPreference === "sfw_only") {
        update.adult_content_acknowledged_at = null;
      } else {
        update.adult_content_acknowledged_at = new Date().toISOString();
      }
    } else if (input.adultContentAcknowledged === true) {
      update.adult_content_acknowledged_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from("personal_ai_settings")
      .update(update)
      .eq("user_id", userId)
      .select(
        "user_id,hosted_history_enabled,improvement_opt_in,remote_enabled,preferred_node_id,media_content_preference,adult_content_acknowledged_at,created_at,updated_at",
      )
      .single();

    if (error) throw error;
    return NextResponse.json(
      { settings: serialize(data) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not update Personal AI settings.";
    return NextResponse.json(
      { error: "Could not update Personal AI settings.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
