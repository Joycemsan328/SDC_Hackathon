import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveProductionWeb } from "../src/services/productionWeb";

test("one server serves SPA routes and API without mixing HTML into errors", async () => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "eventflow-public-"));
  await mkdir(path.join(publicDir, "assets"));
  await writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>EventFlow</title>");
  await writeFile(path.join(publicDir, "assets", "app-test.js"), "console.log('fixture');");
  const app = express();
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  serveProductionWeb(app, publicDir);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/healthz`)).json(), { status: "ok" });
    for (const route of ["/", "/login", "/customer", "/customer/events/example", "/business", "/business/proposals/example"]) {
      const response = await fetch(`${base}${route}`, { headers: { accept: "text/html" } });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(await response.text(), /EventFlow/);
    }
    const asset = await fetch(`${base}/assets/app-test.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") || "", /immutable/);
    for (const route of ["/api/missing", "/assets/missing.js", "/missing.css", "/.env"]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, route);
      assert.doesNotMatch(response.headers.get("content-type") || "", /text\/html/, route);
    }
    assert.equal((await fetch(`${base}/business`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/customer`, { headers: { accept: "application/json" } })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("missing frontend output fails startup clearly", () => {
  assert.throws(() => serveProductionWeb(express(), path.join(os.tmpdir(), "missing-eventflow-build", "public")), /production build is missing/);
});
