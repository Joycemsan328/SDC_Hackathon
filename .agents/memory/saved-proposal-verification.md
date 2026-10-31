---
name: Saved proposal verification
description: Evidence and safety rules for diagnosing missing customer plans in Supabase.
---

Verify missing plans through the authenticated customer's lookup, not an anonymous empty response. Row-level security can return an empty array without an error.

**Why:** An anonymous lookup could not distinguish missing data from access filtering. The authorized Preview showed that the viewed request had no visible proposals while a different request had a complete saved pair.

**How to apply:** Check the exact request-to-proposal relationship and authorized row count. Keep query errors, malformed pairs, and zero-row responses distinct. Do not imply planner activity from a missing proposal.

Viewing, rechecking, or selecting existing plans must not trigger proposal generation or change quotations.

**Why:** The user repeatedly required preserving existing records and avoiding RunPod calls during customer-plan debugging.

**How to apply:** Use read-only lookups scoped to the selected request rather than copying or regenerating a pair. Keep technical lookup diagnostics, manual debug-generation controls, and other requests' proposal links out of normal Customer Event Details.

Treat generation receipts and errors as request-scoped UI evidence, not proof of another event's status or a permanent quota snapshot. Without authoritative metadata after reopening, use a neutral status.

**Why:** RLS can hide pending proposals, and the owner required accurate customer-facing states without adding paid calls or database changes merely to check status.

**How to apply:** Never label zero visible rows as proof that generation did not happen or that Business is actively reviewing. Keep existing approved plans usable regardless of another request's generation failure.

The target full workflow is Business-first: generate a pair, Business reviews/releases BOTH plans, Customer selects or requests changes, then Business confirms the final selection.

**Why:** The owner explicitly replaced selection-first behavior with Business review before Customer access. New change requests must generate a new revision and repeat Business review.

**How to apply:** Preserve prior records; enforce unreleased-plan confidentiality at the database boundary, backend-only content persistence, revision-specific release/selection/confirmation, and cross-device state. Never confuse pair release with final selection confirmation.

For the hackathon submission, the owner approved a narrower exception: use existing proposals and the existing pair-approval RPC, with no schema, RLS, privilege or RPC-definition changes. Defer revisions, change-request regeneration and final Business confirmation. Do not call paid RunPod inference without explicit approval.

**Why:** The owner prioritized a stable working MVP under the submission deadline rather than installing the larger workflow.

**How to apply:** Do not reactivate the unapplied ledger workflow as part of submission fixes. Preserve legacy bookings; label browser-only plan preferences as demo-only, never confirmed bookings or cross-device saves.

Supabase migrations require the owner's approval of the exact SQL before applying them.

**Why:** The owner explicitly required minimal database changes, preservation of existing proposals, and SQL approval before any migration.

**How to apply:** Provide the reviewable SQL and finish independent implementation and isolated tests, but report live persistence as blocked until the approved migration is applied.

For Customer Response Phases 1–3, keep Customer confirmation/feedback separate from
bookings, Business pair approval, and AI regeneration. Do not reuse the legacy
acceptance RPC or disable the global submission-MVP switch to activate responses.

**Why:** The owner authorized preparation/review of durable Customer responses,
not migration execution, production writes, deployment, or automatic paid AI.

**How to apply:** Prepare a narrow additive response boundary for exact owner
review. Preserve existing approved proposals and approval behavior; recording a
change request must not itself submit an inference job. Do not treat preparation
approval as permission to install or activate.

Background Business refresh failures should retain the last successful data with
an explicit stale-data warning, rather than pretending the saved records vanished.

**Why:** Blanking previously verified requests/plans during temporary read failures
causes disruptive page changes. Retaining data improves continuity, but stale
approval statuses must not be presented as newly verified.

**How to apply:** Separate initial loading from background refresh. Replace cached
data on a successful response, including a genuinely empty result; keep errors
visible until recovery. Still clear user-scoped state on access/session changes,
and keep approval decisions enforced by the existing server/RPC checks.
