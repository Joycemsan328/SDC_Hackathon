import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  handleVitePreloadError,
  shouldRetryAfterVitePreloadError,
} from "../src/lib/vite-preload-recovery";

// Structural regressions for the real portal source, without auth or database I/O.
const text = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("BusinessPortal.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const authText = readFileSync(new URL("../src/auth/UnifiedAuth.tsx", import.meta.url), "utf8");
const authSource = ts.createSourceFile("UnifiedAuth.tsx", authText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const accountText = readFileSync(new URL("../src/business/BusinessAccountPage.tsx", import.meta.url), "utf8");
const mainText = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}
test("Business routes do not create a new component type on each parent render", () => {
  const routes = findAll(node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Route");
  assert.ok(routes.length >= 12);
  for (const node of routes) {
    const route = node as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
    for (const attribute of route.attributes.properties) {
      if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "component") {
        assert.ok(attribute.initializer && ts.isJsxExpression(attribute.initializer));
        assert.ok(attribute.initializer.expression && ts.isIdentifier(attribute.initializer.expression),
          "Use stable JSX children or a named component, never an inline route factory");
      }
    }
  }
});
test("My Account is a stable Business route using the authenticated account and existing Events page", () => {
  assert.match(text, /\{ href: "\/account", label: "My Account"/);
  assert.match(text, /<Route path="\/account">\s*<BusinessAccountPage \/>/);
  assert.match(accountText, /useUnifiedAuth\(\)/);
  assert.match(accountText, /session\?\.user\.email/);
  assert.match(accountText, /profile\?\.full_name/);
  assert.match(accountText, /await signOut\(\)/);
  assert.match(accountText, /navigate\("\/login", \{ replace: true \}\)/);
  assert.match(accountText, /href="\/events"/);
  assert.match(accountText, /reliable count cannot be shown/);
  assert.doesNotMatch(accountText, /\.from\(["']events["']\)/);
});
test("sidebar excludes demo-only controls while the My Account sign-out remains", () => {
  assert.doesNotMatch(text, /Studio note|button-view-availability|button-reset-demo|Reset demo data/);
  assert.doesNotMatch(text, /Unable to log out:/);
  assert.match(text, /label: "Admin Approvals",\s*icon: ClipboardCheck,\s*\},\s*\{ href: "\/account", label: "My Account"/);
  assert.doesNotMatch(text, /Elena Chong|Studio director|button-settings/);
  assert.match(accountText, /data-testid="button-account-sign-out"/);
  assert.match(accountText, /await signOut\(\)/);
});
test("all four Dashboard KPI cards are Wouter links to their existing routes", () => {
  const dashboard = findAll(node => ts.isFunctionDeclaration(node) && node.name?.text === "Dashboard")[0];
  assert.ok(dashboard);
  const metricCards = findAll(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "Metric", dashboard);
  const metrics = metricCards.map((node) => {
    const element = node as ts.JsxSelfClosingElement;
    const prop = (name: string) => element.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name,
    )?.initializer;
    const readString = (name: string) => {
      const initializer = prop(name);
      return initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
    };
    return {
      label: readString("label"),
      href: readString("href"),
    };
  });
  assert.deepEqual(metrics.map(({ label, href }) => [
    (label as ts.StringLiteral).text,
    (href as ts.StringLiteral).text,
  ]), [
    ["Open requests", "/requests"],
    ["Recently Updated Requests", "/requests"],
    ["Confirmed events", "/events"],
    ["Awaiting approval", "/approvals"],
  ]);
  const metric = findAll(node => ts.isFunctionDeclaration(node) && node.name?.text === "Metric")[0];
  assert.ok(metric);
  assert.ok(findAll(node => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "Link", metric).length > 0);
  assert.match(metric.getText(source), /focus-visible:ring-2/);
  assert.match(metric.getText(source), /cursor-pointer/);
  assert.match(text, /from "wouter"/);
  assert.doesNotMatch(text, /Last 7 Days/);
});
test("stale Vite chunks trigger at most one automatic reload per minute", () => {
  assert.equal(shouldRetryAfterVitePreloadError(null, 100_000), true);
  assert.equal(shouldRetryAfterVitePreloadError("70000", 100_000), false);
  assert.equal(shouldRetryAfterVitePreloadError("40000", 100_000), true);
  assert.equal(shouldRetryAfterVitePreloadError("not-a-time", 100_000), true);
  assert.equal(shouldRetryAfterVitePreloadError("120000", 100_000), false);
  assert.match(mainText, /installVitePreloadRecovery\(\)/);
});
test("Vite preload errors reload once and preserve the error boundary fallback on repeated failures", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  let reloads = 0;
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  const reload = () => { reloads += 1; };

  handleVitePreloadError(event, () => storage, reload, 100_000);
  handleVitePreloadError(event, () => storage, reload, 100_030);
  assert.equal(reloads, 1);
  assert.equal(prevented, 2);

  handleVitePreloadError(event, () => { throw new Error("storage blocked"); }, reload, 200_000);
  assert.equal(reloads, 1);
  assert.equal(prevented, 3);
});
test("recent request metric counts unique, non-null updated_at values in the last seven days", () => {
  const helper = findAll(node => ts.isFunctionDeclaration(node) && node.name?.text === "countRecentlyUpdatedRequests")[0];
  assert.ok(helper);
  const javascript = ts.transpileModule(helper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const count = runInNewContext(
    `${javascript}; countRecentlyUpdatedRequests`,
  ) as (requests: { id: string; updatedAt?: string | null }[], now: number) => number;
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(count([
    { id: "recent", updatedAt: new Date(now - day).toISOString() },
    { id: "recent", updatedAt: new Date(now - 2 * day).toISOString() },
    { id: "boundary", updatedAt: new Date(now - 7 * day).toISOString() },
    { id: "old", updatedAt: new Date(now - 7 * day - 1).toISOString() },
    { id: "null", updatedAt: null },
    { id: "future", updatedAt: new Date(now + 1).toISOString() },
    { id: "invalid", updatedAt: "not-a-timestamp" },
  ], now), 2);
  assert.equal(count([], now), 0);
  assert.match(text, /\.select\("[^"]*updated_at"\)/);
  assert.match(text, /updatedAt: row\.updated_at/);
  assert.match(text, /countRecentlyUpdatedRequests\(supabaseRequests\)/);
  assert.match(text, /label="Recently Updated Requests"/);
  assert.match(text, /detail="Requests updated in the last 7 days"/);
  assert.match(text, /value=\{requestFetchState === "loaded" \? recentlyUpdatedRequestCount : "—"\}/);
});
for (const setter of ["setRequestFetchState", "setProposalFetchState"]) {
  test(`${setter} shows loading initially, not during background refresh`, () => {
    const callbacks = findAll(node => ts.isCallExpression(node) && node.expression.getText(source) === setter &&
      node.arguments.length === 1 && ts.isArrowFunction(node.arguments[0]!)) as ts.CallExpression[];
    assert.equal(callbacks.length, 1);
    const transition = runInNewContext(`(${callbacks[0]!.arguments[0]!.getText(source)})`) as (state: string) => string;
    assert.equal(transition("idle"), "loading");
    for (const state of ["loaded", "loading", "error"]) assert.equal(transition(state), state);
  });
}
test("failed refreshes retain loaded data and the ten-second freshness interval", () => {
  const failures = findAll(node => ts.isCatchClause(node) ||
    (ts.isIfStatement(node) && ["error", "lineError"].includes(node.expression.getText(source))));
  for (const failure of failures) {
    const clears = findAll(node => ts.isCallExpression(node) &&
      ["setSupabaseRequests", "setSupabaseProposals"].includes(node.expression.getText(source)) &&
      node.arguments[0]?.getText(source) === "[]", failure);
    assert.equal(clears.length, 0, "A failed refresh must not erase the previous successful data");
  }
  assert.match(text, /setInterval\(refresh,\s*10_000\)/);
  assert.match(text, /Previously loaded proposals may be out of date/);
});
test("stable admin route retains explicit background registration refresh", () => {
  assert.match(text, /<AdminApprovalsPage refreshVersion=\{remoteVersion\}/);
  const admin = findAll(node => ts.isFunctionDeclaration(node) && node.name?.text === "AdminApprovalsPage")[0]!;
  const effects = findAll(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect", admin) as ts.CallExpression[];
  assert.ok(effects.some(effect => effect.arguments[1]?.getText(source) === "[refreshVersion]"));
  assert.equal(findAll(node => ts.isCallExpression(node) && node.expression.getText(source) === "setLoadingBusinesses" &&
    node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword, admin).length, 0);
});
test("verified same-user portal revalidation avoids blocking while other auth changes remain gated", () => {
  const helper = findAll(node => ts.isFunctionDeclaration(node) && node.name?.text === "isVerifiedSessionRevalidation", authSource)[0];
  assert.ok(helper);
  const javascript = ts.transpileModule(helper.getText(authSource), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const isBackgroundBusinessRefresh = runInNewContext(
    `${javascript}; isVerifiedSessionRevalidation`,
  ) as (event: string, next: { user: { id: string } } | null, verifiedId: string | null) => boolean;
  assert.equal(isBackgroundBusinessRefresh("TOKEN_REFRESHED", { user: { id: "staff-1" } }, "staff-1"), true);
  assert.equal(isBackgroundBusinessRefresh("SIGNED_IN", { user: { id: "staff-1" } }, "staff-1"), true);
  assert.equal(isBackgroundBusinessRefresh("USER_UPDATED", { user: { id: "staff-1" } }, "staff-1"), true);
  assert.equal(isBackgroundBusinessRefresh("TOKEN_REFRESHED", { user: { id: "customer-1" } }, null), false);
  assert.equal(isBackgroundBusinessRefresh("TOKEN_REFRESHED", { user: { id: "customer-1" } }, "customer-1"), true);
  assert.equal(isBackgroundBusinessRefresh("TOKEN_REFRESHED", { user: { id: "staff-2" } }, "staff-1"), false);
  assert.equal(isBackgroundBusinessRefresh("TOKEN_REFRESHED", null, "staff-1"), false);
  assert.equal(isBackgroundBusinessRefresh("SIGNED_OUT", { user: { id: "staff-1" } }, "staff-1"), false);
  assert.equal(isBackgroundBusinessRefresh("PASSWORD_RECOVERY", { user: { id: "staff-1" } }, "staff-1"), false);
  assert.match(authText, /if \(!isVerifiedSessionRevalidation\(event, next, verifiedPortalUserId\.current\)\)/);
  assert.match(authText, /profileDestination\(loadedProfile\) !== "\/pending"/);
});
test("auth subscriptions and Business refresh listeners are cleaned up", () => {
  assert.match(authText, /subscription\.unsubscribe\(\)/);
  assert.match(authText, /timers\.forEach\(clearTimeout\)/);
  assert.match(authText, /removeEventListener\("focus", refresh\)/);
  assert.match(text, /clearInterval\(timer\)/);
  assert.match(text, /removeEventListener\("focus", refresh\)/);
  assert.match(text, /removeEventListener\("eventflow-workflow-updated", refresh\)/);
});
