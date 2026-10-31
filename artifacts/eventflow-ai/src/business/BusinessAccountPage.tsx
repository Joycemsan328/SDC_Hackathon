import { useState } from "react";
import { ArrowRight, CalendarDays, LogOut, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useUnifiedAuth } from "@/auth/UnifiedAuth";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function BusinessAccountPage() {
  const { session, profile, signOut } = useUnifiedAuth();
  const [, navigate] = useLocation();
  const [signOutState, setSignOutState] = useState<"idle" | "working" | "error">("idle");
  const metadata = session?.user.user_metadata;
  const email = session?.user.email?.trim() ?? "";
  const fullName =
    profile?.full_name?.trim() ||
    asText(metadata?.full_name) ||
    asText(metadata?.name) ||
    email.split("@")[0] ||
    "Business user";
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("") || "BU";
  const avatarUrl = asText(metadata?.avatar_url) || asText(metadata?.picture);

  async function handleSignOut() {
    setSignOutState("working");
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      setSignOutState("error");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="business-account-page">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#a08da8]">Workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#3f3548]">My Account</h1>
        <p className="mt-2 text-sm text-[#897f8d]">Your EventFlow Business profile and account access.</p>
      </header>

      <section className="rounded-2xl border border-[#eee6ef] bg-white p-5 shadow-sm sm:p-7" aria-labelledby="business-profile-heading">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f1e4ef] text-xl font-bold text-[#714981]" aria-label={`${fullName} avatar`}>
            <span aria-hidden="true">{initials}</span>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="business-profile-heading" className="text-lg font-bold text-[#44394d]">{fullName}</h2>
            <p className="mt-1 break-all text-sm text-[#827887]">{email || "Email unavailable"}</p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#f7edf4] px-3 py-1 text-xs font-semibold text-[#875e7d]">
              <ShieldCheck size={14} aria-hidden="true" />
              Business account
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#eee6ef] bg-white p-5 shadow-sm sm:p-7" aria-labelledby="business-events-heading">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f7edf4] text-[#a46c88]">
            <CalendarDays size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="business-events-heading" className="text-base font-bold text-[#44394d]">My Events</h2>
            <p className="mt-1 text-sm text-[#827887]">Account-specific event count is unavailable.</p>
            <p className="mt-2 text-xs leading-relaxed text-[#928899]">
              The available Events data does not identify which events belong to this Business account, so a reliable count cannot be shown.
            </p>
          </div>
          <Link
            href="/events"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#eadde9] px-4 py-2 text-sm font-semibold text-[#76538a] hover:bg-[#fbf7fb]"
            data-testid="link-account-view-events"
          >
            View Events <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-[#eee6ef] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-7" aria-labelledby="account-access-heading">
        <div>
          <h2 id="account-access-heading" className="text-base font-bold text-[#44394d]">Account access</h2>
          <p className="mt-1 text-sm text-[#827887]">Sign out of this Business account on this device.</p>
          {signOutState === "error" && (
            <p className="mt-2 text-sm text-[#a34e58]" role="alert" data-testid="status-account-signout-error">
              We couldn’t sign you out. Please try again.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signOutState === "working"}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#77518a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#684578] disabled:cursor-wait disabled:opacity-60"
          data-testid="button-account-sign-out"
        >
          <LogOut size={15} aria-hidden="true" />
          {signOutState === "working" ? "Signing out…" : "Log Out"}
        </button>
      </section>
    </div>
  );
}
