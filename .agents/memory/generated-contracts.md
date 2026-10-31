---
name: Generated contract compatibility
description: Non-obvious constraints when extending OpenAPI and regenerating this workspace's client and Zod exports.
---

Use named OpenAPI components for request bodies instead of inline body schemas when generating both Zod schemas and TypeScript types.

**Why:** Inline body schemas caused identically named runtime Zod exports and TypeScript exports to collide in the shared barrel. Named components avoid that generator naming collision.

**How to apply:** Model the body as a component reference, then regenerate both outputs together. Generated fetch hooks also use iterable Headers, so their TypeScript compilation needs the DOM iterable library.
