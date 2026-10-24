import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type ProposalState = "AI Draft" | "Pending Business Approval" | "Approved for Customer" | "Changes Requested" | "Customer Accepted";
// Event status tracks the proposal workflow. These labels are shown to customers.
export type EventStatus = ProposalState;
export type Service = "Catering" | "Decoration" | "Photography" | "Venue Setup" | "Equipment";
export type ProposalCost = { name: string; detail: string; price: number; confirmed: boolean };
export type EventPlan = {
  id: "A" | "B";
  title: string;
  concept: string;
  theme: string;
  timeline: { time: string; activity: string }[];
  venue: { name: string; setup: string };
  catering: string;
  services: string[];
  costs: ProposalCost[];
  total: number;
  recommendation: string;
  assumptions: string[];
  unconfirmedCosts: string[];
};
export type EventProposal = {
  plans: [EventPlan, EventPlan];
  updatedAt: string;
  source: "mock" | "ai-service" | "persisted-ai";
  workflowStatus?: "Pending Business Approval" | "Approved for Customer" | "Changes Requested";
  proposalIds?: Partial<Record<"A" | "B", string>>;
  revision?: string;
};
export type CustomerEvent = {
  id: string; name: string; type: string; date: string; location: string; guests: number;
  budget: number; theme: string; services: Service[]; requirements: string;
  status: EventStatus; createdAt: string; proposal?: EventProposal; acceptedPlanId?: "A" | "B"; preferredPlanId?: "A" | "B"; requestSource?: "demo" | "supabase";
};
export type ChangeRequest = { id: string; eventId: string; message: string; createdAt: string };
export type ProposalGenerationInput = Pick<CustomerEvent, "name" | "type" | "date" | "location" | "guests" | "budget" | "theme" | "services" | "requirements">;
// Replace this mock implementation with a server-backed provider when available.
// No external AI service is connected by this interface yet.
export interface ProposalService {
  generate(input: ProposalGenerationInput, idempotencyKey?: string): Promise<EventProposal>;
  generatePersisted?(requestId: string): Promise<EventProposal>;
}
export const mockProposalService: ProposalService = {
  async generate() { throw new Error("Proposal generation is currently represented by labeled mock data."); },
};
type GeneratedProposalResponse = {
  recommendation: string;
  plans: [{
    id: "A" | "B"; title: string; concept: string; theme: string;
    timeline: { time: string; activity: string }[]; venue: { name: string; setup: string };
    catering: string; services: string[];
    costBreakdown: { item: string; description: string; amountMYR: number }[];
    totalEstimatedMYR: number; assumptions: string[]; unconfirmedCosts: string[];
  }, { id: "A" | "B"; title: string; concept: string; theme: string;
    timeline: { time: string; activity: string }[]; venue: { name: string; setup: string };
    catering: string; services: string[];
    costBreakdown: { item: string; description: string; amountMYR: number }[];
    totalEstimatedMYR: number; assumptions: string[]; unconfirmedCosts: string[];
  }];
};
type PersistedProposalRow = {
  plan_key: "A" | "B";
  proposal_id: string;
  status: string;
  recommendation: string;
  plan_content: GeneratedProposalResponse["plans"][number];
};
type PersistedProposalResponse = {
  requestId: string;
  revision: number;
  persistence: "created" | "existing";
  proposals: PersistedProposalRow[];
};
type SupabaseCustomerRequestRow = {
  id: string;
  customer_id: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  event_name: string | null;
  event_type: string | null;
  event_date: string | null;
  event_time: string | null;
  guests: number | string | null;
  budget: number | string | null;
  services: unknown;
  notes: string | null;
  status: string | null;
  created_at: string | null;
};
type SupabaseCustomerProposalRow = {
  id: string;
  request_id: string;
  status: string | null;
  recommendation: string | null;
  revision: string | null;
  plan_key: string | null;
  plan_content: unknown;
};
const OPTION_B_DEMO_SELECTIONS_KEY = "eventflow-option-b-demo-selections-v1";
type DemoPlanSelection = { customerId: string; planKey: "A" | "B"; revision?: string; selectedAt: string };
function readDemoPlanSelection(requestId: string, customerId: string, revision?: string): "A" | "B" | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPTION_B_DEMO_SELECTIONS_KEY) || "{}") as Record<string, DemoPlanSelection>;
    const selection = parsed[requestId];
    return selection?.customerId === customerId && selection.revision === revision ? selection.planKey : undefined;
  } catch {
    return undefined;
  }
}
function writeDemoPlanSelection(requestId: string, customerId: string, planKey: "A" | "B", revision?: string): boolean {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPTION_B_DEMO_SELECTIONS_KEY) || "{}") as Record<string, DemoPlanSelection>;
    parsed[requestId] = { customerId, planKey, revision, selectedAt: new Date().toISOString() };
    localStorage.setItem(OPTION_B_DEMO_SELECTIONS_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    // The selected plan remains available in the current portal session.
    return false;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mapGeneratedPlans(recommendation: string, plans: GeneratedProposalResponse["plans"]): [EventPlan, EventPlan] {
  const mapped = plans.map((plan): EventPlan => ({
    id: plan.id,
    title: plan.title,
    concept: plan.concept,
    theme: plan.theme,
    timeline: plan.timeline,
    venue: plan.venue,
    catering: plan.catering,
    services: plan.services,
    costs: plan.costBreakdown.map((item) => ({ name: item.item, detail: item.description, price: item.amountMYR, confirmed: false })),
    total: plan.totalEstimatedMYR,
    recommendation,
    assumptions: plan.assumptions,
    unconfirmedCosts: plan.unconfirmedCosts,
  }));
  const planA = mapped.find((plan) => plan.id === "A");
  const planB = mapped.find((plan) => plan.id === "B");
  if (!planA || !planB) throw new Error("The proposal service did not return both Plan A and Plan B.");
  return [planA, planB];
}
function mapPersistedPlan(value: unknown, expectedId: "A" | "B"): GeneratedProposalResponse["plans"][number] {
  if (!isRecord(value) || value.id !== expectedId || typeof value.title !== "string"
    || !Array.isArray(value.costBreakdown)
    || value.totalEstimatedMYR === null || value.totalEstimatedMYR === ""
    || !Number.isFinite(Number(value.totalEstimatedMYR))) {
    throw new Error(`Saved Plan ${expectedId} is incomplete and cannot be displayed safely.`);
  }
  const savedTimeline = Array.isArray(value.timeline) ? value.timeline : [];
  const timeline = savedTimeline.flatMap((item) => isRecord(item) && typeof item.time === "string" && typeof item.activity === "string"
    ? [{ time: item.time, activity: item.activity }]
    : []);
  const costBreakdown = value.costBreakdown.flatMap((item) => {
    if (!isRecord(item) || typeof item.item !== "string" || typeof item.description !== "string"
      || item.amountMYR === null || item.amountMYR === "") return [];
    const amountMYR = typeof item.amountMYR === "number" ? item.amountMYR : Number(item.amountMYR);
    return Number.isFinite(amountMYR) ? [{ item: item.item, description: item.description, amountMYR }] : [];
  });
  if (timeline.length !== savedTimeline.length || costBreakdown.length !== value.costBreakdown.length) {
    throw new Error(`Saved Plan ${expectedId} contains incomplete timeline or price details.`);
  }
  return {
    id: expectedId,
    title: value.title,
    concept: typeof value.concept === "string" ? value.concept : "No concept provided.",
    theme: typeof value.theme === "string" ? value.theme : "Not specified",
    timeline,
    venue: { name: isRecord(value.venue) && typeof value.venue.name === "string" ? value.venue.name : "To be confirmed", setup: isRecord(value.venue) && typeof value.venue.setup === "string" ? value.venue.setup : "Not specified" },
    catering: typeof value.catering === "string" ? value.catering : "Not specified",
    services: Array.isArray(value.services) ? value.services.filter((item): item is string => typeof item === "string") : [],
    costBreakdown,
    totalEstimatedMYR: Number(value.totalEstimatedMYR),
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.filter((item): item is string => typeof item === "string") : [],
    unconfirmedCosts: Array.isArray(value.unconfirmedCosts) ? value.unconfirmedCosts.filter((item): item is string => typeof item === "string") : [],
  };
}
function mapSavedRequest(row: SupabaseCustomerRequestRow, proposalRows: SupabaseCustomerProposalRow[], customerId: string): CustomerEvent {
  const notes = row.notes ?? "";
  const locationMatch = /^Location:\s*([^\r\n]+)/.exec(notes);
  const location = locationMatch?.[1]?.trim() || "To be confirmed";
  const noteBody = locationMatch ? notes.slice(locationMatch[0].length).replace(/^\s*\n?/, "").replace(/^\s*\n?/, "") : notes;
  const metadata = /^EventFlow request metadata v1:\r?\nTheme:\s*([^\r\n]*)(?:\r?\n\r?\n([\s\S]*))?$/.exec(noteBody);
  const theme = metadata?.[1]?.trim() ?? "";
  const requirements = (metadata ? metadata[2] ?? "" : noteBody).trim();
  const validServices: Service[] = ["Catering", "Decoration", "Photography", "Venue Setup", "Equipment"];
  const services = Array.isArray(row.services)
    ? row.services.filter((service): service is Service => typeof service === "string" && validServices.includes(service as Service))
    : [];
  const proposalGroups = new Map<string, SupabaseCustomerProposalRow[]>();
  for (const proposalRow of proposalRows.filter((item) => item.plan_key === "A" || item.plan_key === "B")) {
    const key = proposalRow.revision ?? "";
    const group = proposalGroups.get(key) ?? [];
    group.push(proposalRow);
    proposalGroups.set(key, group);
  }
  const newestRevision = [...proposalGroups.keys()].sort((a, b) => {
    const numberA = Number(a);
    const numberB = Number(b);
    if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberB - numberA;
    return b.localeCompare(a);
  })[0];
  const pair = newestRevision === undefined ? [] : proposalGroups.get(newestRevision)!;
  let proposal: EventProposal | undefined;
  let status: EventStatus = "Pending Business Approval";
  if (pair.length === 2 && new Set(pair.map((item) => item.plan_key)).size === 2) {
    const byPlan = new Map(pair.map((item) => [item.plan_key as "A" | "B", item]));
    const planArow = byPlan.get("A")!;
    const planBrow = byPlan.get("B")!;
    const plans = mapGeneratedPlans(
      planArow.recommendation ?? planBrow.recommendation ?? "No recommendation provided.",
      [mapPersistedPlan(planArow.plan_content, "A"), mapPersistedPlan(planBrow.plan_content, "B")],
    );
    const statuses = pair.map((item) => item.status);
    if (statuses.every((item) => item === "Changes Requested")) status = "Changes Requested";
    else if (statuses.every((item) => item === "Customer Accepted")) status = "Customer Accepted";
    else if (statuses.every((item) => item === "Approved for Customer")) status = "Approved for Customer";
    // Legacy "Awaiting Customer" pairs are deliberately still awaiting the
    // customer's Option B selection; they are not treated as approved here.
    else status = "Pending Business Approval";
    proposal = {
      plans,
      updatedAt: row.created_at ?? new Date().toISOString(),
      source: "persisted-ai",
      workflowStatus: status === "Changes Requested" ? "Changes Requested" : status === "Approved for Customer" ? "Approved for Customer" : "Pending Business Approval",
      proposalIds: { A: planArow.id, B: planBrow.id },
      revision: newestRevision || undefined,
    };
  } else if (proposalRows.some((item) => item.plan_key === "A" || item.plan_key === "B")) {
    throw new Error("The saved proposal pair is incomplete; both plans are required.");
  }
  const createdAt = row.created_at ?? new Date().toISOString();
  return {
    id: row.id,
    name: row.event_name?.trim() || "Untitled event",
    type: row.event_type?.trim() || "Event",
    date: row.event_date || "",
    location,
    guests: Number(row.guests) || 0,
    budget: Number(row.budget) || 0,
    theme,
    services,
    requirements,
    status,
    createdAt,
    proposal,
    preferredPlanId: readDemoPlanSelection(row.id, customerId, proposal?.revision),
    requestSource: "supabase",
  };
}
function persistedErrorMessage(code: unknown, message: unknown): string {
  if (code === "AUTHENTICATION_REQUIRED" || code === "INVALID_ACCESS_TOKEN") return "Your secure session expired. Please sign in again, then retry proposal generation.";
  if (code === "PERSISTENCE_NOT_CONFIGURED") return "Proposal saving is not enabled on the server yet. Your request is saved; please try again after the planning team configures it.";
  if (code === "REQUEST_NOT_FOUND" || code === "REQUEST_OWNERSHIP_MISMATCH") return "We couldn’t verify this saved request. Refresh your events and try again.";
  if (code === "CUSTOMER_ACCESS_DENIED") return "This account no longer has customer access. Please sign in with an approved customer account.";
  return typeof message === "string" && message.trim()
    ? message
    : "We couldn’t generate and save your proposals. Please try again.";
}
export const apiProposalService: ProposalService = {
  async generate(input, idempotencyKey) {
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
    const response = await fetch(`${apiBaseUrl}/api/dev/proposals/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": (idempotencyKey || `evt-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 128) },
      body: JSON.stringify({
        eventName: input.name, eventType: input.type, eventDate: input.date,
        location: input.location, guestCount: input.guests, budgetMYR: input.budget,
        theme: input.theme, selectedServices: input.services,
        requirements: input.requirements.trim() || "No additional requirements provided.",
      }),
    });
    const result = await response.json().catch(() => null) as { proposal?: GeneratedProposalResponse; error?: string } | null;
    if (!response.ok || !result?.proposal) {
      throw new Error(result?.error || "We couldn’t generate your proposal. Please try again.");
    }
    const plans = mapGeneratedPlans(result.proposal.recommendation, result.proposal.plans);
    return { plans, updatedAt: new Date().toISOString(), source: "ai-service" };
  },
  async generatePersisted(requestId: string): Promise<EventProposal> {
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) {
      throw new Error("Your secure session expired. Please sign in again, then retry proposal generation.");
    }

    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/api/proposals/generate-persisted`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ requestId }),
      });
    } catch {
      throw new Error("The proposal service could not be reached. Your request is saved; please retry when the service is available.");
    }
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const body = isRecord(result) ? result : {};
      console.error("EventFlow proposal API error:", response.status, body.code, body.error);
      throw new Error(persistedErrorMessage(body.code, body.error));
    }

    if (!isRecord(result) || result.requestId !== requestId || !Array.isArray(result.proposals) || result.proposals.length !== 2) {
      throw new Error("The server returned an incomplete saved proposal pair. Please retry safely.");
    }
    const rows = result.proposals as unknown[];
    const planRows = rows.map((value) => {
      if (!isRecord(value) || (value.plan_key !== "A" && value.plan_key !== "B") || typeof value.proposal_id !== "string"
        || typeof value.status !== "string" || typeof value.recommendation !== "string" || !isRecord(value.plan_content)) {
        throw new Error("The saved proposals could not be read safely. Please contact the planning team.");
      }
      const content = value.plan_content as unknown as GeneratedProposalResponse["plans"][number];
      if (content.id !== value.plan_key || typeof content.title !== "string" || typeof content.concept !== "string"
        || typeof content.theme !== "string" || !Array.isArray(content.timeline) || !isRecord(content.venue)
        || typeof content.catering !== "string" || !Array.isArray(content.services) || !Array.isArray(content.costBreakdown)
        || typeof content.totalEstimatedMYR !== "number" || !Array.isArray(content.assumptions) || !Array.isArray(content.unconfirmedCosts)) {
        throw new Error("The saved proposal content is incomplete. Please contact the planning team.");
      }
      return { planKey: value.plan_key, proposalId: value.proposal_id, status: value.status, recommendation: value.recommendation, content };
    });
    if (new Set(planRows.map((row) => row.planKey)).size !== 2) {
      throw new Error("The server did not return one saved Plan A and one saved Plan B.");
    }
    const supportedPair = planRows.every((row) =>
      row.status === "Pending Business Approval" || row.status === "Awaiting Customer");
    if (!supportedPair) {
      throw new Error("The saved proposal status is not supported. Please contact the planning team.");
    }
    const recommendation = planRows.find((row) => row.planKey === "A")!.recommendation;
    const plans = mapGeneratedPlans(recommendation, planRows.map((row) => row.content) as GeneratedProposalResponse["plans"]);
    return {
      plans,
      updatedAt: new Date().toISOString(),
      source: "persisted-ai",
      // Legacy pairs marked Awaiting Customer still need the customer's
      // Option B selection; loading or retrying must not imply approval.
      workflowStatus: "Pending Business Approval",
      revision: String(result.revision),
      proposalIds: {
        A: planRows.find((row) => row.planKey === "A")?.proposalId,
        B: planRows.find((row) => row.planKey === "B")?.proposalId,
      },
    };
  },
};
type CustomerState = {
  user: { id: string; name: string; email: string } | null; authLoading: boolean; events: CustomerEvent[]; changeRequests: ChangeRequest[];
  remoteLoading: boolean; remoteError: string;
  reloadSavedEvents: () => void;
  signIn: (email: string, password: string, registering?: boolean, fullName?: string) => Promise<{ error?: string; message?: string; signedIn: boolean }>;
  signOut: () => Promise<void>;
  createRequest: (event: ProposalGenerationInput) => Promise<string>;
  addEvent: (event: Omit<CustomerEvent, "id" | "createdAt" | "status" | "proposal" | "acceptedPlanId" | "requestSource">, id: string, requestSource: "demo" | "supabase") => void;
  generateProposal: (id: string, input: ProposalGenerationInput, requestSource?: "demo" | "supabase") => Promise<void>;
  acceptProposal: (id: string, planId: "A" | "B") => void;
  preferProposal: (id: string, planId: "A" | "B") => { error?: string; stored?: boolean };
  requestChanges: (id: string, message: string) => void;
};
type PersistedState = Pick<CustomerState, "events" | "changeRequests">;
const STORAGE_KEY = "eventflow-customer-v1";
const planA: EventPlan = {
  id: "A", title: "The Garden Table", concept: "An intimate, candlelit dinner surrounded by seasonal blooms.", theme: "Soft garden party · sage, ivory, and blush",
  timeline: [{ time: "4:00 pm", activity: "Venue access and styling setup" }, { time: "6:00 pm", activity: "Guest arrival and welcome drinks" }, { time: "7:00 pm", activity: "Three-course dinner" }, { time: "9:30 pm", activity: "Cake, toasts, and relaxed portraits" }, { time: "10:30 pm", activity: "Event concludes" }],
  venue: { name: "The Glasshouse, Kuala Lumpur", setup: "Long communal tables for 42, candle clusters, seasonal low florals, linen, and a dedicated cake table." },
  catering: "Three-course plated dinner with welcome drinks; menu choices to be confirmed with the host.",
  services: ["Dinner catering", "Garden table styling", "Four-hour event photography", "Setup and on-the-day coordination"],
  costs: [{ name: "Garden table styling", detail: "Florals, linen, candles, and place settings", price: 2850, confirmed: true }, { name: "Dinner catering", detail: "42 guests · three courses and welcome drinks", price: 5460, confirmed: true }, { name: "Event photography", detail: "Four hours of candid coverage", price: 1900, confirmed: true }, { name: "Venue setup and coordination", detail: "Setup team and on-the-day coordination", price: 1650, confirmed: true }],
  total: 11860, recommendation: "Recommended for the warm, relaxed dinner you described. The communal table keeps the group together and the estimate sits within your stated budget.",
  assumptions: ["Guest count remains at 42.", "Event duration is approximately 6.5 hours including setup."], unconfirmedCosts: ["Final menu selections or dietary substitutions may change catering cost.", "Venue date availability and any overtime fee require confirmation."],
};
const planB: EventPlan = {
  id: "B", title: "The Conservatory Soirée", concept: "A more spacious reception with lounge seating, a dinner service, and a dedicated portrait corner.", theme: "Romantic conservatory · olive, cream, and warm gold",
  timeline: [{ time: "3:30 pm", activity: "Venue access and setup" }, { time: "5:30 pm", activity: "Welcome drinks and arrival portraits" }, { time: "6:45 pm", activity: "Dinner service begins" }, { time: "8:45 pm", activity: "Cake, speeches, and group photos" }, { time: "10:30 pm", activity: "Event concludes" }],
  venue: { name: "The Glasshouse, Kuala Lumpur", setup: "Round dinner tables with a small lounge area, enhanced floral focal point, and a styled portrait corner." },
  catering: "Family-style dinner with welcome drinks and a dessert station; menu and dietary needs to be confirmed.",
  services: ["Family-style catering", "Enhanced floral styling", "Four-hour event photography", "Lounge and portrait setup", "Setup and coordination"],
  costs: [{ name: "Enhanced venue styling", detail: "Florals, table linen, candles, lounge and portrait corner", price: 3900, confirmed: true }, { name: "Family-style dinner", detail: "42 guests · dinner, welcome drinks, dessert station", price: 6300, confirmed: true }, { name: "Event photography", detail: "Four hours of candid coverage", price: 1900, confirmed: true }, { name: "Setup and coordination", detail: "Setup team and on-the-day coordination", price: 1650, confirmed: true }],
  total: 13750, recommendation: "Consider this option if a more open layout and extra photo moments matter most. It offers more variety but uses more of your budget.",
  assumptions: ["Guest count remains at 42.", "The same venue and event end time are used as Plan A."], unconfirmedCosts: ["Final menu selections or dietary substitutions may change catering cost.", "Lounge furniture availability and venue date require confirmation."],
};
const demoEvents: CustomerEvent[] = [
  { id: "evt-garden-01", name: "A Garden Dinner for Maya", type: "Birthday", date: "2027-02-20", location: "The Glasshouse, Kuala Lumpur", guests: 42, budget: 12500, theme: "Soft garden party", services: ["Catering", "Decoration", "Photography", "Venue Setup"], requirements: "An intimate dinner with candlelight, seasonal flowers, and a small cake table. Please keep the setup warm and relaxed.", status: "Approved for Customer", createdAt: "2026-04-18T10:30:00.000Z", proposal: { plans: [planA, planB], updatedAt: "2026-04-19T10:30:00.000Z", source: "mock" } },
  { id: "evt-launch-02", name: "Lumen Studio Launch", type: "Corporate Event", date: "2026-11-07", location: "Lumen Studio, Petaling Jaya", guests: 80, budget: 18000, theme: "Modern, warm, and welcoming", services: ["Catering", "Venue Setup", "Equipment"], requirements: "A relaxed evening launch with light bites, a short welcome speech, and a simple presentation setup.", status: "Pending Business Approval", createdAt: "2026-05-02T09:15:00.000Z" },
];
function normalizeEvent(raw: CustomerEvent & { proposalReady?: boolean; quotation?: { items: { name: string; detail: string; price: number }[]; total: number } }): CustomerEvent {
  const legacyStatus: Record<string, EventStatus> = { "Pending Review": "Pending Business Approval", Approved: "Approved for Customer", Accepted: "Customer Accepted", "Changes Requested": "Changes Requested" };
  const requestSource = raw.requestSource ?? "demo";
  if (raw.proposal) return { ...raw, requestSource, status: legacyStatus[raw.status] ?? raw.status };
  if (raw.proposalReady && raw.quotation) {
    const legacyPlan = (id: "A" | "B"): EventPlan => ({ ...planA, id, title: id === "A" ? "Original approved plan" : "Alternative plan", concept: `${raw.type} proposal based on your event request.`, theme: raw.theme, venue: { name: raw.location, setup: "Setup details from the original proposal require planner confirmation." }, costs: raw.quotation!.items.map((item) => ({ ...item, confirmed: false })), total: raw.quotation!.total, recommendation: "This plan was carried forward from your saved demo quotation.", unconfirmedCosts: ["Legacy quotation details require planner confirmation."], });
    return { ...raw, requestSource, status: legacyStatus[raw.status] ?? "Pending Business Approval", proposal: { plans: [legacyPlan("A"), legacyPlan("B")], updatedAt: raw.createdAt, source: "mock" } };
  }
  const { quotation: _quotation, proposalReady: _proposalReady, ...event } = raw;
  return { ...event, requestSource, status: legacyStatus[raw.status] ?? raw.status };
}
function initialState(): PersistedState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const parsed = JSON.parse(saved) as Partial<PersistedState> & { user?: unknown }; return { events: (parsed.events ?? demoEvents).map(normalizeEvent).filter((event) => event.requestSource !== "supabase"), changeRequests: parsed.changeRequests ?? [] }; }
  } catch { /* Start with composed demo data when storage is unavailable. */ }
  return { events: demoEvents, changeRequests: [] };
}
async function customerFromAuthUser(authUser: SupabaseUser): Promise<{ user?: CustomerState["user"]; error?: string }> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("account_type, role, approval_status, full_name")
    .eq("id", authUser.id)
    .maybeSingle();

  if (error) return { error: "We couldn’t verify your customer profile. Please try again." };
  if (!profile || profile.account_type !== "customer" || profile.role !== "customer" || profile.approval_status !== "approved") {
    return { error: "This account does not have approved customer access. Please use the correct EventFlow portal." };
  }

  const metadataName = typeof authUser.user_metadata?.full_name === "string" ? authUser.user_metadata.full_name : "";
  const name = typeof profile.full_name === "string" && profile.full_name.trim() ? profile.full_name : metadataName;
  return { user: { id: authUser.id, name: name || authUser.email?.split("@")[0] || "Customer", email: authUser.email ?? "" } };
}
const CustomerContext = createContext<CustomerState | null>(null);
export function CustomerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [user, setUser] = useState<CustomerState["user"]>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => {
    try {
      const demoState = { ...state, events: state.events.filter((event) => event.requestSource !== "supabase") };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demoState));
    } catch { /* The portal remains usable without storage. */ }
  }, [state]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    let authEventReceived = false;
    const pendingAuthTimers = new Set<number>();

    const restoreSession = async (session: Session | null, currentRevision: number) => {
      try {
        if (!session) {
          if (active && currentRevision === revision) setUser(null);
          return;
        }

        const result = await customerFromAuthUser(session.user);
        if (!active || currentRevision !== revision) return;
        if (result.user) {
          setRemoteLoading(true);
          setUser(result.user);
        } else {
          setUser(null);
          void supabase.auth.signOut().catch(() => {});
        }
      } catch {
        if (!active || currentRevision !== revision) return;
        setUser(null);
        void supabase.auth.signOut().catch(() => {});
      } finally {
        if (active && currentRevision === revision) setAuthLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // getSession() is the single source for initial restoration.
      if (event === "INITIAL_SESSION") return;
      authEventReceived = true;
      const currentRevision = ++revision;
      setAuthLoading(true);
      // Defer Supabase calls until after its auth callback has returned.
      const timer = window.setTimeout(() => {
        pendingAuthTimers.delete(timer);
        void restoreSession(session, currentRevision);
      }, 0);
      pendingAuthTimers.add(timer);
    });

    const initialRevision = revision;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active || authEventReceived || revision !== initialRevision) return;
        const currentRevision = ++revision;
        await restoreSession(error ? null : data.session, currentRevision);
      } catch {
        if (!active || authEventReceived || revision !== initialRevision) return;
        await restoreSession(null, ++revision);
      }
    })();

    return () => {
      active = false;
      pendingAuthTimers.forEach((timer) => window.clearTimeout(timer));
      pendingAuthTimers.clear();
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setRemoteError("");
    setState((current) => ({ ...current, events: current.events.filter((event) => event.requestSource !== "supabase") }));
    if (!user) {
      setRemoteLoading(false);
      return () => { active = false; };
    }

    setRemoteLoading(true);
    void (async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || authData.user?.id !== user.id) throw new Error("Your secure session changed. Please sign in again.");
        const { data: requestData, error: requestError } = await supabase
          .from("requests")
          .select("id, customer_id, customer_name, email, phone, event_name, event_type, event_date, event_time, guests, budget, services, notes, status, created_at")
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false, nullsFirst: false });
        if (requestError) throw new Error(`Saved requests could not be loaded: ${requestError.message}`);
        if (!active) return;

        const requestRows = (requestData ?? []) as unknown as SupabaseCustomerRequestRow[];
        const requestIds = requestRows.filter((row) => row.customer_id === user.id).map((row) => row.id);
        let proposalsByRequest = new Map<string, SupabaseCustomerProposalRow[]>();
        let proposalError = "";
        if (requestIds.length) {
          const { data: proposalData, error } = await supabase
            .from("proposals")
            .select("id, request_id, status, recommendation, revision, plan_key, plan_content")
            .in("request_id", requestIds);
          if (error) proposalError = `Saved plans could not be loaded: ${error.message}`;
          else {
            for (const row of (proposalData ?? []) as unknown as SupabaseCustomerProposalRow[]) {
              if (!requestIds.includes(row.request_id)) continue;
              const group = proposalsByRequest.get(row.request_id) ?? [];
              group.push(row);
              proposalsByRequest.set(row.request_id, group);
            }
          }
        }
        if (!active) return;

        let invalidPair = false;
        const hydrated = requestRows
          .filter((row) => row.customer_id === user.id)
          .map((row) => {
            try {
              return mapSavedRequest(row, proposalsByRequest.get(row.id) ?? [], user.id);
            } catch {
              invalidPair = true;
              return mapSavedRequest(row, [], user.id);
            }
          });
        setState((current) => ({
          ...current,
          events: [...hydrated, ...current.events.filter((event) => event.requestSource !== "supabase")],
        }));
        setRemoteError(proposalError || (invalidPair ? "One saved Plan A/Plan B pair is incomplete and was not displayed." : ""));
      } catch (error) {
        if (active) setRemoteError(error instanceof Error ? error.message : "Saved EventFlow data could not be loaded.");
      } finally {
        if (active) setRemoteLoading(false);
      }
    })();

    return () => { active = false; };
  }, [user?.id, reloadVersion]);
  const value = useMemo<CustomerState>(() => ({ ...state, user, authLoading, remoteLoading, remoteError,
    reloadSavedEvents: () => setReloadVersion((version) => version + 1),
    signIn: async (email, password, registering = false, fullName = "") => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) return { error: "Enter a valid email address.", signedIn: false };
      if (password.length < 6) return { error: "Password must be at least 6 characters.", signedIn: false };
      try {
        if (registering) {
          if (!fullName.trim()) return { error: "Enter your full name.", signedIn: false };
          const { data, error } = await supabase.auth.signUp({
            email: trimmedEmail,
            password,
            options: {
              data: { full_name: fullName.trim(), account_type: "customer" },
              emailRedirectTo: window.location.origin,
            },
          });
          if (error) return { error: error.message, signedIn: false };
          if (!data.session) return { message: "Account created. Check your email for a confirmation link, then sign in.", signedIn: false };
          const result = await customerFromAuthUser(data.session.user);
          if (!result.user) { await supabase.auth.signOut(); return { error: result.error, signedIn: false }; }
          setRemoteLoading(true);
          setUser(result.user);
          return { signedIn: true };
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) return { error: error.message, signedIn: false };
        if (!data.user) return { error: "Unable to establish a customer session. Please try again.", signedIn: false };
        const result = await customerFromAuthUser(data.user);
        if (!result.user) { await supabase.auth.signOut(); return { error: result.error, signedIn: false }; }
        setRemoteLoading(true);
        setUser(result.user);
        return { signedIn: true };
      } catch {
        return { error: "Unable to connect to EventFlow authentication. Please try again.", signedIn: false };
      }
    },
    signOut: async () => { await supabase.auth.signOut(); setUser(null); },
    createRequest: async (event) => {
      const { data: { user: authenticatedUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authenticatedUser) throw new Error("Your session could not be verified. Please sign in again before submitting.");
      if (!user || user.id !== authenticatedUser.id) throw new Error("Your customer profile is still loading. Please try again.");

      const theme = event.theme.trim();
      const notes = [
        `Location: ${event.location}`,
        ...(theme ? [`EventFlow request metadata v1:\nTheme: ${theme}`] : []),
        event.requirements.trim(),
      ].filter(Boolean).join("\n\n");
      const { data, error } = await supabase.from("requests").insert({
        customer_id: authenticatedUser.id,
        customer_name: user.name,
        email: authenticatedUser.email ?? user.email,
        phone: null,
        event_name: event.name,
        event_type: event.type,
        event_date: event.date,
        event_time: null,
        guests: event.guests,
        budget: event.budget,
        services: event.services,
        notes: notes || null,
        venue_id: null,
        event_end_time: null,
      }).select("id").single();

      if (error || !data?.id) {
        throw new Error(error?.message
          ? `We couldn’t save your request: ${error.message}`
          : "We couldn’t save your request. Please try again.");
      }
      return data.id;
    },
    addEvent: (event, id, requestSource) => { setState((current) => ({ ...current, events: [{ ...event, id, requestSource, createdAt: new Date().toISOString(), status: "AI Draft" }, ...current.events] })); },
    generateProposal: async (id, input, requestSource) => {
     const existing = state.events.find((item) => item.id === id);

const isSupabaseRequest =
  requestSource === "supabase" ||
  existing?.requestSource === "supabase";

if (existing?.proposal) {
  if (existing.proposal.source === "persisted-ai") return;
  if (!isSupabaseRequest) return;
}
      let proposal: EventProposal;
      if (isSupabaseRequest) {
        if (!apiProposalService.generatePersisted) throw new Error("Saved proposal generation is not available in this portal version.");
        proposal = await apiProposalService.generatePersisted(id);
      } else {
        proposal = await apiProposalService.generate(input, id);
      }
      setState((current) => ({
  ...current,
  events: current.events.map((item) =>
    item.id === id &&
    (item.status === "AI Draft" ||
      (isSupabaseRequest && item.proposal?.source !== "persisted-ai"))
      ? {
          ...item,
          proposal,
          status:
            proposal.workflowStatus ??
            (isSupabaseRequest ? "Pending Business Approval" : "AI Draft"),
        }
      : item
  ),
}));
    },
    // Demo-only selection is shared with the Business Portal through this
    // browser's localStorage. It never updates Supabase proposal records.
    preferProposal: (id, planId) => {
      if (!user) return { error: "Sign in before selecting a saved plan." };
      const event = state.events.find((item) => item.id === id);
      if (!event || event.requestSource !== "supabase" || event.proposal?.source !== "persisted-ai"
        || event.status === "Customer Accepted" || !event.proposal.plans.some((plan) => plan.id === planId)) return { error: "This saved plan is not available for selection. Reload your saved events and try again." };
      const stored = writeDemoPlanSelection(id, user.id, planId, event.proposal.revision);
      setState((current) => ({
        ...current,
        events: current.events.map((item) => item.id === id ? { ...item, preferredPlanId: planId } : item),
      }));
      return { stored };
    },
    acceptProposal: (id, planId) => setState((current) => ({ ...current, events: current.events.map((event) => event.id === id && event.status === "Approved for Customer" && event.proposal?.plans.some((plan) => plan.id === planId) ? { ...event, status: "Customer Accepted", acceptedPlanId: planId } : event) })),
    requestChanges: (id, message) => setState((current) => {
      const event = current.events.find((item) => item.id === id); const trimmed = message.trim();
      if (!event || event.status === "Customer Accepted" || !trimmed) return current;
      const update: ChangeRequest = { id: `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, eventId: id, message: trimmed, createdAt: new Date().toISOString() };
      return { ...current, changeRequests: [update, ...current.changeRequests], events: current.events.map((item) => item.id === id ? { ...item, status: "Changes Requested" } : item) };
    }),
  }), [state, user, authLoading, remoteLoading, remoteError]);
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}
export function useCustomer() { const context = useContext(CustomerContext); if (!context) throw new Error("useCustomer must be used inside CustomerProvider"); return context; }
