---
name: Portal auth revalidation
description: Security and rendering boundary for background authentication checks in both unified portals.
---

Keep an already verified Customer or Business portal mounted while revalidating the same user's session and profile. Do not do this for sign-out, a different user, an unverified identity, or a failed profile check; those paths must remain fail-closed. Focus-based profile checks should not activate the initial full-screen loading state.

**Why:** Replacing either portal during same-user background checks caused disruptive flickering and lost form state, while skipping profile revalidation could leave revoked access visible.

**How to apply:** Keep the verified user identity as the condition for non-blocking revalidation, re-check the profile, and clear that identity on sign-out, identity change, or verification failure. Preserve Supabase RLS and server-side authorization.
