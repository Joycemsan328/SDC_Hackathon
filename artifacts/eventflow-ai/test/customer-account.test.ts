import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(new URL("../src/customer/Portal.tsx", import.meta.url), "utf8");
const shell = portal.slice(portal.indexOf("function AppShell("), portal.indexOf("function PageTitle("));
const account = portal.slice(portal.indexOf("function CustomerAccountPage("), portal.indexOf("export function CustomerArea("));

test("Customer sidebar has account navigation instead of sign-out controls", () => {
  assert.match(portal, /const accountNavItem = \{ href: '\/account', label: 'My Account', icon: CircleUserRound \}/);
  assert.match(shell, /data-testid="link-nav-my-account"/);
  assert.match(shell, /data-testid=\{`link-mobile-\$\{label\.toLowerCase\(\)\.replaceAll\(' ', '-'\)\}`\}/);
  assert.match(shell, /grid-cols-4/);
  assert.doesNotMatch(shell, /Sign out|button-sign-out|onClick=\{logout\}/);
});

test("Customer account route displays authenticated profile and retains working sign-out", () => {
  assert.match(portal, /<Route path="\/account"><ProtectedRoute><CustomerAccountPage \/><\/ProtectedRoute><\/Route>/);
  assert.match(account, /const \{ user, signOut \} = useCustomer\(\)/);
  assert.match(account, /user\?\.name/);
  assert.match(account, /user\?\.email/);
  assert.match(account, /Customer account/);
  assert.match(account, /Your EventFlow Customer profile and account access\./);
  assert.match(account, /Sign out of your Customer account on this device\./);
  assert.match(account, /await signOut\(\)/);
  assert.match(account, /setPath\('~\/login', \{ replace: true \}\)/);
  assert.match(account, /data-testid="button-customer-account-sign-out"/);
});
