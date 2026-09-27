import { z } from "zod";

export const WorkLocationModeSchema = z.enum(["remote", "local", "either"]);
export type WorkLocationMode = z.infer<typeof WorkLocationModeSchema>;

export const WorkerProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  devices: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  locationMode: WorkLocationModeSchema.default("remote"),
  minimumHourlyRateCents: z.number().int().min(0).max(100_000),
  preferredTaskMinutes: z.number().int().min(1).max(480).default(30),
  blockedCategories: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  notificationsEnabled: z.boolean().default(true),
});
export type WorkerProfile = z.infer<typeof WorkerProfileSchema>;

export const HumanStepInputKindSchema = z.enum([
  "open_link",
  "yes_no",
  "confirm",
  "text",
  "photo",
]);
export type HumanStepInputKind = z.infer<typeof HumanStepInputKindSchema>;

export const HumanWorkStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  instruction: z.string().min(1).max(1000),
  inputKind: HumanStepInputKindSchema,
  externalUrl: z.string().url().nullable().default(null),
  helpText: z.string().max(1000).default(""),
});
export type HumanWorkStep = z.infer<typeof HumanWorkStepSchema>;

export const HumanWorkOrderSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  compensationCents: z.number().int().min(1),
  estimatedMinutes: z.number().int().min(1).max(480),
  deadlineLabel: z.string().min(1).max(120),
  requirements: z.array(z.string()).max(20).default([]),
  requiredDevices: z.array(z.string()).max(20).default([]),
  locationMode: WorkLocationModeSchema.default("remote"),
  testOnly: z.boolean().default(true),
  steps: z.array(HumanWorkStepSchema).min(1).max(30),
});
export type HumanWorkOrder = z.infer<typeof HumanWorkOrderSchema>;

export function effectiveHourlyRateCents(
  compensationCents: number,
  estimatedMinutes: number,
) {
  if (estimatedMinutes <= 0) return 0;
  return Math.round((compensationCents * 60) / estimatedMinutes);
}

export function workOrderMatchesProfile(
  profile: WorkerProfile,
  order: HumanWorkOrder,
) {
  if (
    order.locationMode !== "either" &&
    profile.locationMode !== "either" &&
    order.locationMode !== profile.locationMode
  ) {
    return false;
  }

  const availableDevices = new Set(profile.devices.map((device) => device.toLowerCase()));
  if (
    order.requiredDevices.some(
      (required) => !availableDevices.has(required.toLowerCase()),
    )
  ) {
    return false;
  }

  return (
    effectiveHourlyRateCents(order.compensationCents, order.estimatedMinutes) >=
    profile.minimumHourlyRateCents
  );
}

export const CREATORHUB_MOBILE_VERIFICATION: HumanWorkOrder =
  HumanWorkOrderSchema.parse({
    id: "creatorhub-mobile-verification-demo",
    title: "CreatorHub mobile verification",
    summary:
      "Check CreatorHub on an iPhone and record what a real person sees. CoOperative handles the setup; you only perform the human-visible checks.",
    compensationCents: 800,
    estimatedMinutes: 10,
    deadlineLabel: "Demo task · no real deadline",
    requirements: ["Comfortable using Safari", "Able to report what appears on screen"],
    requiredDevices: ["iPhone"],
    locationMode: "remote",
    testOnly: true,
    steps: [
      {
        id: "open",
        title: "Open CreatorHub",
        instruction:
          "Open the CreatorHub production domain in Safari. You are only checking what loads; do not change account or payment settings.",
        inputKind: "open_link",
        externalUrl: "https://creatorhub-gray.vercel.app",
        helpText:
          "If the site will not open, do not troubleshoot it. Record that it failed and continue.",
      },
      {
        id: "load",
        title: "Confirm the page loads",
        instruction:
          "Does the page finish loading without a blank screen, browser error, or obvious crash?",
        inputKind: "yes_no",
        helpText:
          "Choose No if the page is blank, stuck, or displays an error. That is useful evidence, not a failure on your part.",
      },
      {
        id: "mobile",
        title: "Check the phone layout",
        instruction:
          "Does the page fit your phone screen without important controls being cut off or forcing sideways scrolling?",
        inputKind: "yes_no",
        helpText:
          "Only judge what you can see. You are not expected to diagnose CSS or browser issues.",
      },
      {
        id: "evidence",
        title: "Save visual evidence",
        instruction:
          "Take a screenshot on your phone showing the page you checked. This demo does not upload the image yet; confirm once it is saved.",
        inputKind: "confirm",
        helpText:
          "Photo upload will be connected after the reviewed workforce storage/RLS schema is approved.",
      },
      {
        id: "note",
        title: "Add one short note",
        instruction:
          "Type the most important thing you noticed. If everything looked normal, write “No issues noticed.”",
        inputKind: "text",
        helpText:
          "One sentence is enough. CoOperative should never make a 10-minute task feel like paperwork.",
      },
    ],
  });
