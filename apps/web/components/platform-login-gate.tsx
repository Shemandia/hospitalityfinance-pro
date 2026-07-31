"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Operator sign-in card for the platform admin pages.
 * Posts username/password to /api/platform/auth; on success the server sets
 * the httpOnly platform session cookie and `onAuthenticated` fires.
 */
export function PlatformLoginGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!username || !password || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/platform/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        onAuthenticated();
        // Re-render the server layout so the sidebar appears immediately.
        router.refresh();
      } else {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Invalid username or password.");
      }
    } catch {
      setError("Cannot reach server.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20";

  return (
    <div className="flex h-full min-h-[70vh] items-center justify-center bg-[#f8fafc]">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_10px_30px_rgba(0,0,0,0.03)]">
        <div className="mb-6">
          <h2 className="text-xl font-extrabold text-slate-900">Platform Sign In</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in with your operator account to access tenant management.
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className={inputClass}
            placeholder="Username"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className={inputClass}
            placeholder="Password"
          />
        </div>

        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!username || !password || submitting}
          className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </div>
    </div>
  );
}
