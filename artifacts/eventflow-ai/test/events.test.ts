import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CalendarManagementPage from "../src/business/calendar-management";
import EventDataStatus from "../src/business/EventDataStatus";
import {
  mapSupabaseEvents,
  readBusinessEvents,
  type BusinessEventReader,
  type SupabaseEventRow,
} from "../src/business/events";

// tsx's test transform uses classic JSX; provide the React binding expected by
// the existing TSX source without changing the app's Vite JSX runtime.
Object.assign(globalThis, { React });

const baseEvent: SupabaseEventRow = {
  id: "event-1",
  proposal_id: "proposal-1",
  customer_id: "customer-uuid",
  venue_id: null,
  event_name: "Studio anniversary",
  event_date: "2026-11-15",
  event_time: "18:00:00",
  event_end_time: "21:00:00",
  event_type: "Birthday",
  guests: 40,
  total_value: "9500.00",
  status: "Confirmed",
};

const requestLink = [{ id: "proposal-1", request_id: "request-1" }];
const requestName = [{ id: "request-1", customer_name: "Alya Rahman" }];

function reader(overrides: Partial<BusinessEventReader> = {}, calls: string[] = []): BusinessEventReader {
  return {
    events: async () => {
      calls.push("events");
      return { data: [baseEvent], error: null };
    },
    proposals: async () => {
      calls.push("proposals");
      return { data: requestLink, error: null };
    },
    requests: async () => {
      calls.push("requests");
      return { data: requestName, error: null };
    },
    venues: async () => {
      calls.push("venues");
      return { data: [], error: null };
    },
    ...overrides,
  };
}

test("maps a confirmed Event to its request customer name without using UUID fields as display text", () => {
  const [event] = mapSupabaseEvents([baseEvent], requestLink, requestName, []);
  assert.equal(event.id, "event-1");
  assert.equal(event.proposalId, "proposal-1");
  assert.equal(event.customerId, "customer-uuid");
  assert.equal(event.customer, "Alya Rahman");
  assert.equal(event.status, "Confirmed");
  assert.equal(event.value, 9500);
  assert.equal(event.time, "18:00:00");
  assert.equal(event.endTime, "21:00:00");
  assert.equal(event.venueId, null);
  assert.equal(event.venueName, null);
  assert.equal(event.source, "supabase");
});

test("missing request display name never falls back to the customer UUID", () => {
  const [event] = mapSupabaseEvents([baseEvent], requestLink, [{ id: "request-1", customer_name: null }], []);
  assert.equal(event.customer, "Customer");
  assert.notEqual(event.customer, baseEvent.customer_id);
});

test("venue names are included only from the authorized venue lookup result", () => {
  const eventWithVenue = { ...baseEvent, venue_id: "venue-1" };
  const [authorized] = mapSupabaseEvents(
    [eventWithVenue], requestLink, requestName, [{ id: "venue-1", name: "Garden Hall" }],
  );
  const [unresolved] = mapSupabaseEvents([eventWithVenue], requestLink, requestName, []);
  assert.equal(authorized.venueName, "Garden Hall");
  assert.equal(unresolved.venueName, null);
  assert.equal(unresolved.venueId, "venue-1");
});

test("empty reads make no dependent queries and return a successful empty result", async () => {
  const calls: string[] = [];
  const result = await readBusinessEvents(reader({
    events: async () => {
      calls.push("events");
      return { data: [], error: null };
    },
  }, calls));
  assert.deepEqual(result, { events: [], venueNamesUnavailable: false });
  assert.deepEqual(calls, ["events"]);
});

test("permission or read failures reject without clearing caller-owned last-success data", async () => {
  const calls: string[] = [];
  await assert.rejects(
    readBusinessEvents(reader({
      events: async () => {
        calls.push("events");
        return { data: null, error: { message: "permission denied" } };
      },
    }, calls)),
    /permission denied/,
  );
  assert.deepEqual(calls, ["events"]);
});

test("venue lookup denial leaves core Events usable without exposing venue UUIDs as names", async () => {
  const result = await readBusinessEvents(reader({
    events: async () => ({ data: [{ ...baseEvent, venue_id: "venue-1" }], error: null }),
    venues: async () => ({ data: null, error: { message: "permission denied" } }),
  }));
  assert.equal(result.events[0]?.name, "Studio anniversary");
  assert.equal(result.events[0]?.venueId, "venue-1");
  assert.equal(result.events[0]?.venueName, null);
  assert.equal(result.venueNamesUnavailable, true);
});

