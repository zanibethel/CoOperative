import type { AssessmentResult, BusinessIntake } from "@/lib/domain/schemas";

const effortScore = { low: 18, medium: 10, high: 3 } as const;
const riskPenalty = { low: 0, medium: 8, high: 18 } as const;

function score(hours: number, effort: keyof typeof effortScore, risk: keyof typeof riskPenalty) {
  const value = Math.min(60, hours * 3);
  return Math.max(0, Math.min(100, Math.round(value + effortScore[effort] - riskPenalty[risk] + 16)));
}

export function deriveDemoAssessment(input: BusinessIntake): AssessmentResult {
  const combined = [input.tools, input.dailyWork, input.repetitiveWork, input.websiteAndInquiryFlow, input.marketingAndSocial, input.bookingAndScheduling].join(" ").toLowerCase();
  const mentionsScheduling = /calendar|booking|schedule|appointment|reservation/.test(combined);
  const mentionsEmail = /email|gmail|outlook|inbox|message|text|dm|facebook|instagram/.test(combined);
  const mentionsInvoices = /invoice|billing|payment|stripe|quickbooks|rent|collect/.test(combined);
  const needsWebsite = /no website|need website|facebook only|instagram only|dm only|phone only/.test(input.websiteAndInquiryFlow.toLowerCase()) || (!input.websiteAndInquiryFlow.trim() && /facebook|instagram|phone|walk-in/.test(input.leadSources.toLowerCase()));
  const hasSocialWork = input.marketingAndSocial.trim().length > 15 || /facebook|instagram|tiktok|linkedin|social|post|content/.test(combined);

  const processes: AssessmentResult["processes"] = [
    { name: "Lead to customer", purpose: "Turn interest into a booked or paying customer.", steps: [
      { name: "Lead arrives", actor: "customer", manual: false },
      { name: "Lead is reviewed", actor: "employee", manual: true },
      { name: "Response is prepared", actor: "employee", manual: true },
      { name: mentionsScheduling ? "Appointment is scheduled" : "Next step is agreed", actor: "customer", manual: true },
    ]},
    { name: "Service delivery", purpose: "Complete the core work the customer is paying for.", steps: [
      { name: "Work is assigned", actor: "manager", manual: true },
      { name: "Work is completed", actor: "employee", manual: true },
      { name: "Completion is recorded", actor: "employee", manual: true },
    ]},
    { name: "Customer follow-up", purpose: "Make sure unfinished, unpaid, or repeat-business opportunities are not lost.", steps: [
      { name: "Follow-up becomes due", actor: "system", manual: false },
      { name: "Customer history is checked", actor: "employee", manual: true },
      { name: "Follow-up is written", actor: "employee", manual: true },
      { name: "Response is handled", actor: "employee", manual: true },
    ]},
  ];

  const opportunities: AssessmentResult["opportunities"] = [];

  if (mentionsEmail || input.repetitiveWork.length > 20) {
    const hours = Math.max(6, Math.round(input.teamSize * 2.5));
    opportunities.push({ title: "Routine inquiry triage and draft replies", currentProblem: "Employees repeatedly read, categorize, and respond to similar inbound requests.", proposedAutomation: "Classify inbound messages, gather relevant context, draft a response, and escalate exceptions or sensitive cases.", humanRole: "Approve high-risk replies and handle exceptions; low-risk replies can later graduate to auto-send.", estimatedHoursSavedPerMonth: hours, implementationEffort: "medium", riskLevel: "medium", confidence: 0.82, priorityScore: score(hours, "medium", "medium") });
  }

  if (mentionsScheduling) {
    const hours = Math.max(4, Math.round(input.teamSize * 1.5));
    opportunities.push({ title: "Scheduling and reminder workflow", currentProblem: "Scheduling changes, reminders, confirmations, and openings create repeated administrative work.", proposedAutomation: "Use the simplest suitable calendar/booking stack, send reminders, detect cancellations, and trigger a configurable opening-fill workflow.", humanRole: "Define scheduling rules and resolve unusual conflicts.", estimatedHoursSavedPerMonth: hours, implementationEffort: "low", riskLevel: "low", confidence: 0.88, priorityScore: score(hours, "low", "low") });
  }

  if (mentionsInvoices) {
    const hours = Math.max(3, Math.round(input.teamSize * 1.1));
    opportunities.push({ title: "Payment and overdue follow-up", currentProblem: "Staff spend time checking payment state and remembering when to follow up.", proposedAutomation: "Watch payment status, trigger staged reminders, and route disputed or unusual accounts to a person.", humanRole: "Handle disputes, exceptions, refunds, and relationship-sensitive accounts.", estimatedHoursSavedPerMonth: hours, implementationEffort: "medium", riskLevel: "medium", confidence: 0.76, priorityScore: score(hours, "medium", "medium") });
  }

  if (needsWebsite) {
    const hours = Math.max(4, Math.round(input.teamSize * 1.2));
    opportunities.push({ title: "Owned customer inquiry funnel", currentProblem: "New inquiries depend on channels or manual conversations that can lose context and require repeated back-and-forth.", proposedAutomation: "Create a lightweight owned website or landing flow with structured intake, qualification, direct routing, and optional scheduling so the business only pays for external services that add real value.", humanRole: "Approve public content, service rules, pricing language, and exceptions.", estimatedHoursSavedPerMonth: hours, implementationEffort: "medium", riskLevel: "low", confidence: 0.73, priorityScore: score(hours, "medium", "low") });
  }

  if (hasSocialWork) {
    const hours = Math.max(5, Math.round(input.teamSize * 1.4));
    opportunities.push({ title: "Social content planning and publishing pipeline", currentProblem: "Content ideation, rewriting, approvals, scheduling, and cross-posting consume recurring time and are easy to do inconsistently.", proposedAutomation: "Generate an approved content queue from business goals and real activity, adapt posts per channel, require configured approvals, and publish through supported APIs or scheduling tools when cost-effective.", humanRole: "Set brand rules, approve sensitive campaigns, and review performance before the system expands autonomy.", estimatedHoursSavedPerMonth: hours, implementationEffort: "medium", riskLevel: "medium", confidence: 0.71, priorityScore: score(hours, "medium", "medium") });
  }

  const genericHours = Math.max(5, Math.round(input.teamSize * 1.8));
  opportunities.push({ title: "Recurring admin checklist automation", currentProblem: `The business reports repetitive work: ${input.repetitiveWork.slice(0, 180)}${input.repetitiveWork.length > 180 ? "…" : ""}`, proposedAutomation: "Convert the recurring sequence into an explicit workflow with event triggers, task ownership, deadlines, and exception handling.", humanRole: "Own exceptions and periodically review whether the workflow still matches reality.", estimatedHoursSavedPerMonth: genericHours, implementationEffort: "low", riskLevel: "low", confidence: 0.72, priorityScore: score(genericHours, "low", "low") });

  opportunities.sort((a, b) => b.priorityScore - a.priorityScore);

  const costLanguage = input.costPriority === "lowest-cost" ? "Recommendations should prefer owned or low-cost infrastructure before adding paid SaaS." : input.costPriority === "best-fit" ? "Recommendations may favor higher-cost tools when they clearly provide the best operational fit." : "Recommendations should balance ongoing cost, reliability, and implementation effort.";

  return {
    businessSummary: `${input.businessName} is a ${input.industry} business with approximately ${input.teamSize} team member${input.teamSize === 1 ? "" : "s"}. The first assessment focuses on repetitive coordination, communication, scheduling, customer acquisition, and follow-up work rather than automating judgment-heavy decisions. ${costLanguage}`,
    processes,
    opportunities,
  };
}
