# Publish the unified EventFlow AI website

## Deployment configuration

- `.replit` retains the existing application router and Autoscale target.
- In this pnpm workspace the actual service build/run settings are in
  `artifacts/eventflow-ai/.replit-artifact/artifact.toml`, not `.replit`'s run command.
- Only the unified web artifact has a production service. The API artifact remains a
  development service; its source is bundled into the unified production process.
- The standalone Business artifact is a development-only backup at `/business-backup`.
  No Business source code has been deleted.
- Production build: `pnpm -w run build:production`.
- Production run: `pnpm -w run start:production` (starts the bundled Node Express server)
  with `NODE_ENV` set to production and the service-provided `PORT`.
- Shell equivalent: `pnpm run start:production` with `PORT` supplied.
- Manifest commands use pnpm's workspace-root option because managed service
  commands can start in the artifact directory rather than the repository root.
- One Express process listens on all interfaces and serves the existing React output
  from `artifacts/eventflow-ai/dist/public` and all `/api` routes.
- `/api/healthz` is the startup health check. It does not contact Supabase or RunPod.
- Replit terminates public HTTPS. Browser API requests are same-origin `/api/...`;
  no production browser calls to localhost, no separate API domain or CORS setup.
- The production build deliberately clears the optional `VITE_API_BASE_URL` override.
- SPA fallback supports `/login`, `/customer`, `/business` and their nested pages.
  Unknown API routes and missing assets return 404, not the SPA's HTML.
- Hashed assets are cached; HTML is not kept as a stale application shell.

## Required configuration — names only

Available at **build and runtime**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Server-only deployment secrets:

- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_ID`

Service-managed / explicitly configured by the manifest:

- `PORT`
- `BASE_PATH`
- `NODE_ENV`

Optional server tuning:

- `LOG_LEVEL`
- `RUNPOD_POLL_INTERVAL_MS`
- `RUNPOD_JOB_TIMEOUT_MS`
- `RUNPOD_REQUEST_TIMEOUT_MS`

Optional server aliases, unnecessary when the VITE variables are available at runtime:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Leave `VITE_API_BASE_URL` unset. Do not enable `RUNPOD_DEV_TEST_ENABLED` or
`EVENTFLOW_AI_DEV_ENABLED` in production.

The prepared Business-first generation path requires a backend-only
`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, plus
`EVENTFLOW_BUSINESS_FIRST_ENABLED`. Keep activation absent/false until the
catalog review, approved migration and isolated RLS tests are complete.
`EVENTFLOW_AI_PERSISTENCE_ENABLED` is not used by the mounted generation route.
Do not add a privileged key to a VITE variable.
`SESSION_SECRET` and `DATABASE_URL` are not required by the current Supabase-based
runtime. The generic Drizzle package is not imported by the active API routes.

The two public Supabase variables and both RunPod secrets were confirmed configured
for the production environment during preparation; no secret values were read.
Review the Publishing environment list before publishing.

## Click-by-click publishing

1. Open **Publishing** in Replit (or click **Publish** in the top bar).
2. Open **Adjust settings** / deployment settings.
3. Choose **Autoscale**, not Static. If asked which app to publish, use **EventFlow AI**.
4. Use **Public** visibility so judges can open the website. Supabase login still
   protects the Customer and Business workspaces.
5. Confirm the unified production service uses the build/run commands above.
   Do not configure Vite dev/preview as the production server or add a second API service.
6. Check deployment environment variables and server secrets using the names above.
7. Choose the public subdomain. Review the resource limits, estimated charges and,
   if offered, Advanced geography settings. Geography is fixed after the first publish.
8. **Only when you accept the configuration and charges**, click **Publish**.
9. Wait for build and startup-health success, then open the HTTPS URL shown by Replit.
   That is the single URL to share with judges; the development Preview URL is not it.

This preparation does not publish the project and does not provide an existing
production URL. Deployment status was confirmed unpublished.

## Supabase authentication URL setup

Once the real public URL is known, in the **existing Supabase project's**
Authentication → URL Configuration:

- Set Site URL to the final public website origin.
- Allow the same origin's `/login` callback for email confirmation and redirects.
- Keep needed development redirect URLs if Preview is still used.

Use the actual Replit Publishing URL, not a guessed hostname. Existing password login
uses the same Supabase project and saved profile roles. Business registrations still
require approval; pre-arrange an existing approved Staff/Admin account for judges.
This deployment task creates or approves no accounts and changes no records.

## Expected charges

Replit Autoscale is usage billed: a recurring base fee plus compute, requests and
outbound data transfer; included credits and limits depend on the account plan.
Use the Publishing estimate and current Replit pricing before confirming, rather
than assuming this deployment is free or promising a fixed total.

RunPod GPU/endpoint usage is billed separately when someone actually generates a
proposal; worker minimum/idle settings can also affect its bill. Supabase remains
on the existing project's plan and quotas. No generation or RunPod call was made
during this preparation.

Official references:
- https://docs.replit.com/billing/deployment-pricing
- https://docs.replit.com/billing/aug-cloud-billing-updates

## Verify after publishing (read-only)

1. Open `/api/healthz`: expect JSON with healthy status.
2. Open `/login`, `/customer`, `/business` directly and refresh. Logged-out users
   must reach login, not a server 404.
3. Sign in with existing approved Customer and Staff/Admin accounts separately.
   Confirm their expected workspace and check refresh/logout.
4. Open an existing event with saved Plan A/B; do not click Generate during smoke tests.
5. An unknown `/api/...` endpoint must return JSON 404 rather than HTML.

No database migration is part of the publishing build or startup. The replacement
Business-first SQL is REVIEW ONLY, not installed. Its catalog-review gate is
deliberately closed. See BUSINESS_FIRST_REVIEW.md and scripts/sql/README-eventflow-mvp.md
before considering activation or another publication.
Publication does not make demo-only Business functions persistent, and live
cross-account decision/generation verification has not been performed here.
