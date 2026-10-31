import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Router, useLocation } from "wouter";
import { AuthPage, CustomerArea } from "@/customer/Portal";
import { CustomerProvider } from "@/customer/data";
import { useUnifiedAuth } from "./UnifiedAuth";
import "../business/business.css";

const BusinessPortal = lazy(() => import("../business/BusinessPortal"));

export function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return <Loading />;
}
function Loading() {
  return <div role="status" className="flex min-h-dvh items-center justify-center bg-[#fcfaf9] text-sm text-[#817886]">Restoring your secure session…</div>;
}
function AccessNotice({ children }: { children: ReactNode }) {
  const { signOut, refresh } = useUnifiedAuth();
  const [, navigate] = useLocation();
  return <div className="flex min-h-dvh items-center justify-center bg-[#fcfaf9] p-6"><section className="ef-card w-full max-w-lg rounded-2xl p-8 text-center text-[#594f5e]">
    {children}
    <div className="mt-6 flex justify-center gap-4">
      <button className="rounded-xl border p-3" onClick={refresh}>Check approval again</button>
      <button className="rounded-xl bg-[#bb7d99] p-3 text-white" onClick={() => void signOut().then(() => navigate("/login", { replace: true })).catch(() => window.alert("Unable to sign out. Please retry."))}>Sign out</button>
    </div>
  </section></div>;
}

export default function UnifiedRoutes() {
  const [path] = useLocation();
  const { session, loading, error, destination, profile, refresh } = useUnifiedAuth();
  if (loading) return <Loading />;
  if (error) return session
    ? <AccessNotice><h1 className="text-xl font-bold">Account verification unavailable</h1><p role="alert" className="mt-3">{error}</p></AccessNotice>
    : <div><p role="alert" className="p-4 text-center">{error} <button onClick={refresh}>Retry</button></p><AuthPage mode={path === "/register" ? "register" : "login"} /></div>;
  if (!session) {
    if (path === "/login" || path === "/register") return <AuthPage mode={path === "/register" ? "register" : "login"} />;
    return <Redirect to="/login" />;
  }
  if (destination === "/pending") {
    if (path !== "/pending") return <Redirect to="/pending" />;
    return <AccessNotice><h1 className="text-2xl font-bold">{profile?.approval_status === "rejected" ? "Account not approved" : "Pending approval"}</h1><p className="mt-3">This account does not yet have approved portal access. Business accounts require approval before accessing the portal.</p></AccessNotice>;
  }
  const prefix = destination;
  if (path === "/" || path === "/login" || path === "/register" || path === "/pending") return <Redirect to={prefix} />;
  // Preserve bookmarked Customer URLs while making the new namespace canonical.
  if (destination === "/customer" && (path === "/dashboard" || path === "/events" || path.startsWith("/events/"))) return <Redirect to={`/customer${path}`} />;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return <Redirect to={prefix} />;
  if (destination === "/customer") return <Router base="/customer"><CustomerProvider key={session.user.id}><CustomerArea /></CustomerProvider></Router>;
  return <Router base="/business"><div className="business-portal"><Suspense fallback={<Loading />}><BusinessPortal /></Suspense></div></Router>;
}
