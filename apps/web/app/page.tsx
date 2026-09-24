const stack = [
  {
    number: "01",
    name: "Web client",
    detail: "Next.js · React · TypeScript",
  },
  {
    number: "02",
    name: "Backend API",
    detail: "NestJS · REST · OpenAPI",
  },
  {
    number: "03",
    name: "Database",
    detail: "PostgreSQL · Prisma ORM 8",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8 sm:px-10 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-sm font-bold text-emerald-200">
              NS
            </span>
            <span className="text-sm font-semibold tracking-wide">
              NETWORK SECURITY LAB
            </span>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300">
            MVP foundation
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
              Secure communication · Attack detection
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              Make network security
              <span className="block text-emerald-200">visible and testable.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Lab học tập để quan sát cách bảo vệ tin nhắn và file, sau đó chạy
              các tình huống tấn công có giới hạn và xem hệ thống phản ứng.
            </p>
            <p className="mt-8 text-sm text-slate-400">
              Bản khởi tạo gồm frontend, API, PostgreSQL và Prisma ORM.
            </p>
            <a
              href="/login"
              className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-200 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-200"
            >
              Mở lab đăng nhập
            </a>
          </div>

          <section
            aria-label="Project stack"
            className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Project stack</h2>
              <span className="font-mono text-xs text-slate-400">
                DOCKER COMPOSE
              </span>
            </div>
            <ol className="space-y-3">
              {stack.map((item) => (
                <li
                  key={item.number}
                  className="flex items-start gap-4 rounded-2xl border border-white/[0.07] bg-slate-950/50 p-4"
                >
                  <span className="pt-0.5 font-mono text-xs text-emerald-200">
                    {item.number}
                  </span>
                  <div>
                    <h3 className="font-medium">{item.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 rounded-xl bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
              API docs: <code className="font-mono">localhost:4000/docs</code>
            </p>
          </section>
        </section>

        <footer className="border-t border-white/10 pt-5 text-xs text-slate-500">
          Educational lab · Controlled scenarios · No real attack traffic
        </footer>
      </div>
    </main>
  );
}
