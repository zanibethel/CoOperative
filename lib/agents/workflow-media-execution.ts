import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  aiProfileBalanceForOwnerRef,
  profileRefFromAiOwnerRef,
  releaseAiProfileFunds,
  reserveAiProfileFunds,
  settleAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import {
  adultMediaContentClass,
  mediaPromptWithResolvedControls,
  planMediaRequest,
} from "@/lib/inference/media-request";
import {
  evaluateMediaExecutionContentGate,
  mediaContentPreferenceForUser,
  recordMediaRuntimePolicyRefusal,
} from "@/lib/inference/media-model-capabilities";
import { openRouterMediaCatalog } from "@/lib/inference/openrouter-media-catalog";
import {
  buildMediaRecommendationOptions,
  type MediaRecommendationOption,
} from "@/lib/inference/media-recommendations";
import { executeOpenRouterImageDirect } from "@/lib/inference/openrouter-direct-image";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import { classifyMediaRouteOutcome } from "@/lib/inference/media-route-outcome";
import { recordMediaRouteOutcome } from "@/lib/inference/media-route-evidence";
import { userIdFromOwnerRef } from "@/lib/unison/owned-text-routing";

type WorkflowRow = {
  id: string;
  owner_ref: string;
  objective: string;
  preset: "economy" | "balanced" | "premium";
  status: string;
  max_spend_microusd: number;
  reserved_spend_microusd: number;
  actual_spend_microusd: number;
};

type NodeRow = {
  id: string;
  workflow_id: string;
  node_kind: string;
  task_type: string;
  status: string;
  selected_provider: string | null;
  selected_model: string | null;
  selected_route_kind: string | null;
  estimated_cost_microusd: number;
  budget_reserved_microusd: number;
  result: Record<string, unknown> | null;
  attempt: number;
  child_media_job_id?: string | null;
};

function microusd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.round(value * 1_000_000));
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadWorkflowMediaNode(
  ownerRef: string,
  workflowId: string,
  nodeId: string,
) {
  const admin = createAdminSupabaseClient();
  const [{ data: workflow, error: workflowError }, { data: node, error: nodeError }] =
    await Promise.all([
      admin
        .from("agent_workflows")
        .select(
          "id,owner_ref,objective,preset,status,max_spend_microusd,reserved_spend_microusd,actual_spend_microusd",
        )
        .eq("id", workflowId)
        .eq("owner_ref", ownerRef)
        .maybeSingle(),
      admin
        .from("agent_workflow_nodes")
        .select(
          "id,workflow_id,node_kind,task_type,status,selected_provider,selected_model,selected_route_kind,estimated_cost_microusd,budget_reserved_microusd,result,attempt,child_media_job_id",
        )
        .eq("id", nodeId)
        .eq("workflow_id", workflowId)
        .maybeSingle(),
    ]);

  if (workflowError) throw workflowError;
  if (nodeError) throw nodeError;
  if (!workflow || !node) return null;

  return {
    workflow: workflow as WorkflowRow,
    node: node as NodeRow,
  };
}

