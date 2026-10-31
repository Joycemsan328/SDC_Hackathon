---
name: Paid-generation ambiguity
description: Why the submission demo favors blocking uncertain attempts over automatic recovery that might charge twice.
---

Keep uncertain generation reservations consumed. Do not add expiring leases,
automatic refunds, or retry-by-resubmission to make interrupted requests progress.
Recover already validated cached output without another inference submission when
available.

**Why:** The owner approved a strict per-request attempt limit and a shared global
demo cap. A timeout or crashed process does not prove RunPod did not accept and
charge for a job. Automatically reclaiming its reservation can buy a duplicate.
Live Supabase schema/RLS/RPC changes require separate approval; preparing an
approved workspace migration draft does not authorize executing it.

**How to apply:** Preserve the same durable budget across production instances,
restarts, and deployments. Missing/unverifiable state must block new inference,
not bootstrap a fresh budget. Any future interrupted-job recovery must reconcile
the original provider job, not submit another. Storage verification and explicit
owner approval are still required before enabling live generation or publishing.

Publish and verify the guarded backend with generation disabled before activating
live flags. Never activate an older published backend merely because guarded code
is present in the workspace.

**Why:** Environment flags can affect the already-published code, not just the next
build. An older backend could submit paid jobs without the newly prepared quota.

**How to apply:** Keep activation separate from quota initialization and publishing.
Exercise real shared-store atomic operations in an isolated disposable test ledger,
not the production budget: tests must not require refunding or resetting its cap.

Budget extensions must preserve the consumed count and per-request history.
Use an explicit, finite, one-time atomic increase; repeating the operator action
must not grant additional capacity. Each target change requires a separate
approval and its own ledger transition.

**Why:** A quota target can change as the owner adjusts the demo plan, but prior
extension markers and consumed attempts remain authoritative. Treating a new
target as a reset or silently folding it into an older extension would bypass
the approved spending limit.

**How to apply:** Validate the exact existing ledger state and test the increase
on an isolated ledger. Preserve consumed attempts, history, and the separate
generation activation gate. Production extension commands require explicit
owner approval and both generation flags explicitly disabled; code approval is
not authorization to alter the live quota or enable generation.

An explicitly Business-initiated Customer Change Request revision may have one
independent generation attempt, while sharing the original lifetime budget.
The initial request attempt and every earlier revision attempt remain consumed.

**Why:** The owner approved a revision lifecycle, not automatic paid retries or a
new budget for each revision. A failed revision must not make previous attempts
reusable.

**How to apply:** Use a database-owned identity for each authorized revision,
reserve against the same atomic global ledger, and recover cached results without
another inference. Keep revision activation separate from migration review and
installation; no automatic execution or activation follows from workspace tests.
