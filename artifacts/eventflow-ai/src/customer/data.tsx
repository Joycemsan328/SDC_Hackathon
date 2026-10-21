import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
export type EventProposal = { plans: [EventPlan, EventPlan]; updatedAt: string; source: "mock" | "ai-service" };
export type CustomerEvent = {
  id: string; name: string; type: string; date: string; location: string; guests: number;
  budget: number; theme: string; services: Service[]; requirements: string;
  status: EventStatus; createdAt: string; proposal?: EventProposal; acceptedPlanId?: "A" | "B";
};
export type ChangeRequest = { id: string; eventId: string; message: string; createdAt: string };
export type ProposalGenerationInput = Pick<CustomerEvent, "name" | "type" | "date" | "location" | "guests" | "budget" | "theme" | "services" | "requirements">;
// Replace this mock implementation with a server-backed provider when available.
// No external AI service is connected by this interface yet.
export interface ProposalService { generate(input: ProposalGenerationInput): Promise<EventProposal> }
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
export const apiProposalService: ProposalService = {
  async generate(input) {
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
    const response = await fetch(`${apiBaseUrl}/api/proposals/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
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
    const plans = result.proposal.plans.map((plan): EventPlan => ({
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
      recommendation: result.proposal!.recommendation,
      assumptions: plan.assumptions,
      unconfirmedCosts: plan.unconfirmedCosts,
    })) as [EventPlan, EventPlan];
    return { plans, updatedAt: new Date().toISOString(), source: "ai-service" };
  },
};
type CustomerState = {
  user: { name: string; email: string } | null; events: CustomerEvent[]; changeRequests: ChangeRequest[];
  signIn: (email: string, password: string, registering?: boolean) => string | null;
  signOut: () => void;
  addEvent: (event: Omit<CustomerEvent, "id" | "createdAt" | "status" | "proposal" | "acceptedPlanId">) => string;
  generateProposal: (id: string, input: ProposalGenerationInput) => Promise<void>;
  acceptProposal: (id: string, planId: "A" | "B") => void;
  requestChanges: (id: string, message: string) => void;
};
type PersistedState = Pick<CustomerState, "user" | "events" | "changeRequests">;
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
  if (raw.proposal) return { ...raw, status: legacyStatus[raw.status] ?? raw.status };
  if (raw.proposalReady && raw.quotation) {
    const legacyPlan = (id: "A" | "B"): EventPlan => ({ ...planA, id, title: id === "A" ? "Original approved plan" : "Alternative plan", concept: `${raw.type} proposal based on your event request.`, theme: raw.theme, venue: { name: raw.location, setup: "Setup details from the original proposal require planner confirmation." }, costs: raw.quotation!.items.map((item) => ({ ...item, confirmed: false })), total: raw.quotation!.total, recommendation: "This plan was carried forward from your saved demo quotation.", unconfirmedCosts: ["Legacy quotation details require planner confirmation."], });
    return { ...raw, status: legacyStatus[raw.status] ?? "Pending Business Approval", proposal: { plans: [legacyPlan("A"), legacyPlan("B")], updatedAt: raw.createdAt, source: "mock" } };
  }
  const { quotation: _quotation, proposalReady: _proposalReady, ...event } = raw;
  return { ...event, status: legacyStatus[raw.status] ?? raw.status };
}
function initialState(): PersistedState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const parsed = JSON.parse(saved) as Partial<PersistedState>; return { user: parsed.user ?? null, events: (parsed.events ?? demoEvents).map(normalizeEvent), changeRequests: parsed.changeRequests ?? [] }; }
  } catch { /* Start with composed demo data when storage is unavailable. */ }
  return { user: null, events: demoEvents, changeRequests: [] };
}
const CustomerContext = createContext<CustomerState | null>(null);
export function CustomerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* The portal remains usable without storage. */ } }, [state]);
  const value = useMemo<CustomerState>(() => ({ ...state,
    signIn: (email, password, registering = false) => {
      if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
      if (password.length < 6) return "Password must be at least 6 characters.";
      const name = email.split("@")[0].split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
      setState((current) => ({ ...current, user: { name: registering ? name : name || "Jamie", email } })); return null;
    },
    signOut: () => setState((current) => ({ ...current, user: null })),
    addEvent: (event) => { const id = `evt-${Date.now().toString(36)}`; setState((current) => ({ ...current, events: [{ ...event, id, createdAt: new Date().toISOString(), status: "AI Draft" }, ...current.events] })); return id; },
    generateProposal: async (id, input) => {
      const existing = state.events.find((item) => item.id === id);
      if (existing?.proposal) return;
      const proposal = await apiProposalService.generate(input);
      setState((current) => ({ ...current, events: current.events.map((item) => item.id === id && item.status === "AI Draft" ? { ...item, proposal } : item) }));
    },
    acceptProposal: (id, planId) => setState((current) => ({ ...current, events: current.events.map((event) => event.id === id && event.status === "Approved for Customer" && event.proposal?.plans.some((plan) => plan.id === planId) ? { ...event, status: "Customer Accepted", acceptedPlanId: planId } : event) })),
    requestChanges: (id, message) => setState((current) => {
      const event = current.events.find((item) => item.id === id); const trimmed = message.trim();
      if (!event || event.status === "Customer Accepted" || !trimmed) return current;
      const update: ChangeRequest = { id: `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, eventId: id, message: trimmed, createdAt: new Date().toISOString() };
      return { ...current, changeRequests: [update, ...current.changeRequests], events: current.events.map((item) => item.id === id ? { ...item, status: "Changes Requested" } : item) };
    }),
  }), [state]);
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}
export function useCustomer() { const context = useContext(CustomerContext); if (!context) throw new Error("useCustomer must be used inside CustomerProvider"); return context; }