async function moveBackToApproval(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
  reason: string;
  resultPatch?: Record<string, unknown>;
}) {
  const admin = createAdminSupabaseClient();
  await admin.rpc("release_agent_workflow_node_budget", {
    p_owner_ref: input.ownerRef,
    p_workflow_id: input.workflowId,
    p_node_id: input.nodeId,
  });

  const current = await loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
  const merged = {
    ...(current?.node.result || {}),
    ...(input.resultPatch || {}),
    executionEnabled: false,
    generationSent: false,
    approvalError: input.reason,
  };

  await admin
    .from("agent_workflow_nodes")
    .update({
      status: "needs_approval",
      result: merged,
      error: input.reason.slice(0, 2000),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.nodeId)
    .eq("workflow_id", input.workflowId);

  await admin
    .from("agent_workflows")
    .update({
      status: "needs_approval",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.workflowId)
    .eq("owner_ref", input.ownerRef);
}

async function releaseWorkflowBudget(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
}) {
  const admin = createAdminSupabaseClient();
  await admin.rpc("release_agent_workflow_node_budget", {
    p_owner_ref: input.ownerRef,
    p_workflow_id: input.workflowId,
    p_node_id: input.nodeId,
  });
}

async function settleWorkflowBudget(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
  actualMicrousd: number;
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc(
    "settle_agent_workflow_node_budget",
    {
      p_owner_ref: input.ownerRef,
      p_workflow_id: input.workflowId,
      p_node_id: input.nodeId,
      p_actual_microusd: input.actualMicrousd,
    },
  );
  if (error) throw error;
  if (data !== true) {
    throw new Error("Workflow budget settlement was rejected.");
  }
}

function exactPlannedRoute(
  options: MediaRecommendationOption[],
  node: NodeRow,
) {
  const planned =
    node.result && typeof node.result === "object"
      ? node.result
      : {};
  const plannedTier =
    typeof planned.selectedTier === "string" ? planned.selectedTier : null;
  const plannedRecipe =
    planned.recipe &&
    typeof planned.recipe === "object" &&
    !Array.isArray(planned.recipe)
      ? (planned.recipe as Record<string, unknown>)
      : null;

  return (
    options.find((option) => {
      if (
        option.provider !== node.selected_provider ||
        option.model !== node.selected_model
      ) {
        return false;
      }
      if (plannedTier && option.tier !== plannedTier) return false;
      if (!plannedRecipe) return true;

      const sameDuration =
        plannedRecipe.durationSeconds == null ||
        option.recipe.durationSeconds === plannedRecipe.durationSeconds;
      const sameResolution =
        plannedRecipe.resolution == null ||
        option.recipe.resolution === plannedRecipe.resolution;
      const sameAudio =
        plannedRecipe.audio == null ||
        option.recipe.audio === plannedRecipe.audio;
      const sameAspect =
        plannedRecipe.aspectRatio == null ||
        option.recipe.aspectRatio === plannedRecipe.aspectRatio;

      return sameDuration && sameResolution && sameAudio && sameAspect;
    }) || null
  );
}

export async function approveAndExecuteWorkflowMediaImage(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
}) {
  const state = await loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
  if (!state) {
    return { ok: false as const, status: 404, error: "Workflow media node not found." };
  }

  const { workflow, node } = state;
  if (
    node.node_kind !== "media" ||
    node.task_type !== "image-generation" ||
    node.status !== "needs_approval"
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "This media node is not awaiting image-generation approval.",
    };
  }

  if (
    node.selected_provider !== "openrouter" ||
    !node.selected_model ||
    node.selected_route_kind !== "image"
  ) {
    return {
      ok: false as const,
      status: 409,
      error:
        "This planned route is not in the currently enabled one-shot OpenRouter image execution slice.",
    };
  }

  const plan = planMediaRequest(workflow.objective);
  if (!plan || plan.kind !== "image" || plan.clarification) {
    return {
      ok: false as const,
      status: 409,
      error: "The workflow objective no longer resolves to an executable image request.",
    };
  }

  const connectedOpenRouter =
    await businessOwnedServiceCredentialForOwner(
      input.ownerRef,
      "openrouter-api",
    );
  const usingConnectedCredential = Boolean(connectedOpenRouter?.credential);
  const catalog = await openRouterMediaCatalog(
    true,
    connectedOpenRouter?.credential || undefined,
  );

  const remainingBudgetUsd = Math.max(
    0,
    (workflow.max_spend_microusd -
      workflow.actual_spend_microusd -
      workflow.reserved_spend_microusd) /
      1_000_000,
  );

  const adultClass = adultMediaContentClass(workflow.objective);
  const workflowUserId = userIdFromOwnerRef(input.ownerRef);
  const mediaPreference = workflowUserId
    ? await mediaContentPreferenceForUser(workflowUserId)
    : { preference: "sfw_only" as const, adultContentAcknowledgedAt: null };
  const recommendations = await buildMediaRecommendationOptions({
    plan,
    openRouterCatalog: catalog,
    currentCapUsd: remainingBudgetUsd,
    localImageAvailable: false,
    requiresReferenceImage: false,
    contentPreference: mediaPreference.preference,
    adultOutputRequested: adultClass !== "sfw",
    adultContentClass: adultClass,
    cooperativeManagedOpenRouter: !usingConnectedCredential,
  });
  const selected = exactPlannedRoute(recommendations.options, node);

  if (!selected || selected.executionReady === false) {
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      reason:
        "The previously planned image route is no longer eligible in the live catalog/registry/policy checks. Re-plan before approving generation.",
      resultPatch: {
        routeRevalidation: "failed",
        availableOptions: recommendations.options.map((option) => ({
          tier: option.tier,
          provider: option.provider,
          model: option.model,
          capUsd: option.capUsd,
          executionReady: option.executionReady,
        })),
      },
    });
    return {
      ok: false as const,
      status: 409,
      error: "The planned route changed and requires a fresh approval.",
    };
  }

  const currentQuoteMicrousd = microusd(selected.capUsd);
  const priorQuoteMicrousd = Math.max(0, Number(node.estimated_cost_microusd || 0));
  if (currentQuoteMicrousd > priorQuoteMicrousd) {
    const admin = createAdminSupabaseClient();
    await admin
      .from("agent_workflow_nodes")
      .update({
        estimated_cost_microusd: currentQuoteMicrousd,
        result: {
          ...(node.result || {}),
          quotedCapUsd: selected.capUsd,
          estimatedCostUsd: selected.estimatedCostUsd,
          providerCostEstimateUsd: selected.providerCostEstimateUsd,
          pricingSource: selected.pricingSource,
          routeRevalidation: "price-increased",
          executionEnabled: false,
          generationSent: false,
          reason:
            "The live quote increased after planning. The route was not executed; approve the updated quote separately.",
        },
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id)
      .eq("status", "needs_approval");

    return {
      ok: false as const,
      status: 409,
      error: "The live media quote increased and requires a fresh approval.",
      updatedQuoteUsd: selected.capUsd,
    };
  }

  const userId = userIdFromOwnerRef(input.ownerRef);
  if (!userId) {
    return {
      ok: false as const,
      status: 403,
      error: "This workflow owner cannot pass the execution-time media content gate.",
    };
  }

  const gate = await evaluateMediaExecutionContentGate({
    userId,
    ownerRef: input.ownerRef,
    provider: selected.provider,
    model: selected.model,
    endpoint: selected.editEndpoint,
    adultContentClass: adultClass,
  });
  if (!gate.allowed) {
    const admin = createAdminSupabaseClient();
    await admin
      .from("agent_workflow_nodes")
      .update({
        status: "failed",
        result: {
          ...(node.result || {}),
          executionEnabled: false,
          generationSent: false,
          contentGate: gate,
        },
        error: gate.note.slice(0, 2000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("status", "needs_approval");

    return { ok: false as const, status: 409, error: gate.note };
  }

  const admin = createAdminSupabaseClient();
  const { data: reserved, error: reserveError } = await admin.rpc(
    "reserve_agent_workflow_node_budget",
    {
      p_owner_ref: input.ownerRef,
      p_workflow_id: workflow.id,
      p_node_id: node.id,
      p_amount_microusd: currentQuoteMicrousd,
    },
  );
  if (reserveError) throw reserveError;
  if (reserved !== true) {
    return {
      ok: false as const,
      status: 409,
      error:
        "The shared workflow budget changed before this media approval could be reserved.",
    };
  }

  let profileReservationId: string | null = null;
  const providerCredential =
    connectedOpenRouter?.credential || process.env.OPENROUTER_API_KEY?.trim() || null;
  if (!providerCredential) {
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      reason: "No OpenRouter credential is available for the approved route.",
    });
    return { ok: false as const, status: 409, error: "OpenRouter credential unavailable." };
  }

  const cooperativeFunded =
    !usingConnectedCredential &&
    selected.providerCostEstimateUsd > 0 &&
    currentQuoteMicrousd > 0;

  if (cooperativeFunded) {
    const profileRef = profileRefFromAiOwnerRef(input.ownerRef);
    if (!profileRef) {
      await moveBackToApproval({
        ownerRef: input.ownerRef,
        workflowId: workflow.id,
        nodeId: node.id,
        reason: "This workflow does not map to a CoOperative AI balance profile.",
      });
      return { ok: false as const, status: 409, error: "AI balance profile unavailable." };
    }

    const profileReservation = await reserveAiProfileFunds({
      profileRef,
      estimatedCostUsd: currentQuoteMicrousd / 1_000_000,
      source: "agent-workflow-media",
      referenceId: node.id,
      metadata: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        provider: selected.provider,
        model: selected.model,
        quotedUserPriceUsd: currentQuoteMicrousd / 1_000_000,
        providerCostEstimateUsd: selected.providerCostEstimateUsd,
        oneShot: true,
      },
    });

    if (!profileReservation) {
      const balance = await aiProfileBalanceForOwnerRef(input.ownerRef);
      await moveBackToApproval({
        ownerRef: input.ownerRef,
        workflowId: workflow.id,
        nodeId: node.id,
        reason:
          "The CoOperative AI balance is too low to reserve the approved image generation.",
        resultPatch: {
          availableAiBalanceUsd: balance?.availableUsd ?? null,
          requiredQuoteUsd: currentQuoteMicrousd / 1_000_000,
        },
      });
      return {
        ok: false as const,
        status: 409,
        error: "Insufficient CoOperative AI balance for this approved image route.",
      };
    }
    profileReservationId = profileReservation.id;
  }

  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const generationPrompt = mediaPromptWithResolvedControls(
    workflow.objective,
    plan,
  );

  const { error: insertError } = await admin
    .from("media_generation_jobs")
    .insert({
      id: jobId,
      status: "running",
      request_root_job_id: jobId,
      route_attempt: 1,
      execution_mode: "workflow-direct-provider",
      owner_ref: input.ownerRef,
      conversation_id: null,
      kind: "image",
      prompt: generationPrompt,
      provider: "openrouter",
      model: selected.model,
      model_mixer: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        preset: workflow.preset,
        approvedOneShot: true,
        noRetry: true,
        selectedScorecard: selected.scorecard,
      },
      request_max_spend_microusd: currentQuoteMicrousd,
      media_level:
        workflow.preset === "premium" ? 4 : workflow.preset === "balanced" ? 2 : 0,
      estimated_provider_cost_microusd: microusd(selected.providerCostEstimateUsd),
      estimated_user_charge_microusd: cooperativeFunded
        ? currentQuoteMicrousd
        : 0,
      estimated_margin_microusd: cooperativeFunded
        ? Math.max(
            0,
            currentQuoteMicrousd - microusd(selected.providerCostEstimateUsd),
          )
        : null,
      billing_mode: cooperativeFunded
        ? "cooperative-balance"
        : usingConnectedCredential
          ? "openrouter-byok"
          : null,
      provider_cost_bearer: cooperativeFunded
        ? "cooperative"
        : usingConnectedCredential
          ? "user-connected"
          : "free",
      ai_balance_reservation_id: profileReservationId,
      pricing_dimensions: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        approvedOneShot: true,
        noAutomaticRetry: true,
        durationSeconds: null,
        aspectRatio: plan.aspectRatio,
        resolution: null,
        audio: null,
        quotedWorkflowBudgetUsd: currentQuoteMicrousd / 1_000_000,
        quotedUserPriceUsd: cooperativeFunded
          ? currentQuoteMicrousd / 1_000_000
          : 0,
        providerCostEstimateUsd: selected.providerCostEstimateUsd,
        pricingSource: selected.pricingSource,
        directProvider: true,
      },
      pricing_source: selected.pricingSource,
      started_at: startedAt,
    });

  if (insertError) {
    if (profileReservationId) {
      await releaseAiProfileFunds({
        reservationId: profileReservationId,
        metadata: { reason: "workflow-media-job-insert-failed", workflowId: workflow.id },
      }).catch(() => undefined);
    }
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      reason: "The approved media job could not be created, so no generation request was sent.",
    });
    throw insertError;
  }

  await admin
    .from("agent_workflow_nodes")
    .update({
      child_media_job_id: jobId,
      result: {
        ...(node.result || {}),
        executionEnabled: true,
        generationSent: true,
        approvedAt: startedAt,
        mediaJobId: jobId,
        billingMode: cooperativeFunded
          ? "cooperative-balance"
          : usingConnectedCredential
            ? "openrouter-byok"
            : "free",
      },
      error: null,
      updated_at: startedAt,
    })
    .eq("id", node.id)
    .eq("status", "running");

  const direct = await executeOpenRouterImageDirect({
    jobId,
    ownerRef: input.ownerRef,
    model: selected.model,
    prompt: generationPrompt,
    credential: providerCredential,
  });

  if (direct.ok) {
    const completedAt = new Date().toISOString();
    const mediaUrl =
      `/api/local-ai/media-output?jobId=${encodeURIComponent(jobId)}`;
    const resultText =
      `Generated image with ${selected.model}.\nMEDIA_IMAGE:${mediaUrl}`;

    const { error: pendingResultError } = await admin
      .from("agent_workflow_nodes")
      .update({
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: true,
          oneShot: true,
          noAutomaticRetry: true,
          mediaJobId: jobId,
          provider: selected.provider,
          model: selected.model,
          reconciliationPending: true,
          pendingDirectResult: {
            mediaUrl,
            resultText,
            storagePath: direct.storagePath,
            mimeType: direct.mimeType,
            usage: direct.usage,
            completedAt,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id)
      .eq("status", "running");
    if (pendingResultError) throw pendingResultError;

    const { data: completedJob, error: completeJobError } = await admin
      .from("media_generation_jobs")
      .update({
        status: "completed",
        result_url: mediaUrl,
        result_text: resultText,
        usage: direct.usage,
        pricing_dimensions: {
          workflowId: workflow.id,
          workflowNodeId: node.id,
          approvedOneShot: true,
          noAutomaticRetry: true,
          aspectRatio: plan.aspectRatio,
          quotedWorkflowBudgetUsd: currentQuoteMicrousd / 1_000_000,
          quotedUserPriceUsd: cooperativeFunded
            ? currentQuoteMicrousd / 1_000_000
            : 0,
          providerCostEstimateUsd: selected.providerCostEstimateUsd,
          pricingSource: selected.pricingSource,
          directProvider: true,
          generatedStoragePath: direct.storagePath,
          generatedMimeType: direct.mimeType,
        },
        billed_microusd: cooperativeFunded ? currentQuoteMicrousd : 0,
        actual_user_charge_microusd: cooperativeFunded
          ? currentQuoteMicrousd
          : 0,
        actual_provider_cost_microusd: microusd(
          selected.providerCostEstimateUsd,
        ),
        actual_margin_microusd: cooperativeFunded
          ? Math.max(
              0,
              currentQuoteMicrousd -
                microusd(selected.providerCostEstimateUsd),
            )
          : null,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId)
      .eq("owner_ref", input.ownerRef)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    if (completeJobError) throw completeJobError;
    if (!completedJob) {
      throw new Error(
        "The generated image was persisted, but the media job could not be finalized yet.",
      );
    }

    if (profileReservationId) {
      await settleAiProfileFunds({
        reservationId: profileReservationId,
        actualCostUsd: currentQuoteMicrousd / 1_000_000,
        metadata: {
          workflowId: workflow.id,
          workflowNodeId: node.id,
          jobId,
          outcome: "completed",
          provider: selected.provider,
          model: selected.model,
          oneShot: true,
        },
      });
    }

    await settleWorkflowBudget({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      actualMicrousd: currentQuoteMicrousd,
    });

    const { error: nodeCompleteError } = await admin
      .from("agent_workflow_nodes")
      .update({
        status: "completed",
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: true,
          oneShot: true,
          noAutomaticRetry: true,
          mediaJobId: jobId,
          mediaUrl,
          text: resultText,
          provider: selected.provider,
          model: selected.model,
          quotedBudgetUsd: currentQuoteMicrousd / 1_000_000,
          chargedCoOperativeBalanceUsd: cooperativeFunded
            ? currentQuoteMicrousd / 1_000_000
            : 0,
          billingMode: cooperativeFunded
            ? "cooperative-balance"
            : usingConnectedCredential
              ? "openrouter-byok"
              : "free",
          usage: direct.usage,
          reconciliationPending: false,
          pendingDirectResult: null,
        },
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id);
    if (nodeCompleteError) throw nodeCompleteError;

    return {
      ok: true as const,
      status: 200,
      jobId,
      mediaUrl,
      model: selected.model,
      provider: selected.provider,
      chargedUsd: cooperativeFunded
        ? currentQuoteMicrousd / 1_000_000
        : 0,
      workflowBudgetUsedUsd: currentQuoteMicrousd / 1_000_000,
      billingMode: cooperativeFunded
        ? "cooperative-balance"
        : usingConnectedCredential
          ? "openrouter-byok"
          : "free",
    };
  }

  const completedAt = new Date().toISOString();
  if (profileReservationId) {
    await releaseAiProfileFunds({
      reservationId: profileReservationId,
      metadata: {
        reason: "workflow-one-shot-image-failed",
        workflowId: workflow.id,
        workflowNodeId: node.id,
        jobId,
      },
    }).catch(() => undefined);
  }
  await releaseWorkflowBudget({
    ownerRef: input.ownerRef,
    workflowId: workflow.id,
    nodeId: node.id,
  });

  const outcome = classifyMediaRouteOutcome({
    detail: direct.error,
    status: direct.status,
    failureStage: direct.failureStage,
  });

  await recordMediaRouteOutcome({
    ownerRef: input.ownerRef,
    sourceJobId: jobId,
    provider: selected.provider,
    model: selected.model,
    executionMode: "workflow-direct-provider",
    requestShape: "image-text",
    outcomeKind: outcome.kind,
    detail: direct.error,
    blocksRoute: outcome.kind === "capability-refusal",
  }).catch(() => undefined);

  if (outcome.kind === "provider-policy") {
    await recordMediaRuntimePolicyRefusal({
      ownerRef: input.ownerRef,
      provider: selected.provider,
      model: selected.model,
      endpoint: selected.editEndpoint,
      sourceJobId: jobId,
      requestedClass: adultClass,
      detail: direct.error,
    }).catch(() => undefined);
  }

  await admin
    .from("media_generation_jobs")
    .update({
      status: "failed",
      usage: direct.usage,
      error: direct.error.slice(0, 1200),
      ai_balance_reservation_id: null,
      actual_user_charge_microusd: 0,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", jobId)
    .eq("owner_ref", input.ownerRef);

  await admin
    .from("agent_workflow_nodes")
    .update({
      status: "failed",
      budget_reserved_microusd: 0,
      actual_cost_microusd: 0,
      result: {
        ...(node.result || {}),
        executionEnabled: true,
        generationSent: true,
        oneShot: true,
        noAutomaticRetry: true,
        mediaJobId: jobId,
        provider: selected.provider,
        model: selected.model,
        outcomeKind: outcome.kind,
        failureStage: direct.failureStage,
        providerStatus: direct.status,
        error: direct.error,
      },
      error: direct.error.slice(0, 2000),
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", node.id)
    .eq("workflow_id", workflow.id);

  return {
    ok: false as const,
    status: 502,
    error:
      "The approved one-shot image attempt failed. No retry or fallback was started.",
    providerError: direct.error,
    outcomeKind: outcome.kind,
    jobId,
  };
}


function videoPromptForSelection(
  objective: string,
  plan: NonNullable<ReturnType<typeof planMediaRequest>>,
  selected: MediaRecommendationOption,
) {
  let prompt = mediaPromptWithResolvedControls(objective, plan);
  if (selected.recipe.durationSeconds) {
    prompt += "\nBudget-approved duration: " + selected.recipe.durationSeconds + " seconds.";
  }
  if (selected.recipe.resolution) {
    prompt += "\nBudget-approved resolution: " + selected.recipe.resolution + ".";
  }
  if (selected.recipe.audio !== null) {
    prompt += "\nBudget-approved generated audio: " +
      (selected.recipe.audio ? "on." : "off.");
  }
  return prompt;
}

export async function approveAndStartWorkflowMediaVideo(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
}) {
  const state = await loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
  if (!state) {
    return { ok: false as const, status: 404, error: "Workflow media node not found." };
  }

  const { workflow, node } = state;
  if (
    node.node_kind !== "media" ||
    node.task_type !== "video-generation" ||
    node.status !== "needs_approval"
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "This media node is not awaiting video-generation approval.",
    };
  }

  if (
    node.selected_provider !== "openrouter" ||
    !node.selected_model ||
    node.selected_route_kind !== "video"
  ) {
    return {
      ok: false as const,
      status: 409,
      error:
        "This planned route is not in the currently enabled one-shot OpenRouter video execution slice.",
    };
  }

  const plan = planMediaRequest(workflow.objective);
  if (!plan || plan.kind !== "video" || plan.clarification) {
    return {
      ok: false as const,
      status: 409,
      error:
        "The workflow objective no longer resolves to an executable video request.",
    };
  }

  const connectedOpenRouter =
    await businessOwnedServiceCredentialForOwner(
      input.ownerRef,
      "openrouter-api",
    );
  const usingConnectedCredential = Boolean(connectedOpenRouter?.credential);
  const catalog = await openRouterMediaCatalog(
    true,
    connectedOpenRouter?.credential || undefined,
  );

  const remainingBudgetUsd = Math.max(
    0,
    (workflow.max_spend_microusd -
      workflow.actual_spend_microusd -
      workflow.reserved_spend_microusd) /
      1_000_000,
  );

  const adultClass = adultMediaContentClass(workflow.objective);
  const workflowUserId = userIdFromOwnerRef(input.ownerRef);
  const mediaPreference = workflowUserId
    ? await mediaContentPreferenceForUser(workflowUserId)
    : { preference: "sfw_only" as const, adultContentAcknowledgedAt: null };
  const recommendations = await buildMediaRecommendationOptions({
    plan,
    openRouterCatalog: catalog,
    currentCapUsd: remainingBudgetUsd,
    localImageAvailable: false,
    requiresReferenceImage: false,
    contentPreference: mediaPreference.preference,
    adultOutputRequested: adultClass !== "sfw",
    adultContentClass: adultClass,
    cooperativeManagedOpenRouter: !usingConnectedCredential,
  });
  const selected = exactPlannedRoute(recommendations.options, node);

  if (!selected || selected.executionReady === false) {
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      reason:
        "The previously planned video route is no longer eligible in the live catalog/registry/policy checks. Re-plan before approving generation.",
      resultPatch: {
        routeRevalidation: "failed",
        availableOptions: recommendations.options.map((option) => ({
          tier: option.tier,
          provider: option.provider,
          model: option.model,
          capUsd: option.capUsd,
          executionReady: option.executionReady,
        })),
      },
    });
    return {
      ok: false as const,
      status: 409,
      error: "The planned video route changed and requires a fresh approval.",
    };
  }

  const currentQuoteMicrousd = microusd(selected.capUsd);
  const priorQuoteMicrousd = Math.max(
    0,
    Number(node.estimated_cost_microusd || 0),
  );
  if (currentQuoteMicrousd > priorQuoteMicrousd) {
    const admin = createAdminSupabaseClient();
    await admin
      .from("agent_workflow_nodes")
      .update({
        estimated_cost_microusd: currentQuoteMicrousd,
        result: {
          ...(node.result || {}),
          quotedCapUsd: selected.capUsd,
          estimatedCostUsd: selected.estimatedCostUsd,
          providerCostEstimateUsd: selected.providerCostEstimateUsd,
          pricingSource: selected.pricingSource,
          recipe: selected.recipe,
          routeRevalidation: "price-increased",
          executionEnabled: false,
          generationSent: false,
          reason:
            "The live video quote increased after planning. The route was not executed; approve the updated quote separately.",
        },
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id)
      .eq("status", "needs_approval");

    return {
      ok: false as const,
      status: 409,
      error: "The live video quote increased and requires a fresh approval.",
      updatedQuoteUsd: selected.capUsd,
    };
  }

  const userId = userIdFromOwnerRef(input.ownerRef);
  if (!userId) {
    return {
      ok: false as const,
      status: 403,
      error: "This workflow owner cannot pass the execution-time media content gate.",
    };
  }

  const gate = await evaluateMediaExecutionContentGate({
    userId,
    ownerRef: input.ownerRef,
    provider: selected.provider,
    model: selected.model,
    endpoint: selected.editEndpoint,
    adultContentClass: adultClass,
  });
  if (!gate.allowed) {
    const admin = createAdminSupabaseClient();
    await admin
      .from("agent_workflow_nodes")
      .update({
        status: "failed",
        result: {
          ...(node.result || {}),
          executionEnabled: false,
          generationSent: false,
          contentGate: gate,
        },
        error: gate.note.slice(0, 2000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("status", "needs_approval");

    return { ok: false as const, status: 409, error: gate.note };
  }

  const admin = createAdminSupabaseClient();
  const { data: reserved, error: reserveError } = await admin.rpc(
    "reserve_agent_workflow_node_budget",
    {
      p_owner_ref: input.ownerRef,
      p_workflow_id: workflow.id,
      p_node_id: node.id,
      p_amount_microusd: currentQuoteMicrousd,
    },
  );
  if (reserveError) throw reserveError;
  if (reserved !== true) {
    return {
      ok: false as const,
      status: 409,
      error:
        "The shared workflow budget changed before this video approval could be reserved.",
    };
  }

  const providerCredential =
    connectedOpenRouter?.credential ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    null;
  if (!providerCredential) {
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      reason: "No OpenRouter credential is available for the approved video route.",
    });
    return {
      ok: false as const,
      status: 409,
      error: "OpenRouter credential unavailable.",
    };
  }

  const cooperativeFunded =
    !usingConnectedCredential &&
    selected.providerCostEstimateUsd > 0 &&
    currentQuoteMicrousd > 0;

  let profileReservationId: string | null = null;
  if (cooperativeFunded) {
    const profileRef = profileRefFromAiOwnerRef(input.ownerRef);
    if (!profileRef) {
      await moveBackToApproval({
        ownerRef: input.ownerRef,
        workflowId: workflow.id,
        nodeId: node.id,
        reason: "This workflow does not map to a CoOperative AI balance profile.",
      });
      return {
        ok: false as const,
        status: 409,
        error: "AI balance profile unavailable.",
      };
    }

    const profileReservation = await reserveAiProfileFunds({
      profileRef,
      estimatedCostUsd: currentQuoteMicrousd / 1_000_000,
      source: "agent-workflow-video",
      referenceId: node.id,
      metadata: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        provider: selected.provider,
        model: selected.model,
        quotedUserPriceUsd: currentQuoteMicrousd / 1_000_000,
        providerCostEstimateUsd: selected.providerCostEstimateUsd,
        oneShot: true,
        kind: "video",
      },
    });

    if (!profileReservation) {
      const balance = await aiProfileBalanceForOwnerRef(input.ownerRef);
      await moveBackToApproval({
        ownerRef: input.ownerRef,
        workflowId: workflow.id,
        nodeId: node.id,
        reason:
          "The CoOperative AI balance is too low to reserve the approved video generation.",
        resultPatch: {
          availableAiBalanceUsd: balance?.availableUsd ?? null,
          requiredQuoteUsd: currentQuoteMicrousd / 1_000_000,
        },
      });
      return {
        ok: false as const,
        status: 409,
        error: "Insufficient CoOperative AI balance for this approved video route.",
      };
    }
    profileReservationId = profileReservation.id;
  }

  const jobId = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  const generationPrompt = videoPromptForSelection(
    workflow.objective,
    plan,
    selected,
  );

  const { error: insertError } = await admin
    .from("media_generation_jobs")
    .insert({
      id: jobId,
      status: "queued",
      request_root_job_id: jobId,
      route_attempt: 1,
      execution_mode: "workflow-hermes-one-shot",
      owner_ref: input.ownerRef,
      conversation_id: null,
      kind: "video",
      prompt: generationPrompt,
      provider: "openrouter",
      model: selected.model,
      model_mixer: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        preset: workflow.preset,
        approvedOneShot: true,
        noRetry: true,
        selectedScorecard: selected.scorecard,
      },
      request_max_spend_microusd: currentQuoteMicrousd,
      media_level:
        workflow.preset === "premium"
          ? 4
          : workflow.preset === "balanced"
            ? 2
            : 0,
      estimated_provider_cost_microusd: microusd(
        selected.providerCostEstimateUsd,
      ),
      estimated_user_charge_microusd: cooperativeFunded
        ? currentQuoteMicrousd
        : 0,
      estimated_margin_microusd: cooperativeFunded
        ? Math.max(
            0,
            currentQuoteMicrousd -
              microusd(selected.providerCostEstimateUsd),
          )
        : null,
      billing_mode: cooperativeFunded
        ? "cooperative-balance"
        : usingConnectedCredential
          ? "openrouter-byok"
          : null,
      provider_cost_bearer: cooperativeFunded
        ? "cooperative"
        : usingConnectedCredential
          ? "user-connected"
          : "free",
      ai_balance_reservation_id: profileReservationId,
      pricing_dimensions: {
        workflowId: workflow.id,
        workflowNodeId: node.id,
        approvedOneShot: true,
        noAutomaticRetry: true,
        durationSeconds: selected.recipe.durationSeconds,
        aspectRatio: selected.recipe.aspectRatio,
        resolution: selected.recipe.resolution,
        audio: selected.recipe.audio,
        quotedWorkflowBudgetUsd: currentQuoteMicrousd / 1_000_000,
        quotedUserPriceUsd: cooperativeFunded
          ? currentQuoteMicrousd / 1_000_000
          : 0,
        providerCostEstimateUsd: selected.providerCostEstimateUsd,
        pricingSource: selected.pricingSource,
        directProvider: false,
      },
      pricing_source: selected.pricingSource,
      created_at: queuedAt,
      updated_at: queuedAt,
    });

  if (insertError) {
    if (profileReservationId) {
      await releaseAiProfileFunds({
        reservationId: profileReservationId,
        metadata: {
          reason: "workflow-video-job-insert-failed",
          workflowId: workflow.id,
        },
      }).catch(() => undefined);
    }
    await moveBackToApproval({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      reason:
        "The approved video job could not be created, so no generation request was sent.",
    });
    throw insertError;
  }

  await admin
    .from("agent_workflow_nodes")
    .update({
      child_media_job_id: jobId,
      result: {
        ...(node.result || {}),
        executionEnabled: true,
        generationSent: false,
        approvedAt: queuedAt,
        mediaJobId: jobId,
        oneShot: true,
        noAutomaticRetry: true,
        recipe: selected.recipe,
        billingMode: cooperativeFunded
          ? "cooperative-balance"
          : usingConnectedCredential
            ? "openrouter-byok"
            : "free",
      },
      error: null,
      updated_at: queuedAt,
    })
    .eq("id", node.id)
    .eq("status", "running");

  try {
    const started = await startHermesMediaTask({
      jobId,
      kind: "video",
      userRequest: generationPrompt,
      provider: "openrouter",
      model: selected.model,
      providerCredential,
    });

    const { error: startUpdateError } = await admin
      .from("media_generation_jobs")
      .update({
        status: "running",
        sandbox_name: started.sandboxName,
        started_at: started.startedAt,
        deadline_at: started.deadlineAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("owner_ref", input.ownerRef)
      .eq("status", "queued");
    if (startUpdateError) throw startUpdateError;

    await admin
      .from("agent_workflow_nodes")
      .update({
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: true,
          approvedAt: queuedAt,
          mediaJobId: jobId,
          oneShot: true,
          noAutomaticRetry: true,
          recipe: selected.recipe,
          billingMode: cooperativeFunded
            ? "cooperative-balance"
            : usingConnectedCredential
              ? "openrouter-byok"
              : "free",
        },
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id)
      .eq("status", "running");

    return {
      ok: true as const,
      status: 202,
      jobId,
      provider: "openrouter",
      model: selected.model,
      billingMode: cooperativeFunded
        ? "cooperative-balance"
        : usingConnectedCredential
          ? "openrouter-byok"
          : "free",
      quotedBudgetUsd: currentQuoteMicrousd / 1_000_000,
      message:
        "The approved one-shot video generation started. No automatic retry or fallback is enabled.",
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "The approved video generation could not start.";
    const completedAt = new Date().toISOString();

    if (profileReservationId) {
      await releaseAiProfileFunds({
        reservationId: profileReservationId,
        metadata: {
          reason: "workflow-video-did-not-start",
          workflowId: workflow.id,
          workflowNodeId: node.id,
          jobId,
        },
      }).catch(() => undefined);
    }
    await releaseWorkflowBudget({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
    });

    await admin
      .from("media_generation_jobs")
      .update({
        status: "failed",
        error: detail.slice(0, 1200),
        ai_balance_reservation_id: null,
        actual_user_charge_microusd: 0,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId)
      .eq("owner_ref", input.ownerRef);

    await admin
      .from("agent_workflow_nodes")
      .update({
        status: "failed",
        budget_reserved_microusd: 0,
        actual_cost_microusd: 0,
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: false,
          oneShot: true,
          noAutomaticRetry: true,
          mediaJobId: jobId,
          provider: "openrouter",
          model: selected.model,
          error: detail,
        },
        error: detail.slice(0, 2000),
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id);

    return {
      ok: false as const,
      status: 502,
      error:
        "The approved one-shot video could not start. No retry or fallback was started.",
      providerError: detail,
      jobId,
    };
  }
}

export async function syncWorkflowMediaNode(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
}) {
  const state = await loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
  if (!state) return null;

  const { workflow, node } = state;
  if (
    node.node_kind !== "media" ||
    !["image-generation", "video-generation"].includes(node.task_type) ||
    !node.child_media_job_id ||
    !["queued", "running"].includes(node.status)
  ) {
    return state;
  }

  const admin = createAdminSupabaseClient();
  const { data: job, error: jobError } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,provider,model,sandbox_name,deadline_at,result_url,result_text,usage,error,billing_mode,ai_balance_reservation_id,estimated_user_charge_microusd,estimated_provider_cost_microusd,pricing_dimensions",
    )
    .eq("id", node.child_media_job_id)
    .eq("owner_ref", input.ownerRef)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return state;

  let current = job;

  if (
    node.task_type === "video-generation" &&
    current.status === "running" &&
    current.sandbox_name &&
    current.deadline_at
  ) {
    const polled = await pollHermesMediaTask({
      sandboxName: current.sandbox_name,
      deadlineAt: current.deadline_at,
    });

    if (polled.state === "running") return state;

    const completedAt = new Date().toISOString();

    if (polled.state === "completed" && polled.mediaUrl) {
      const resultText =
        "Generated video with " +
        current.model +
        ".\nMEDIA_VIDEO:" +
        polled.mediaUrl;

      const { data: claimed, error: completeError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "completed",
          result_url: polled.mediaUrl,
          result_text: resultText,
          usage: polled.usage,
          error: null,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", current.id)
        .eq("owner_ref", input.ownerRef)
        .eq("status", "running")
        .select(
          "id,status,provider,model,sandbox_name,deadline_at,result_url,result_text,usage,error,billing_mode,ai_balance_reservation_id,estimated_user_charge_microusd,estimated_provider_cost_microusd,pricing_dimensions",
        )
        .maybeSingle();
      if (completeError) throw completeError;
      if (claimed) current = claimed;
    } else {
      const failure =
        polled.error || "The one-shot workflow video generation failed.";
      if (
        current.billing_mode === "cooperative-balance" &&
        current.ai_balance_reservation_id
      ) {
        await releaseAiProfileFunds({
          reservationId: current.ai_balance_reservation_id,
          metadata: {
            reason: "workflow-one-shot-video-failed",
            workflowId: workflow.id,
            workflowNodeId: node.id,
            jobId: current.id,
          },
        }).catch(() => undefined);
      }
      await releaseWorkflowBudget({
        ownerRef: input.ownerRef,
        workflowId: workflow.id,
        nodeId: node.id,
      });

      const outcome = classifyMediaRouteOutcome({
        detail: failure,
        status: 0,
        failureStage: "post-provider",
      });
      await recordMediaRouteOutcome({
        ownerRef: input.ownerRef,
        sourceJobId: current.id,
        provider: current.provider,
        model: current.model,
        executionMode: "workflow-hermes-one-shot",
        requestShape: "video-text",
        outcomeKind: outcome.kind,
        detail: failure,
        blocksRoute: outcome.kind === "capability-refusal",
      }).catch(() => undefined);

      const adultClass = adultMediaContentClass(workflow.objective);
      if (outcome.kind === "provider-policy") {
        await recordMediaRuntimePolicyRefusal({
          ownerRef: input.ownerRef,
          provider: current.provider,
          model: current.model,
          endpoint: null,
          sourceJobId: current.id,
          requestedClass: adultClass,
          detail: failure,
        }).catch(() => undefined);
      }

      await admin
        .from("media_generation_jobs")
        .update({
          status: "failed",
          usage: polled.usage,
          error: failure.slice(0, 1200),
          ai_balance_reservation_id: null,
          actual_user_charge_microusd: 0,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", current.id)
        .eq("owner_ref", input.ownerRef);

      await admin
        .from("agent_workflow_nodes")
        .update({
          status: "failed",
          budget_reserved_microusd: 0,
          actual_cost_microusd: 0,
          result: {
            ...(node.result || {}),
            executionEnabled: true,
            generationSent: true,
            oneShot: true,
            noAutomaticRetry: true,
            mediaJobId: current.id,
            provider: current.provider,
            model: current.model,
            outcomeKind: outcome.kind,
            error: failure,
          },
          error: failure.slice(0, 2000),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", node.id)
        .eq("workflow_id", workflow.id);

      return loadWorkflowMediaNode(
        input.ownerRef,
        input.workflowId,
        input.nodeId,
      );
    }
  }

  if (
    node.task_type === "image-generation" &&
    current.status === "running"
  ) {
    const nodeResult =
      node.result && typeof node.result === "object" ? node.result : {};
    const pending =
      nodeResult.pendingDirectResult &&
      typeof nodeResult.pendingDirectResult === "object" &&
      !Array.isArray(nodeResult.pendingDirectResult)
        ? (nodeResult.pendingDirectResult as Record<string, unknown>)
        : null;

    const mediaUrl =
      pending && typeof pending.mediaUrl === "string"
        ? pending.mediaUrl
        : null;
    const resultText =
      pending && typeof pending.resultText === "string"
        ? pending.resultText
        : null;
    const storagePath =
      pending && typeof pending.storagePath === "string"
        ? pending.storagePath
        : null;
    const mimeType =
      pending && typeof pending.mimeType === "string"
        ? pending.mimeType
        : null;
    const completedAt =
      pending && typeof pending.completedAt === "string"
        ? pending.completedAt
        : new Date().toISOString();
    const pendingUsage =
      pending &&
      pending.usage &&
      typeof pending.usage === "object" &&
      !Array.isArray(pending.usage)
        ? pending.usage
        : null;

    if (mediaUrl && resultText && storagePath && mimeType) {
      const pricingDimensions =
        current.pricing_dimensions &&
        typeof current.pricing_dimensions === "object" &&
        !Array.isArray(current.pricing_dimensions)
          ? (current.pricing_dimensions as Record<string, unknown>)
          : {};

      const { data: recovered, error: recoveryError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "completed",
          result_url: mediaUrl,
          result_text: resultText,
          usage: pendingUsage,
          pricing_dimensions: {
            ...pricingDimensions,
            generatedStoragePath: storagePath,
            generatedMimeType: mimeType,
            directProvider: true,
            reconciliationRecovered: true,
          },
          error: null,
          completed_at: completedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .eq("owner_ref", input.ownerRef)
        .eq("status", "running")
        .select(
          "id,status,provider,model,sandbox_name,deadline_at,result_url,result_text,usage,error,billing_mode,ai_balance_reservation_id,estimated_user_charge_microusd,estimated_provider_cost_microusd,pricing_dimensions",
        )
        .maybeSingle();

      if (recoveryError) throw recoveryError;
      if (recovered) current = recovered;
    }
  }

  if (current.status === "completed" && current.result_url) {
    const quotedMicrousd = Math.max(
      0,
      Number(current.estimated_user_charge_microusd || 0),
    );
    const workflowActualMicrousd =
      node.budget_reserved_microusd > 0
        ? node.budget_reserved_microusd
        : Math.max(0, Number(node.estimated_cost_microusd || 0));

    if (
      current.billing_mode === "cooperative-balance" &&
      current.ai_balance_reservation_id
    ) {
      await settleAiProfileFunds({
        reservationId: current.ai_balance_reservation_id,
        actualCostUsd: quotedMicrousd / 1_000_000,
        metadata: {
          workflowId: workflow.id,
          workflowNodeId: node.id,
          jobId: current.id,
          outcome: "completed",
          provider: current.provider,
          model: current.model,
          kind:
            node.task_type === "video-generation" ? "video" : "image",
          oneShot: true,
        },
      });
    }

    await settleWorkflowBudget({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
      actualMicrousd: workflowActualMicrousd,
    });

    const { error: billingUpdateError } = await admin
      .from("media_generation_jobs")
      .update({
        billed_microusd:
          current.billing_mode === "cooperative-balance"
            ? quotedMicrousd
            : 0,
        actual_user_charge_microusd:
          current.billing_mode === "cooperative-balance"
            ? quotedMicrousd
            : 0,
        actual_provider_cost_microusd: Math.max(
          0,
          Number(current.estimated_provider_cost_microusd || 0),
        ),
        actual_margin_microusd:
          current.billing_mode === "cooperative-balance"
            ? Math.max(
                0,
                quotedMicrousd -
                  Math.max(
                    0,
                    Number(current.estimated_provider_cost_microusd || 0),
                  ),
              )
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .eq("owner_ref", input.ownerRef);
    if (billingUpdateError) throw billingUpdateError;

    const completedAt = new Date().toISOString();
    const { error: nodeCompleteError } = await admin
      .from("agent_workflow_nodes")
      .update({
        status: "completed",
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: true,
          oneShot: true,
          noAutomaticRetry: true,
          mediaJobId: current.id,
          mediaUrl: current.result_url,
          text: current.result_text,
          provider: current.provider,
          model: current.model,
          quotedBudgetUsd: workflowActualMicrousd / 1_000_000,
          chargedCoOperativeBalanceUsd:
            current.billing_mode === "cooperative-balance"
              ? quotedMicrousd / 1_000_000
              : 0,
          billingMode: current.billing_mode || "free",
          usage: current.usage,
          reconciliationPending: false,
          pendingDirectResult: null,
        },
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id);
    if (nodeCompleteError) throw nodeCompleteError;

    return loadWorkflowMediaNode(
      input.ownerRef,
      input.workflowId,
      input.nodeId,
    );
  }

  if (current.status === "failed") {
    if (
      current.billing_mode === "cooperative-balance" &&
      current.ai_balance_reservation_id
    ) {
      await releaseAiProfileFunds({
        reservationId: current.ai_balance_reservation_id,
        metadata: {
          reason: "workflow-video-job-failed",
          workflowId: workflow.id,
          workflowNodeId: node.id,
          jobId: current.id,
        },
      }).catch(() => undefined);
    }
    await releaseWorkflowBudget({
      ownerRef: input.ownerRef,
      workflowId: workflow.id,
      nodeId: node.id,
    });

    const completedAt = new Date().toISOString();
    await admin
      .from("agent_workflow_nodes")
      .update({
        status: "failed",
        budget_reserved_microusd: 0,
        actual_cost_microusd: 0,
        result: {
          ...(node.result || {}),
          executionEnabled: true,
          generationSent: true,
          oneShot: true,
          noAutomaticRetry: true,
          mediaJobId: current.id,
          provider: current.provider,
          model: current.model,
          error: current.error || "Workflow video failed.",
        },
        error: (current.error || "Workflow video failed.").slice(0, 2000),
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", node.id)
      .eq("workflow_id", workflow.id);
  }

  return loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
}

export async function approveAndExecuteWorkflowMedia(input: {
  ownerRef: string;
  workflowId: string;
  nodeId: string;
}) {
  const state = await loadWorkflowMediaNode(
    input.ownerRef,
    input.workflowId,
    input.nodeId,
  );
  if (!state) {
    return {
      ok: false as const,
      status: 404,
      error: "Workflow media node not found.",
    };
  }

  if (state.node.task_type === "image-generation") {
    return approveAndExecuteWorkflowMediaImage(input);
  }
  if (state.node.task_type === "video-generation") {
    return approveAndStartWorkflowMediaVideo(input);
  }

  return {
    ok: false as const,
    status: 409,
    error: "This workflow media node type is not executable in the current rollout.",
  };
}
