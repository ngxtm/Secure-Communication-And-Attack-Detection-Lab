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
        if (!cancelled) setMessage("Không thể kết nối API. Hãy kiểm tra trạng thái lab.");
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
        setMessage("Tên đăng nhập hoặc mật khẩu không đúng.");
        return;
      }
      if (response.status === 429) {
        setMessage("Quá nhiều lần thử. Chờ khoảng một phút rồi thử lại.");
        return;
      }
      if (!response.ok) {
        setMessage("Đăng nhập thất bại. Hãy kiểm tra API và cấu hình lab.");
        return;
      }

      const data = (await response.json()) as UserResponse;
      setUser(data.user);
      setPassword("");
      setMessage("Đăng nhập thành công. Session được lưu trong cookie HttpOnly.");
    } catch {
      setMessage("Không thể kết nối API. Hãy kiểm tra trạng thái lab.");
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
        setMessage("Không thể kết thúc session. Hãy thử lại.");
        return;
      }
      setUser(null);
      setMessage("Session đã được thu hồi.");
    } catch {
      setMessage("Không thể kết nối API. Hãy kiểm tra trạng thái lab.");
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
            Giai đoạn 1 · Authentication
          </span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div className="max-w-xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
              Identity · Sessions · Audit trail
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Xác thực là lớp đầu tiên của lab.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              Đăng nhập bằng tài khoản Alice hoặc Bob để xem cách Argon2id,
              session server-side và login event phối hợp với nhau.
            </p>
            <dl className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Mật khẩu</dt>
                <dd className="mt-2 text-sm font-medium text-emerald-100">Argon2id</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Session</dt>
                <dd className="mt-2 text-sm font-medium text-emerald-100">HttpOnly cookie</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <dt className="text-xs text-slate-400">Theo dõi</dt>
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
                {user ? "Bạn đã đăng nhập" : "Đăng nhập lab"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {user
                  ? "Session đã được xác thực qua API."
                  : "Mật khẩu demo được đọc từ file .env ở thư mục gốc."}
              </p>
            </div>

            {isLoading ? (
              <div
                aria-live="polite"
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300"
              >
                Đang kiểm tra session…
              </div>
            ) : user ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4">
                  <p className="text-xs text-slate-400">Tài khoản hiện tại</p>
                  <p className="mt-1 text-lg font-semibold">{user.displayName}</p>
                  <p className="mt-1 font-mono text-sm text-emerald-100">
                    @{user.username}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="min-h-11 w-full rounded-xl border border-white/15 px-4 text-sm font-semibold transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                >
                  Đăng xuất và thu hồi session
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label
                    htmlFor="username"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Tên đăng nhập
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
                    Mật khẩu
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
                  {isSubmitting ? "Đang xác thực…" : "Đăng nhập"}
                </button>
              </form>
            )}

            <p aria-live="polite" role="status" className="mt-5 min-h-6 text-sm text-slate-300">
              {message}
            </p>
            <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">
              Không lưu mật khẩu hoặc token trong trình duyệt. Cookie session
              được đánh dấu HttpOnly và được thu hồi khi đăng xuất.
            </p>
          </section>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-500">
          <span>Educational lab · Controlled scenarios</span>
          <Link href="/" className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-white">
            Về trang chủ
          </Link>
        </footer>
      </div>
    </main>
  );
}
