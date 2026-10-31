---
name: AI estimate arithmetic policy
description: Owner-approved handling of valid AI itemized estimates with an incorrect quoted total.
---

The owner approved deriving totals from validated itemized costs rather than
buying another generation solely to correct arithmetic. Each line amount is
rounded to two decimal places and normalized totals are summed. The saved
Customer budget is planning guidance, not a hard ceiling for an otherwise valid
proposal; keep it unchanged and show any overage for Customer and Business review.

**Why:** A real Qwen response contained complete A/B plans but an incorrect total.
The owner chose deterministic arithmetic correction, reuse of paid responses,
and honest comparison to the Customer's budget instead of rejecting a usable plan
solely because its estimate exceeded that budget.

**How to apply:** Keep request budget validation and pass the exact saved amount as
prompt guidance. Enforce numeric, structural, ownership, service, and
itemized-total checks, but do not reject solely on total-versus-budget. Any
database persistence RPC must follow the same rule; preserve the original budget
and disclose overages. Never invent or alter line prices to fit a budget, and
never automatically regenerate to repair arithmetic.
