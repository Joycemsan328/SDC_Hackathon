import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express from "express";
import { test } from "node:test";
import { createProposalRouter } from "../src/routes/proposals";
import type { GeneratedProposal } from "../src/services/proposalGenerator";

const requirements = {
  eventName: "Garden dinner", eventType: "Birthday", eventDate: "2027-04-15", location: "Kuala Lumpur",
  guestCount: 24, budgetMYR: 8_000, theme: "Warm garden", selectedServices: ["Catering"], requirements: "A relaxed dinner.",
};
const generated = { plans: ["A", "B"] } as unknown as GeneratedProposal;

async function startServer(router: ReturnType<typeof createProposalRouter>) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server: Server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}/dev/proposals/generate` };
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
}

async function post(url: string, body: unknown, key = "evt-demo-1") {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

test("keeps proposal generation disabled outside opt-in development mode", async (context) => {
  let calls = 0;
  const router = createProposalRouter({ generate: async () => { calls += 1; return generated; } }, { NODE_ENV: "production", RUNPOD_DEV_TEST_ENABLED: "true" });
  const { server, url } = await startServer(router);
  context.after(() => closeServer(server));
  const response = await post(url, requirements);
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test("validates customer requirements before calling the generator", async (context) => {
  let calls = 0;
  const router = createProposalRouter({ generate: async () => { calls += 1; return generated; } }, { NODE_ENV: "development", RUNPOD_DEV_TEST_ENABLED: "true" });
  const { server, url } = await startServer(router);
  context.after(() => closeServer(server));
  const response = await post(url, { ...requirements, guestCount: 0 });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("reuses the same result for duplicate submissions and rejects key reuse with changed input", async (context) => {
  let calls = 0;
  const router = createProposalRouter({ generate: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return generated; } }, { NODE_ENV: "development", RUNPOD_DEV_TEST_ENABLED: "true" });
  const { server, url } = await startServer(router);
  context.after(() => closeServer(server));

  const [first, duplicate] = await Promise.all([post(url, requirements), post(url, requirements)]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await first.json(), { proposal: generated });
  assert.deepEqual(await duplicate.json(), { proposal: generated });
  assert.equal(calls, 1);

  const conflict = await post(url, { ...requirements, theme: "Different theme" });
  assert.equal(conflict.status, 409);
  assert.equal(calls, 1);
});