test("Availability renders a confirmed live Event on its saved calendar date", () => {
  const [event] = mapSupabaseEvents([baseEvent], requestLink, requestName, []);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const markup = renderToStaticMarkup(createElement(CalendarManagementPage, {
    store: { events: [{ ...event, date: todayIso }], blockedSlots: [] },
    openModal: () => {},
    unblockSlot: () => {},
    eventFetchState: "loaded",
    allowLocalEventCreation: false,
  }));
  assert.match(markup, /Studio anniversary/);
  assert.match(markup, /Confirmed/);
  assert.match(markup, /data-testid="calendar-event-event-1"/);
  assert.match(markup, /disabled=""/);
  assert.doesNotMatch(markup, /Live Events are read-only in Phase 3A/);
  assert.doesNotMatch(markup, /live Events loaded from Supabase/);
});

test("Event status keeps useful loading and error feedback but hides routine success banners", () => {
  const loading = renderToStaticMarkup(createElement(EventDataStatus, {
    state: "loading",
    error: "",
  }));
  const error = renderToStaticMarkup(createElement(EventDataStatus, {
    state: "error",
    error: "permission denied",
  }));
  const loaded = renderToStaticMarkup(createElement(EventDataStatus, {
    state: "loaded",
    error: "",
  }));

  assert.match(loading, /Loading events/);
  assert.match(error, /permission denied/);
  assert.match(error, /Refresh the page to try again/);
  assert.equal(loaded, "");
});

test("the portal reads Events through SELECT queries and keeps them out of local demo storage", () => {
  const portal = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../src/business/calendar-management.tsx", import.meta.url), "utf8");
  const dashboard = portal.slice(portal.indexOf("function Dashboard("), portal.indexOf("function Requests("));
  assert.doesNotMatch(dashboard, /RequestFetchNotice/);
  assert.match(portal.slice(portal.indexOf("function Requests("), portal.indexOf("function RequestDetail(")), /RequestFetchNotice/);
  assert.doesNotMatch(calendar, /EventDataStatus|Phase 3A/);
  const readerSource = portal.slice(portal.indexOf("void readBusinessEvents"), portal.indexOf("}, [authLoading, staffUserId, remoteVersion]);", portal.indexOf("void readBusinessEvents")));
  assert.match(readerSource, /\.from\("events"\)\s*\.select\(/);
  assert.match(readerSource, /\.from\("proposals"\)\s*\.select\(/);
  assert.match(readerSource, /\.from\("requests"\)\s*\.select\(/);
  assert.doesNotMatch(readerSource, /\.from\("events"\)[\s\S]*?\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(readerSource, /customer_name\s*,/);
  assert.match(portal, /<Route path="\/events">[\s\S]*?store=\{eventViewStore\}/);
  assert.match(portal, /<Route path="\/calendar">[\s\S]*?store=\{eventViewStore\}/);
  assert.match(portal, /\["All", "Confirmed", "Upcoming"/);
  assert.match(calendar, /event\.status === 'Confirmed'/);
  assert.match(portal, /disabled=\{e\.source === "supabase"\}/);
  assert.match(portal, /disabled\s+title="Event creation is unavailable from this page\."/);
  assert.match(calendar, /disabled=\{!allowLocalEventCreation\}/);
  assert.doesNotMatch(calendar, /Live Events are read-only in Phase 3A/);
  assert.doesNotMatch(calendar, /EventDataStatus/);
  assert.doesNotMatch(portal, /Phase 3A|Phase 3B|Accept Proposal \(Customer Demo\)|saved to Supabase|later update/);
  assert.match(calendar, /Demo sample/);
  assert.match(portal, /Sample supplier data; these listings are not verified partners/);
  assert.match(portal, /Illustrative Data/);
  assert.match(portal, /Refreshing requests…/);
  assert.match(portal, /Refreshing proposals…/);
  assert.match(portal, /\["All", "Confirmed", "Upcoming"/);
  assert.match(portal, /state=\{eventFetchState\}/);
  assert.match(portal, /localStorage\.setItem\(DB_KEY, JSON\.stringify\(store\)\)/);
});
