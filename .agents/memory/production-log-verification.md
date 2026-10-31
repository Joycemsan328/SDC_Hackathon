---
name: Production log verification limits
description: Empty runtime telemetry must not be reported as proof of a healthy production deployment.
---

Treat zero returned errors as inconclusive when an unfiltered runtime query also
returns no entries. Confirm availability independently, and disclose the missing
log sample rather than stating that production logs are clean.

**Why:** After a successful EventFlow republish, revision-scoped telemetry and the
current-build log reader both returned no runtime entries despite independently
verified successful API and browser requests.

**How to apply:** For post-publish sign-off, separate HTTP/browser results from
log evidence. Never infer a crash from empty logs either.

## Production activation flags

Do not equate workspace production environment metadata with the running
deployment's effective flag values. Publishing-specific secret overrides are a
separate source; they override workspace configuration and require republishing
to reach a running deployment. Never change activation flags during diagnosis.

**Why:** The user reported enabled flags in Publishing while workspace metadata
still reported disabled flags, and production logs confirmed the backend gate
was rejecting generation. The user explicitly said to stop changing flags blindly.

**How to apply:** Separate configured values, Publishing overrides, and runtime
evidence. A gate rejection proves at least one exact-string check failed, not
which flag failed. Without a safe existing runtime diagnostic, disclose that
individual process values cannot be verified; never invoke generation to probe
them. A successful build or health response alone does not verify code identity
or flag activation.

Production paid-generation activation flags should have one configuration
source: Publishing deployment secrets, not duplicate workspace production defaults.

**Why:** The owner authorized removing the disabled workspace definitions to
reconcile the conflicting configuration while preserving exact-string backend checks.

**How to apply:** Do not recreate duplicate production defaults without approval.
Ensure Publishing values are saved before republishing; missing or nonexact
values must continue to fail closed. Never change paid-activation settings as a
side effect of quota maintenance.
