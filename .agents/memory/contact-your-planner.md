---
name: Contact Your Planner access model
description: Approved decisions for request-scoped Customer/Business conversations.
---

Contact Your Planner uses one conversation per request, not per individual planner. Only the approved request-owning Customer may access the Customer side; approved Business staff/admins share the Business inbox. A Customer must send the first message; Business replies are blocked until then. New conversations require a current confirmed selection, while the previously approved valid legacy-acceptance path remains supported. Existing conversations pin their original confirmation and stay available across newer revisions while that proof, ownership, and caller approval remain valid; never rebind automatically. A database trigger protects conversation identity and pinned-proof columns from ordinary trusted-service updates. Authenticated clients are append-only; trusted service-role/database-owner message maintenance remains possible. No strict message-immutability trigger or separate Planner role is planned.

**Why:** The existing Business Portal uses a shared approved-staff model. Customer-first sending avoids unsolicited Business threads and must be serialized with message ordering so a concurrent staff send cannot win. Pinning prevents stale confirmations from opening new chats without hiding valid existing history after revision changes; guarding the anchor prevents trusted-service maintenance from silently retargeting that proof.

**How to apply:** Keep one thread per request, Supabase RLS, and authenticated RPCs. Lock requests before new-thread eligibility checks; distinguish latest-revision admission from pinned existing access; lock the conversation before checking first-sender status. Preserve proposal/approval/notification flows and never expose service-role credentials.
