---
name: Customer revision lifecycle
description: Product rules for changing proposal revisions before Business finalization.
---

A Customer may request proposal changes before selecting a plan, or after selecting one while Business has not finalized the selection and created the Event. Finalized Events are outside the proposal revision workflow and must never be changed through it. Keep prior selection and change-request records as history; a later change request supersedes an unconfirmed selection rather than overwriting it. New proposals use the original saved request, prior proposal context, and latest change feedback; Business reviews the pair before Customer visibility.

**Why:** Customers may reconsider an unconfirmed plan, while a Business-confirmed Event is an operational commitment that this workflow must not mutate.

**How to apply:** Enforce the boundary in Supabase RPCs under the same request-row lock used by final confirmation, not just in UI. Preserve response history with a revision-scoped uniqueness rule that supports a selection and a change request without duplicates; reject responses once confirmation or an Event exists. Keep generation quota, one-attempt behavior, and Business review gates in force.
