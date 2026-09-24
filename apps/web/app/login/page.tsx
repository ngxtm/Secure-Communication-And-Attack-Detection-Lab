"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

interface UserResponse {
  user: PublicUser;
}

const csrfHeaders = {
  "Content-Type": "application/json",
  "X-CSRF-Protection": "1",
};

export default function LoginPage() {
  const [username, setUsername] = useState("alice");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.ok) {
          const data = (await response.json()) as UserResponse;
          if (!cancelled) setUser(data.user);
        }
      } catch {
        if (!cancelled) setMessage("Could not connect to the API. Check the lab status.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: csrfHeaders,
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });

      if (response.status === 401) {
        setMessage("The username or password is incorrect.");
        return;
      }
      if (response.status === 429) {
        setMessage("Too many attempts. Wait about one minute and try again.");
        return;
      }
      if (!response.ok) {
        setMessage("Login failed. Check the API and lab configuration.");
        return;
      }

      const data = (await response.json()) as UserResponse;
      setUser(data.user);
      setPassword("");
      setMessage("Login successful. The session is stored in an HttpOnly cookie.");
    } catch {
      setMessage("Could not connect to the API. Check the lab status.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setMessage("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrfHeaders,
        credentials: "same-origin",
      });
      if (!response.ok) {
        setMessage("Could not end the session. Please try again.");
        return;
      }
      setUser(null);
      setMessage("The session has been revoked.");
    } catch {
      setMessage("Could not connect to the API. Check the lab status.");
    }
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-200"
          >
            <span className="flex size-9 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-sm font-bold text-emerald-200">
              NS
            </span>
            <span className="text-sm font-semibold tracking-wide">
              NETWORK SECURITY LAB
            </span>
          </Link>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300">
            Phase 1 · Authentication
          </span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div className="max-w-xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
              Identity · Sessions · Audit trail
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Authentication is the first layer of the lab.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              Sign in as Alice or Bob to see how Argon2id, server-side sessions,
              and login events work together.
            </p>
            <dl className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Password</dt>
                <dd className="mt-2 text-sm font-medium text-emerald-100">Argon2id</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Session</dt>
                <dd className="mt-2 text-sm font-medium text-emerald-100">HttpOnly cookie</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Monitoring</dt>
                <dd className="mt-2 text-sm font-medium text-emerald-100">Login events</dd>
              </div>
            </dl>
          </div>

          <section
            aria-labelledby="login-heading"
            className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/20 sm:p-8"
          >
            <div className="mb-7">
              <p className="font-mono text-xs text-emerald-200">AUTH / 01</p>
              <h2 id="login-heading" className="mt-2 text-2xl font-semibold">
                {user ? "You are signed in" : "Lab sign in"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {user
                  ? "The session has been authenticated by the API."
                  : "Demo passwords are read from the root .env file."}
              </p>
            </div>

            {isLoading ? (
              <div
                aria-live="polite"
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300"
              >
                Checking session…
              </div>
            ) : user ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4">
                  <p className="text-xs text-slate-400">Current account</p>
                  <p className="mt-1 text-lg font-semibold">{user.displayName}</p>
                  <p className="mt-1 font-mono text-sm text-emerald-100">
                    @{user.username}
                  </p>
                </div>
                <Link
                  href="/messages"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-200 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                >
                  Open Secure Messaging
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="min-h-11 w-full rounded-xl border border-white/15 px-4 text-sm font-semibold transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                >
                  Sign out and revoke session
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label
                    htmlFor="username"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={64}
                    pattern="[A-Za-z0-9._-]+"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="min-h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 text-sm outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-200/70 focus:ring-2 focus:ring-emerald-200/15"
                  />
                  <div className="mt-2 flex gap-2">
                    {(["alice", "bob"] as const).map((account) => (
                      <button
                        key={account}
                        type="button"
                        onClick={() => setUsername(account)}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-emerald-200/30 hover:text-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                      >
                        {account === "alice" ? "Alice" : "Bob"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 text-sm outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-200/70 focus:ring-2 focus:ring-emerald-200/15"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-12 w-full rounded-xl bg-emerald-200 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                >
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}

            <p aria-live="polite" role="status" className="mt-5 min-h-6 text-sm text-slate-300">
              {message}
            </p>
            <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">
              Passwords and tokens are not stored in the browser. The session cookie
              is marked HttpOnly and is revoked when you sign out.
            </p>
          </section>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-500">
          <span>Educational lab · Controlled scenarios</span>
          <Link href="/" className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-white">
            Back to home
          </Link>
        </footer>
      </div>
    </main>
  );
}
