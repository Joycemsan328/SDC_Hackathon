---
name: Saved proposal verification
description: Evidence and safety rules for diagnosing missing customer plans in Supabase.
---

Verify missing plans through the authenticated customer's lookup, not an anonymous empty response. Row-level security can return an empty array without an error.

**Why:** An anonymous lookup could not distinguish missing data from access filtering. The authorized Preview showed that the viewed request had no visible proposals while a different request had a complete saved pair.

**How to apply:** Check the exact request-to-proposal relationship and authorized row count. Keep query errors, malformed pairs, and zero-row responses distinct. Do not imply planner activity from a missing proposal.

Viewing, rechecking, or selecting existing plans must not trigger proposal generation or change quotations.

**Why:** The user repeatedly required preserving existing records and avoiding RunPod calls during customer-plan debugging.

**How to apply:** Use read-only lookups and link to the correct owning request rather than copying or regenerating a pair.
