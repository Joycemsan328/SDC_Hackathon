---
name: Publishing workspace commands
description: Deployment constraints discovered while preparing the unified site's production server.
---

Use explicit workspace-root execution when an artifact service invokes a root package script.

**Why:** A managed service started in its artifact directory; an unqualified pnpm root script failed with “Missing script” despite passing from the shell's repository root. `pnpm -w run ...` fixed the actual managed startup.

**How to apply:** Do not infer a service's working directory from a successful root-shell test. Use workspace-root scripts for the unified build/start and test the real managed workflow.

Publish the unified Customer/Business frontend and Express API as one production service; retain the legacy portals and API service for development only.

**Why:** The owner required one public website and preferred same-origin serving. Separate legacy production route owners can intercept API paths or compete for the root website.

**How to apply:** Check all artifact production configurations before publishing, not only the main frontend. Avoid reintroducing a second API production service or a backup portal at the root. Do not migrate data or invoke RunPod as a deployment smoke test.
