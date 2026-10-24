import assert from "node:assert/strict";
import test from "node:test";
import { profileDestination, type Profile } from "../src/auth/access.ts";

const profile = (changes: Partial<Profile> = {}): Profile => ({
  role: "customer", account_type: "customer", approval_status: "approved", ...changes,
});

test("approved customers go to Customer", () => {
  assert.equal(profileDestination(profile()), "/customer");
});
test("approved business staff go to Business", () => {
  assert.equal(profileDestination(profile({ role: "staff", account_type: "business" })), "/business");
});
test("approved admins go to Business regardless of account type", () => {
  for (const account_type of ["customer", "business", "admin"]) {
    assert.equal(profileDestination(profile({ role: "admin", account_type })), "/business");
  }
});
test("pending, rejected, missing and unknown profiles never enter a portal", () => {
  assert.equal(profileDestination(null), "/pending");
  for (const role of ["customer", "staff", "admin"]) {
    for (const approval_status of ["pending", "rejected", "", "unknown"]) {
      assert.equal(profileDestination(profile({ role, approval_status })), "/pending");
    }
  }
  assert.equal(profileDestination(profile({ role: "business", account_type: "business" })), "/pending");
  assert.equal(profileDestination(profile({ role: "staff", account_type: "customer" })), "/pending");
  assert.equal(profileDestination(profile({ role: "customer", account_type: "business" })), "/pending");
});
test("editable metadata cannot grant staff or admin access", () => {
  const unapproved = { ...profile({ approval_status: "pending" }), user_metadata: { role: "admin", approval_status: "approved" } };
  assert.equal(profileDestination(unapproved), "/pending");
});
