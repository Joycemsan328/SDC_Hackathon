import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EVENT_AREAS,
  EVENT_LOCATION_SUPPORT_MESSAGE,
  formatEventLocation,
} from "../src/customer/eventLocation";

test("Customer location form only provides supported region and area choices", () => {
  assert.deepEqual(Object.keys(EVENT_AREAS), ["Kuala Lumpur", "Selangor"]);
  assert.ok(EVENT_AREAS["Kuala Lumpur"].includes("Bangsar"));
  assert.ok(EVENT_AREAS.Selangor.includes("Petaling Jaya"));
  assert.equal(formatEventLocation("Selangor", "Petaling Jaya", "Venue, Block A"), "Venue, Block A, Petaling Jaya, Selangor");
  assert.equal(formatEventLocation("Kuala Lumpur", "KLCC"), "KLCC, Kuala Lumpur");
  assert.equal(formatEventLocation("Penang", "George Town"), null);
  assert.equal(formatEventLocation("Selangor", "George Town"), null);
});

test("Customer Create Event uses supported selectors and keeps the coverage message visible", () => {
  const portal = readFileSync(new URL("../src/customer/Portal.tsx", import.meta.url), "utf8");
  assert.match(portal, /name="region"/);
  assert.match(portal, /name="area"/);
  assert.match(portal, /name="venue"/);
  assert.doesNotMatch(portal, /name="location"/);
  assert.match(portal, /EVENT_LOCATION_SUPPORT_MESSAGE/);
  assert.equal(
    EVENT_LOCATION_SUPPORT_MESSAGE,
    "EventFlow AI currently supports event planning in Kuala Lumpur and Selangor only.",
  );
});
