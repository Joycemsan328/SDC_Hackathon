import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { profileDestination, type Profile } from "./access";

type AuthResult = { error?: string; message?: string; signedIn?: boolean };
type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string;
  destination: ReturnType<typeof profileDestination>;
  refresh: () => void;
  signOut: () => Promise<void>;
  signIn: (email: string, password: string, registering?: boolean, fullName?: string, accountType?: "customer" | "business") => Promise<AuthResult>;
};
const AuthContext = createContext<AuthState | null>(null);

function isVerifiedSessionRevalidation(
  event: string,
  next: Session | null,
  verifiedPortalUserId: string | null,
): boolean {
  const isBackgroundRevalidation =
    event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED";
  return isBackgroundRevalidation
    && next !== null
    && verifiedPortalUserId !== null
    && next.user.id === verifiedPortalUserId;
}

export function UnifiedAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);
  const verifiedPortalUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const restore = async (next: Session | null, revision: number) => {
      if (!active || revision !== sequence.current) return;
      if (!next || next.user.id !== verifiedPortalUserId.current) {
        verifiedPortalUserId.current = null;
        setProfile(null);
        setLoading(true);
      }
      setSession(next);
      try {
        if (next) {
          const { data, error: profileError } = await supabase.from("profiles")
            .select("role, account_type, approval_status, full_name")
            .eq("id", next.user.id).maybeSingle();
          if (!active || revision !== sequence.current) return;
          if (profileError) throw profileError;
          const loadedProfile = data as Profile | null;
          setProfile(loadedProfile);
          verifiedPortalUserId.current =
            profileDestination(loadedProfile) !== "/pending" ? next.user.id : null;
        } else {
          setProfile(null);
          verifiedPortalUserId.current = null;
        }
        setError("");
      } catch {
        if (active && revision === sequence.current) {
          verifiedPortalUserId.current = null;
          setProfile(null);
          setError("We couldn’t verify your account profile. Retry to check access; no portal access has been granted.");
        }
      } finally {
        if (active && revision === sequence.current) setLoading(false);
      }
    };
    let receivedEvent = false;
    if (version === 0) setLoading(true);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "INITIAL_SESSION") return;
      receivedEvent = true;
      const revision = ++sequence.current;
      if (!isVerifiedSessionRevalidation(event, next, verifiedPortalUserId.current)) {
        verifiedPortalUserId.current = null;
        setSession(next);
        setProfile(null);
        setLoading(true);
      }
      // Query only after Supabase releases its auth callback lock.
      const timer = setTimeout(() => { timers.delete(timer); void restore(next, revision); }, 0);
      timers.add(timer);
    });
    const initialRevision = ++sequence.current;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || receivedEvent) return;
      if (sessionError) {
        verifiedPortalUserId.current = null;
        setProfile(null);
        setError("Your session could not be restored. Please sign in again.");
        setLoading(false);
        return;
      }
      void restore(data.session, initialRevision);
    }).catch(() => {
      if (active && !receivedEvent) {
        verifiedPortalUserId.current = null;
        setProfile(null);
        setError("Authentication is unavailable. Please retry.");
        setLoading(false);
      }
    });
    return () => { active = false; ++sequence.current; timers.forEach(clearTimeout); subscription.unsubscribe(); };
  }, [version]);

  // Refresh approval/profile decisions when the user returns to this website.
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const value: AuthState = {
    session, profile, loading, error, destination: profileDestination(profile),
    refresh: () => setVersion((value) => value + 1),
    signOut: async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      verifiedPortalUserId.current = null;
      setSession(null);
      setProfile(null);
    },
    signIn: async (email, password, registering = false, fullName = "", accountType = "customer") => {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return { error: "Enter a valid email address." };
      if (password.length < 6) return { error: "Password must be at least 6 characters." };
      try {
        if (registering) {
          if (!fullName.trim()) return { error: "Enter your full name." };
          const { data, error: signupError } = await supabase.auth.signUp({
            email: email.trim(), password,
            options: {
              data: { full_name: fullName.trim(), account_type: accountType },
              emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}login`,
            },
          });
          if (signupError) return { error: signupError.message };
          if (!data.session) return { message: "Account created. Check your email for a confirmation link, then sign in. Business access requires approval." };
          return { signedIn: true };
        }
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        return loginError ? { error: loginError.message } : { signedIn: true };
      } catch {
        return { error: "Unable to connect to EventFlow authentication. Please try again." };
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useUnifiedAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Unified authentication provider is missing.");
  return value;
}
