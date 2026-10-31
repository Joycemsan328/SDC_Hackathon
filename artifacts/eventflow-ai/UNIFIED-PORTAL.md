# Unified EventFlow website

Main application: `artifacts/eventflow-ai`. The standalone Business app remains untouched as a backup.

## Run

In Replit use the existing managed workflow **artifacts/eventflow-ai: web**, whose command is:

```sh
pnpm --filter @workspace/eventflow-ai run dev
```

It injects `PORT` and `BASE_PATH`. For a direct shell launch instead (only if the managed workflow is stopped):

```sh
PORT=19894 BASE_PATH=/ pnpm --filter @workspace/eventflow-ai run dev
```

Keep the existing Express workflow running:

```sh
pnpm --filter @workspace/api-server run dev
```

## Entry points

- `/login` and `/register`: the shared Supabase authentication screen, with customer/business registration requests.
- `/customer`: approved Customer dashboard; events are under `/customer/events`.
- `/business`: approved Staff/Admin dashboard; requests/proposals/approvals keep their existing routes under this prefix.
- `/pending`: signed-in accounts without an approved, supported database profile.
- Old `/dashboard` and `/events/...` Customer bookmarks redirect into `/customer`.

Only the saved `profiles` row determines access. Signup account type is a request, not authorization. Database RLS and existing API/RPC permission checks remain necessary and unchanged.

## Preview checks (no generation)

1. Open the **EventFlow AI** artifact, not the backup Business artifact.
2. Sign in as an existing approved Customer. Expect `/customer`.
3. Visit My Events and an existing A/B pair, then refresh.
4. Try `/business` as Customer: it must send you back to `/customer`.
5. Log out. Browser Back must not expose a protected screen.
6. Sign in as an existing approved Staff/Admin. Expect `/business`.
7. Open Requests, Proposals and Approvals. Refresh a detail page and navigate back/forward. Links must remain under `/business`.
8. Try `/customer` as Staff/Admin: it must send you back to `/business`.
9. Pending/unapproved users must see the access/approval screen, not either dashboard.
10. Register supports both account requests. Avoid creating real test users unless intended.

Do not create events, generate proposals, approve registrations, or change proposals during a navigation-only test. Those are real actions. No RunPod generation is needed to test this merge.

## Unchanged limitations

This merge adds no database schema and does not activate earlier unapplied SQL.
Saved plan selection and selected-plan review still require the previously provided Supabase migration if it has not already been applied.
Legacy demo-only Business functions remain demo-only; copying them into the unified app does not make them persistent.
Existing proposal approval semantics, Supabase queries, and Express/RunPod integration are preserved.

## Checks

```sh
pnpm run typecheck
PORT=19894 BASE_PATH=/ pnpm --filter @workspace/eventflow-ai run build
pnpm --filter @workspace/api-server exec tsx --test ../eventflow-ai/test/access.test.ts
```

## Verification result

Workspace TypeScript checks, the unified production build, and all five access-policy tests passed.
Browser checks passed for anonymous access, Customer/Staff/Admin routing, pending accounts,
profile-query failure, namespace protection, refresh, logout and history navigation.
Authenticated browser checks used isolated synthetic sessions with intercepted Supabase responses;
they did not verify real account passwords, live registration triggers, or live cross-account writes.
The running user's Customer Preview logs also confirmed existing saved A/B reads after the merge.
No RunPod generation or database writes were performed during these checks.
