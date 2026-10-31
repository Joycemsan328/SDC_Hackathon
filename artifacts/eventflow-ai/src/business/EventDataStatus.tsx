type EventDataStatusProps = {
  state: "idle" | "loading" | "loaded" | "error";
  error: string;
  eventCount: number;
  venueNamesUnavailable?: boolean;
};

export default function EventDataStatus({
  state,
  error,
  eventCount,
  venueNamesUnavailable = false,
}: EventDataStatusProps) {
  if (state === "idle") return null;

  const message = state === "loading"
    ? "Loading live Events from Supabase. Demo events are marked separately."
    : state === "error"
      ? `Live Events could not be refreshed; previously loaded records are still shown. ${error}`
      : eventCount === 0
        ? "No live Supabase Events were found. Demo events are marked separately."
        : `${eventCount} live ${eventCount === 1 ? "Event" : "Events"} loaded from Supabase. Demo events are marked separately.`;

  return (
    <div
      role={state === "error" ? "alert" : "status"}
      className={`mb-4 rounded-xl border px-4 py-3 text-xs ${state === "error" ? "border-[#efcfd1] bg-[#fff4f4] text-[#a34e58]" : "border-[#e7dfe9] bg-[#fbf8fc] text-[#74677b]"}`}
      data-testid="status-supabase-events"
    >
      <p>{message}</p>
      <p className="mt-1">Live Events are read-only in Phase 3A; creating or changing them is reserved for Phase 3B.</p>
      {state === "loaded" && venueNamesUnavailable && (
        <p className="mt-1">Some venue names are not available to this Business account; venue IDs are not displayed.</p>
      )}
    </div>
  );
}
