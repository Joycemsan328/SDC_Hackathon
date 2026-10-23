import { useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";

type AccountType = "customer" | "business";

export default function EventFlowRegister({
  accountType,
  onBack,
}: {
  accountType: AccountType;
  onBack: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"register" | "login">("register");

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            account_type: accountType,
          },
        },
      });

      if (error) {
        setMessage(error.message);
      } else if (!data.session) {
        setMessage(
          "Registration submitted! Please check your email for a confirmation link.",
        );
      } else {
        setMessage(
          accountType === "business"
            ? "Account created! Your business account must be approved before you can access the portal."
            : "Customer account created successfully!",
        );
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setMessage(error.message);
      }
    } catch {
      setMessage("Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-white p-8 shadow-sm">
        <button type="button" onClick={onBack} className="text-sm underline">
          ← Back
        </button>

        <h1 className="text-2xl font-bold">
          {mode === "register"
            ? `Create ${accountType === "business" ? "Business" : "Customer"} Account`
            : "Sign In to EventFlow"}
        </h1>

        {accountType === "business" && (
          <p className="text-sm text-gray-600">
            Business accounts require approval before accessing the portal.
          </p>
        )}

        <form
          onSubmit={mode === "register" ? handleRegister : handleLogin}
          className="space-y-4"
        >
          {mode === "register" && (
            <input
              className="w-full rounded-lg border p-3"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          )}

          <input
            type="email"
            className="w-full rounded-lg border p-3"
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            className="w-full rounded-lg border p-3"
            placeholder="Password (minimum 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#77518a] p-3 font-semibold text-white disabled:opacity-50"
          >
            {loading
              ? mode === "register"
                ? "Creating Account..."
                : "Signing In..."
              : mode === "register"
                ? "Register"
                : "Sign In"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          {mode === "register"
            ? "Already have an account?"
            : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setMessage("");
            }}
            className="font-semibold text-[#77518a] hover:underline"
          >
            {mode === "register" ? "Sign In" : "Register"}
          </button>
        </p>

        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
