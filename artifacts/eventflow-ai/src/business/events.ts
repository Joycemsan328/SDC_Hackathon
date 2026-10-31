export type EventSource = "demo" | "supabase";

export type EventItem = {
  id: string;
  proposalId?: string | null;
  customerId?: string | null;
  venueId?: string | null;
  venueName?: string | null;
  customer: string;
  name: string;
  date: string;
  time: string;
  endTime?: string | null;
  status: string;
  value: number;
  type: string;
  guests: number | null;
  source?: EventSource;
};

export type SupabaseEventRow = {
  id: string;
  proposal_id: string | null;
  customer_id: string | null;
  venue_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_time: string | null;
  event_end_time: string | null;
  event_type: string | null;
  guests: number | string | null;
  total_value: number | string | null;
  status: string | null;
};

export type EventProposalLink = { id: string; request_id: string };
export type EventRequestName = { id: string; customer_name: string | null };
export type EventVenueName = { id: string; name: string | null };

type ReadResult<T> = { data: T[] | null; error: { message: string } | null };

export type BusinessEventReader = {
  events: () => Promise<ReadResult<SupabaseEventRow>>;
  proposals: (ids: string[]) => Promise<ReadResult<EventProposalLink>>;
  requests: (ids: string[]) => Promise<ReadResult<EventRequestName>>;
  venues: (ids: string[]) => Promise<ReadResult<EventVenueName>>;
};

function requireRead<T>(result: ReadResult<T>, label: string): T[] {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message || "Supabase read failed."}`);
  }
  return result.data ?? [];
}

function numberValue(value: number | string | null, label: string): number {
  const parsed = typeof value === "number" ? value : value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`An Event has an invalid ${label}.`);
  return parsed;
}

function optionalNumber(value: number | string | null, label: string): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`An Event has an invalid ${label}.`);
  return parsed;
}

export function mapSupabaseEvents(
  eventRows: readonly SupabaseEventRow[],
  proposalRows: readonly EventProposalLink[],
  requestRows: readonly EventRequestName[],
  venueRows: readonly EventVenueName[],
): EventItem[] {
  const proposalsById = new Map(proposalRows.map((row) => [row.id, row]));
  const requestsById = new Map(requestRows.map((row) => [row.id, row]));
  const venuesById = new Map(venueRows.map((row) => [row.id, row]));

  return eventRows.map((row) => {
    if (!row.id) throw new Error("An Event is missing its ID.");
    if (!row.status?.trim()) throw new Error(`Event ${row.id} is missing its database status.`);

    let customer = "Customer";
    if (row.proposal_id) {
      const proposal = proposalsById.get(row.proposal_id);
      if (!proposal) throw new Error(`The linked proposal for Event ${row.id} could not be read.`);
      const request = requestsById.get(proposal.request_id);
      if (!request) throw new Error(`The linked request for Event ${row.id} could not be read.`);
      customer = request.customer_name?.trim() || "Customer";
    }

    return {
      id: row.id,
      proposalId: row.proposal_id,
      customerId: row.customer_id,
      venueId: row.venue_id,
      venueName: row.venue_id ? venuesById.get(row.venue_id)?.name?.trim() || null : null,
      customer,
      name: row.event_name?.trim() || "Untitled event",
      date: row.event_date || "",
      time: row.event_time || "Time not set",
      endTime: row.event_end_time,
      status: row.status,
      value: numberValue(row.total_value, "total value"),
      type: row.event_type?.trim() || "Event",
      guests: optionalNumber(row.guests, "guest count"),
      source: "supabase",
    };
  });
}

export async function readBusinessEvents(
  reader: BusinessEventReader,
): Promise<{ events: EventItem[]; venueNamesUnavailable: boolean }> {
  const eventRows = requireRead(await reader.events(), "Events could not be loaded");
  if (!eventRows.length) return { events: [], venueNamesUnavailable: false };

  const proposalIds = [...new Set(eventRows.flatMap((row) => row.proposal_id ? [row.proposal_id] : []))];
  const proposalRows = proposalIds.length
    ? requireRead(await reader.proposals(proposalIds), "Event proposal details could not be loaded")
    : [];
  const requestIds = [...new Set(proposalRows.map((row) => row.request_id))];
  const requestRows = requestIds.length
    ? requireRead(await reader.requests(requestIds), "Event customer details could not be loaded")
    : [];

  const venueIds = [...new Set(eventRows.flatMap((row) => row.venue_id ? [row.venue_id] : []))];
  let venueNamesUnavailable = false;
  let venueRows: EventVenueName[] = [];
  if (venueIds.length) {
    const venueResult = await reader.venues(venueIds);
    if (venueResult.error) {
      venueNamesUnavailable = true;
    } else {
      venueRows = venueResult.data ?? [];
      const resolvedIds = new Set(venueRows.map((row) => row.id));
      venueNamesUnavailable = venueIds.some((id) => !resolvedIds.has(id));
    }
  }

  return {
    events: mapSupabaseEvents(eventRows, proposalRows, requestRows, venueRows),
    venueNamesUnavailable,
  };
}
