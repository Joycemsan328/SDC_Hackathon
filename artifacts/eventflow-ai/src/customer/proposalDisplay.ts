import type { CustomerEvent } from "./data";

// Ephemeral, account-scoped UI evidence from this browser's existing generation flow.
// None of these values grants access to proposal content or represents a booking.
export type GenerationNotice = "not_generated" | "generating" | "business_review" | "released" | "quota_exhausted" | "failed" | "unknown";
export class CustomerProposalApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
export function canDisplayProposal(event: CustomerEvent): boolean {
  return Boolean(event.proposal && ["Approved for Customer", "Customer Accepted"].includes(event.status));
}
export function proposalDisplayStatus(
  event: CustomerEvent,
  loading: boolean,
  lookupError: string,
  notice?: GenerationNotice,
) {
  if (canDisplayProposal(event)) return {
    state: "approved", title: "Proposals approved and available for review",
    description: "Compare Plan A and Plan B for this event. Demo plan preferences stay in this browser and are not sent to Business.",
  };
  if (loading || notice === "generating") return {
    state: "loading", title: "Loading your proposal status",
    description: "Your request is saved. Please wait while we check for available plans.",
  };
  if (lookupError || event.proposalLookup?.state === "error") return {
    state: "error", title: "Proposal information could not be loaded",
    description: "Your request is still saved. Please try again later. A loading problem does not mean your proposals are missing.",
  };
  if (notice === "quota_exhausted") return {
    state: "quota_exhausted", title: "AI generation is unavailable — demo budget exhausted",
    description: "Your request is saved. No new AI job was started. Existing Business-approved plans remain available under their original events.",
  };
  if (notice === "failed") return {
    state: "error", title: "Proposal generation is unavailable",
    description: "Your request is saved, but generation could not be completed. No additional AI job is started by viewing this page.",
  };
  if (event.workflow?.state === "business_review" || notice === "business_review"
    || (event.status === "Pending Business Approval"
      && (event.requestSource !== "supabase" || (event.proposalLookup?.rowCount ?? 0) >= 2))) return {
    state: "business_review", title: "Awaiting Business review",
    description: "Your plans are awaiting Business approval. Both plans will appear here after approval.",
  };
  if (notice === "not_generated") return {
    state: "not_generated", title: "No proposals generated yet",
    description: "Your request has been saved. Proposal generation has not started in this session.",
  };
  // Zero RLS-visible rows do not establish that no proposals exist.
  return {
    state: "unavailable", title: "No proposals available to review yet",
    description: "Your request is saved. We cannot confirm its proposal status from the information currently available. Business-approved plans will appear here when accessible.",
  };
}
