type EventDataStatusProps = {
  state: "idle" | "loading" | "loaded" | "error";
  error: string;
  venueNamesUnavailable?: boolean;
};

export default function EventDataStatus({
  state,
  error,
  venueNamesUnavailable = false,
}: EventDataStatusProps) {
  if (state === "idle") return null;

  if (state === "loading") {
    return (
      <p
        className="mb-3 text-[11px] text-[#827889]"
        role="status"
        data-testid="status-supabase-events"
      >
        Loading events…
      </p>
    );
  }

  if (state === "error") {
    return (
      <div
        role="alert"
        className="mb-4 rounded-xl border border-[#efcfd1] bg-[#fff4f4] px-4 py-3 text-xs text-[#a34e58]"
        data-testid="status-supabase-events"
      >
        Events could not be refreshed. Previously loaded events remain visible.
        {error ? ` ${error}` : ""} Refresh the page to try again.
      </div>
    );
  }

  if (!venueNamesUnavailable) return null;

  return (
    <p
      className="mb-3 text-[11px] text-[#74677b]"
      role="status"
      data-testid="status-supabase-events"
    >
      Some venue names are not available to this Business account.
    </p>
  );
}
