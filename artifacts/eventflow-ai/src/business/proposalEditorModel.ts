export type PlanKey = "A" | "B";

export type ProposalPlanContent = {
  id: PlanKey;
  title: string;
  concept: string;
  theme: string;
  timeline: { time: string; activity: string }[];
  venue: { name: string; setup: string };
  catering: string;
  services: string[];
  costBreakdown: { item: string; description: string; amountMYR: number }[];
  totalEstimatedMYR: number;
  assumptions: string[];
  unconfirmedCosts: string[];
};

export type ProposalPlanDraft = Omit<ProposalPlanContent, "costBreakdown"> & {
  original: Record<string, unknown>;
  costBreakdown: { item: string; description: string; amountMYR: string }[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Saved proposal ${label} is missing or invalid.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Saved proposal ${label} is missing or invalid.`);
  }
  return [...value];
}

export function createProposalPlanDraft(value: unknown, planKey: PlanKey): ProposalPlanDraft {
  if (!record(value) || value.id !== planKey || !record(value.venue)
    || !Array.isArray(value.timeline) || !Array.isArray(value.costBreakdown)) {
    throw new Error(`Saved Plan ${planKey} is incomplete and cannot be edited safely.`);
  }
  const total = Number(value.totalEstimatedMYR);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`Saved Plan ${planKey} has an invalid total.`);
  }
  const timeline = value.timeline.map((item) => {
    if (!record(item)) throw new Error(`Saved Plan ${planKey} has an invalid timeline.`);
    return { time: requiredString(item.time, "timeline time"), activity: requiredString(item.activity, "timeline activity") };
  });
  const costBreakdown = value.costBreakdown.map((item) => {
    if (!record(item)) throw new Error(`Saved Plan ${planKey} has an invalid cost breakdown.`);
    const amountMYR = Number(item.amountMYR);
    if (!Number.isFinite(amountMYR) || amountMYR < 0) {
      throw new Error(`Saved Plan ${planKey} has an invalid cost amount.`);
    }
    return {
      item: requiredString(item.item, "cost item"),
      description: requiredString(item.description, "cost description"),
      amountMYR: String(amountMYR),
    };
  });
  return {
    original: { ...value },
    id: planKey,
    title: requiredString(value.title, "title"),
    concept: requiredString(value.concept, "concept"),
    theme: requiredString(value.theme, "theme"),
    timeline,
    venue: {
      name: requiredString(value.venue.name, "venue name"),
      setup: requiredString(value.venue.setup, "venue setup"),
    },
    catering: requiredString(value.catering, "catering"),
    services: stringArray(value.services, "services"),
    costBreakdown,
    totalEstimatedMYR: total,
    assumptions: stringArray(value.assumptions, "assumptions"),
    unconfirmedCosts: stringArray(value.unconfirmedCosts, "unconfirmed costs"),
  };
}

export function buildProposalPlanContent(draft: ProposalPlanDraft): ProposalPlanContent {
  const text = (value: string, label: string, max: number) => {
    const cleaned = value.trim();
    if (!cleaned || cleaned.length > max) throw new Error(`${label} is required and must be at most ${max} characters.`);
    return cleaned;
  };
  if (draft.timeline.length < 1 || draft.timeline.length > 40
    || draft.services.length < 1 || draft.services.length > 40
    || draft.costBreakdown.length < 1 || draft.costBreakdown.length > 80
    || draft.assumptions.length < 1 || draft.assumptions.length > 30
    || draft.unconfirmedCosts.length > 30) {
    throw new Error("Keep at least one timeline item, service, cost, and assumption; remove any excess rows.");
  }

  const timeline = draft.timeline.map((item) => ({
    time: text(item.time, "Timeline time", 80),
    activity: text(item.activity, "Timeline activity", 500),
  }));
  const services = draft.services.map((service) => text(service, "Service", 200));
  const costBreakdown = draft.costBreakdown.map((item) => {
    const amount = Number(item.amountMYR);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
      throw new Error("Each cost must be a valid nonnegative MYR amount.");
    }
    const amountMYR = Math.round((amount + Number.EPSILON * Math.abs(amount)) * 100) / 100;
    return {
      item: text(item.item, "Cost item", 160),
      description: text(item.description, "Cost description", 500),
      amountMYR,
    };
  });
  const totalCents = costBreakdown.reduce((sum, item) => sum + Math.round(item.amountMYR * 100), 0);
  const totalEstimatedMYR = totalCents / 100;
  if (totalEstimatedMYR > 100_000_000) throw new Error("The proposal total exceeds the supported amount.");

  const content: ProposalPlanContent = {
    ...draft.original,
    id: draft.id,
    title: text(draft.title, "Title", 160),
    concept: text(draft.concept, "Concept", 2_000),
    theme: text(draft.theme, "Theme", 500),
    timeline,
    venue: {
      name: text(draft.venue.name, "Venue name", 240),
      setup: text(draft.venue.setup, "Venue setup", 2_000),
    },
    catering: text(draft.catering, "Catering", 2_000),
    services,
    costBreakdown,
    totalEstimatedMYR,
    assumptions: draft.assumptions.map((item) => text(item, "Assumption", 1_000)),
    unconfirmedCosts: draft.unconfirmedCosts.map((item) => text(item, "Unconfirmed cost", 1_000)),
  };
  return content;
}
