import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { profileDestination } from "../src/auth/access";

// Execute the actual effect bodies with controlled I/O; never contact Supabase/RunPod.
const dataText = readFileSync(new URL("../src/customer/data.tsx", import.meta.url), "utf8");
const authText = readFileSync(new URL("../src/auth/UnifiedAuth.tsx", import.meta.url), "utf8");
function effect(text: string, marker: string): string {
  const source = ts.createSourceFile("portal.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes(marker)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, marker);
  return ts.transpileModule(`(${callback.getText(source).replaceAll("import.meta.env.DEV", "false")})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}
const dataEffect = effect(dataText, "refreshRemote.current =");
const authEffect = effect(authText, "const restore =");
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const requestRow = { id: "request-1", customer_id: "customer-1" };
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function dataHarness() {
  const snapshot = { id: "request-1", requestSource: "supabase", proposal: { revision: "1", plans: ["A", "B"] } };
  const context: any = {
    user: { id: "customer-1" }, remoteOwner: { current: null }, refreshRemote: { current: () => {} },
    customerResponseSnapshots: { current: { userId: "customer-1", rows: new Map() } },
    state: { events: [{ id: "demo", requestSource: "demo" }, snapshot], changeRequests: [] },
    loading: false, loadingChanges: [] as boolean[], error: "", customerResponseError: "",
    CUSTOMER_RESPONSE_WORKFLOW_ENABLED: false, calls: 0,
    request: deferred(), proposals: { data: [], error: null }, customerResponsesResult: { data: [], error: null },
    authResult: { data: { user: { id: "customer-1" } }, error: null },
    AbortController, console,
    mapSavedRequest: (row: any) => ({ ...snapshot, ...row, requestSource: "supabase" }),
  };
  context.setState = (update: any) => { context.state = update(context.state); };
  context.setRemoteLoading = (value: boolean) => { context.loading = value; context.loadingChanges.push(value); };
  context.setRemoteError = (value: string) => { context.error = value; };
  context.setCustomerResponseError = (value: string) => { context.customerResponseError = value; };
  context.setGenerationNotices = () => {};
  context.supabase = {
    auth: { getUser: async () => { context.calls++; return context.authResult; } },
    from: (table: string) => {
      const query: any = {
        select: () => query, eq: () => query, order: () => query, in: () => query,
        abortSignal: (signal: AbortSignal) => {
          context.signal = signal;
          if (table === "requests") return context.request.promise;
          if (table === "proposals") return Promise.resolve(context.proposals);
          return Promise.resolve(context.customerResponsesResult);
        },
      };
      return query;
    },
  };
  const cleanup = runInNewContext(dataEffect, context)();
  return { context, cleanup, snapshot };
}
test("initial fetch blocks; repeated background refreshes preserve cards, details and proposal snapshots", async () => {
  const { context: c, cleanup } = dataHarness();
  assert.equal(c.loading, true);
  assert.equal(c.state.events.length, 1, "previous account's private records are removed initially");
  c.request.resolve({ data: [requestRow], error: null });
  await settle();
  assert.equal(c.loading, false);
  assert.equal(c.state.events.length, 2);
  const loadingTransitions = c.loadingChanges.length;
  for (let cycle = 0; cycle < 3; cycle++) {
    const stableSnapshot = c.state.events;
    c.request = deferred();
    c.refreshRemote.current();
    const calls = c.calls;
    c.refreshRemote.current(); // focus/timer overlap while the first query is pending
    await settle();
    assert.equal(c.calls, calls, "overlapping refresh is skipped");
    assert.equal(c.loading, false);
    assert.equal(c.state.events, stableSnapshot);
    assert.deepEqual(c.state.events[0].proposal.plans, ["A", "B"]);
    c.request.resolve({ data: [requestRow], error: null });
    await settle();
  }
  assert.equal(c.loadingChanges.slice(loadingTransitions).includes(true), false);
  cleanup();
});
test("response-read failures preserve the last saved response and report its stale state", async () => {
  const { context: c, cleanup } = dataHarness();
  c.CUSTOMER_RESPONSE_WORKFLOW_ENABLED = true;
  const savedResponse = {
    id: "response-1", request_id: "request-1", revision: "1", customer_id: "customer-1",
    plan_a_id: "proposal-a", plan_b_id: "proposal-b", response_kind: "selection",
    response_status: "selection_submitted", selected_proposal_id: "proposal-a", feedback: "",
    idempotency_key: "operation-1", responded_at: "2026-10-30T10:00:00.000Z",
  };
  c.customerResponseSnapshots.current.rows.set("request-1:1", savedResponse);
  c.customerResponsesResult = { data: null, error: { message: "response table unavailable" } };
  c.request.resolve({ data: [requestRow], error: null });
  await settle();
  await settle();
  const loaded = c.state.events.find((event: any) => event.requestSource === "supabase");
  assert.equal(loaded.customerResponse.id, "response-1");
  assert.match(c.customerResponseError, /Previously displayed responses may be out of date/);
  cleanup();
});
test("request and proposal failures retain the last successful data and report stale data", async () => {
  const { context: c, cleanup } = dataHarness();
  c.request.resolve({ data: [requestRow], error: null });
  await settle();
  const snapshot = c.state.events;
  c.request = deferred();
  c.refreshRemote.current();
  c.request.resolve({ data: null, error: { message: "network unavailable" } });
  await settle();
  assert.equal(c.state.events, snapshot);
  assert.match(c.error, /Saved requests could not be loaded: network unavailable/);
  c.request = deferred();
  c.proposals = { data: null, error: { message: "proposal query unavailable" } };
  c.refreshRemote.current();
  c.request.resolve({ data: [requestRow], error: null });
  await settle();
  assert.equal(c.state.events, snapshot);
  assert.match(c.error, /Saved plans could not be loaded: proposal query unavailable/);
  cleanup();
});
test("disposed account fetches are aborted and cannot write stale results", async () => {
  const { context: c, cleanup } = dataHarness();
  await settle();
  cleanup();
  assert.equal(c.signal.aborted, true);
  const events = c.state.events;
  c.request.resolve({ data: [{ ...requestRow, id: "old-private-request" }], error: null });
  await settle();
  assert.equal(c.state.events, events);
});
test("an explicit changed/invalid identity clears private data before any data query", async () => {
  const { context: c, cleanup } = dataHarness();
  c.request.resolve({ data: [requestRow], error: null });
  await settle();
  c.authResult = { data: { user: { id: "customer-2" } }, error: null };
  c.refreshRemote.current();
  await settle();
  assert.equal(c.state.events.some((event: any) => event.requestSource === "supabase"), false);
  cleanup();
});
function authHarness(destination: "customer" | "business") {
  const id = `${destination}-1`;
  const session = { user: { id } };
  const c: any = {
    activeSession: session, session: null, profile: null, loading: true, error: "",
    version: 0, sequence: { current: 0 }, verifiedPortalUserId: { current: null },
    profileDestination, jobs: [] as (() => void)[], unsubscribed: false,
    profileResponse: { data: { role: destination === "customer" ? "customer" : "staff", account_type: destination, approval_status: "approved" }, error: null },
    isVerifiedSessionRevalidation: (event: string, next: any, verified: string | null) =>
      ["TOKEN_REFRESHED", "SIGNED_IN", "USER_UPDATED"].includes(event) && !!next && !!verified && next.user.id === verified,
  };
  for (const field of ["session", "profile", "loading", "error"]) {
    c[`set${field[0].toUpperCase()}${field.slice(1)}`] = (value: any) => { c[field] = value; };
  }
  c.setTimeout = (callback: () => void) => { c.jobs.push(callback); return callback; };
  c.clearTimeout = (callback: () => void) => { c.jobs = c.jobs.filter((job: any) => job !== callback); };
  c.supabase = {
    auth: {
      getSession: async () => ({ data: { session: c.activeSession }, error: null }),
      onAuthStateChange: (callback: any) => {
        c.emit = callback;
        return { data: { subscription: { unsubscribe: () => { c.unsubscribed = true; } } } };
      },
    },
    from: () => {
      const query: any = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve(c.profileResponse) };
      return query;
    },
  };
  const cleanup = runInNewContext(authEffect, c)();
  const flush = async () => { while (c.jobs.length) c.jobs.shift()(); await settle(); };
  return { c, session, cleanup, flush };
}
for (const portal of ["customer", "business"] as const) {
  test(`${portal}: same-user auth events stay non-blocking; profile failure revokes access`, async () => {
    const { c, session, cleanup, flush } = authHarness(portal);
    await settle();
    assert.equal(c.loading, false);
    assert.equal(c.verifiedPortalUserId.current, session.user.id);
    for (const event of ["TOKEN_REFRESHED", "SIGNED_IN", "USER_UPDATED"]) {
      c.emit(event, session);
      assert.equal(c.loading, false);
      await flush();
      assert.equal(c.loading, false);
      assert.equal(c.error, "");
    }
    c.profileResponse = { data: null, error: new Error("profile denied") };
    c.emit("TOKEN_REFRESHED", session);
    await flush();
    assert.equal(c.profile, null);
    assert.equal(c.verifiedPortalUserId.current, null);
    assert.match(c.error, /couldn’t verify/);
    cleanup();
    assert.equal(c.unsubscribed, true);
    assert.equal(c.jobs.length, 0);
  });
  test(`${portal}: account switch and sign-out immediately gate and clear the old profile`, async () => {
    const { c, cleanup, flush } = authHarness(portal);
    await settle();
    c.emit("SIGNED_IN", { user: { id: "different-account" } });
    assert.equal(c.loading, true);
    assert.equal(c.profile, null);
    await flush();
    c.emit("SIGNED_OUT", null);
    assert.equal(c.session, null);
    assert.equal(c.profile, null);
    assert.equal(c.loading, true);
    await flush();
    assert.equal(c.loading, false);
    cleanup();
  });
}
test("polling remains ten seconds; account changes reset Customer provider; background ticks do not reset preferences", () => {
  assert.match(dataText, /setInterval\(refresh,\s*10_000\)/);
  assert.match(dataText, /removeEventListener\("focus", refresh\)/);
  assert.match(dataText, /refreshRemote\.current\(\); \}, \[reloadVersion\]/);
  assert.doesNotMatch(dataText, /\[user\?\.id, reloadVersion\]/);
  const routes = readFileSync(new URL("../src/auth/UnifiedRoutes.tsx", import.meta.url), "utf8");
  assert.match(routes, /CustomerProvider key=\{session\.user\.id\}/);
});
