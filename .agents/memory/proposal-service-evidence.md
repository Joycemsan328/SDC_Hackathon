---
name: Proposal service evidence
description: Safety boundaries for normalizing requested services in paid AI proposals.
---

Normalize equivalent service labels only when affirmative structured plan evidence
already includes the scope. Preserve original descriptions and all itemized prices;
never add missing work or prices to repair AI output.

**Why:** Paid generation was rejected when a service existed under an equivalent
label or outside the service summary. The owner requested deterministic recovery,
not fabricated scope, weaker budget checks, or another paid attempt.

**How to apply:** Narrative themes and price/availability disclaimers alone cannot
prove inclusion. Optional, customer-provided and explicitly excluded work is not
included scope. A component-level exclusion must not negate a separately included
package. Apply safe normalization to fresh and cached output before persistence;
genuinely missing scope or over-budget costs still fail with the attempt consumed.
