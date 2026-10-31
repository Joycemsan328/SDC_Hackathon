---
name: Unified portal scope
description: Owner's consolidation requirements and limits for Customer and Business.
---

The owner wants one EventFlow website, one URL and one shared Supabase Login/Register, using the Customer app as the main application.

**Why:** The user explicitly requested consolidating the existing portals for the urgent hackathon, not building another website.

**How to apply:** Future portal work should target the unified product rather than independently extending the backup. Keep the standalone Business app intact until the unified app is tested.

Consolidation must reuse the existing portal designs and Business functionality, without changing the database schema or proposal approval semantics.

**Why:** The user explicitly separated the merge from database activation and prohibited calling RunPod during its testing.

**How to apply:** Do not treat navigation or authentication integration as permission to migrate data, generate plans, or turn demo-only Business functions into persistent operations. Report existing limitations explicitly.

Judges must be able to submit new Customer requests and receive genuine AI
proposals, not only view mock proposals or the previously generated test pair.
This must include strict per-request generation limits and a small overall demo
usage cap, without changing the Supabase schema, RLS, or approval RPC.

**Why:** The owner explicitly clarified that a saved-plan-only demo is not the
desired submission experience.

**How to apply:** Prepare safe automatic generation, but do not equate this
product requirement with approval for new paid test calls or a deployment.
