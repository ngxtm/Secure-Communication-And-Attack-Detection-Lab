# Secure Communication & Attack Detection Lab

Course project for demonstrating network security concepts. The stack is generated with the official Next.js and NestJS CLIs and runs as one Docker Compose application.

## Requirements

- Docker Desktop with Docker Compose
- Node.js 24.15+ and pnpm 10 for local CLI work

## Configure and start the lab

1. Copy `.env.example` to `.env`.
2. Replace the PostgreSQL password and both demo account passwords with unique alphanumeric values. Demo passwords must be at least 20 characters.
3. Start the stack when you are ready:

```sh
pnpm compose:up
```

When you run `pnpm compose:up`, Compose starts PostgreSQL, waits for its health check, validates the demo credentials, applies checked-in Prisma migrations, seeds Alice and Bob, then starts the API and web app. Compose creates the database container and initial database from values in `.env`; the API builds `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. You do not need to create tables or add a separate database URL.

- Web: http://localhost:3000
- Login lab: http://localhost:3000/login
- API health: http://localhost:4000/api/health
- Swagger UI: http://localhost:4000/docs
- OpenAPI JSON: http://localhost:4000/docs-json

PostgreSQL is not published to the host. It is reachable only by services on the Compose network. Compose persists its data in the `postgres_data` volume.

Stop the services and keep database data:

```sh
pnpm compose:down
```

## Authentication flow

- Demo accounts are `alice` and `bob`; their passwords come from `SEED_ALICE_PASSWORD` and `SEED_BOB_PASSWORD` in the root `.env`.
- Passwords are stored as Argon2id hashes with a unique salt. The seed script is idempotent. If a configured demo password changes, the seed updates its hash and revokes that account's existing sessions.
- A successful login sets a 12-hour opaque session token in an HttpOnly, SameSite=Strict cookie. PostgreSQL stores only the token's SHA-256 hash. The browser never receives the token in JSON or stores it in local storage.
- Login and logout require an exact allowed Origin and the `X-CSRF-Protection: 1` header. Set `WEB_ORIGINS` to the public web origin(s) when changing the local URL or deploying.
- Five failed logins for the same username and source within one minute trigger a one-minute temporary block. The brute-force counter is in-memory on this single API instance and resets when it restarts; login events remain in PostgreSQL. Login attempts, successful logins, lockouts, and logout are stored in `LoginEvent`.
- Set `SESSION_COOKIE_SECURE=true` when serving the web app over HTTPS (for example, behind Dokploy). It is `false` for the local HTTP Compose demo.

Auth endpoints:

- `POST /api/auth/login` — validate credentials and set the session cookie.
- `GET /api/auth/session` — return the current public user.
- `POST /api/auth/logout` — revoke the server-side session and clear the cookie.

## Prisma ORM 8

The project uses Prisma ORM 8's PostgreSQL contract and runtime. After editing `apps/api/src/prisma/contract.prisma`, emit types and plan a reviewed migration:

```sh
pnpm --filter api exec prisma contract emit
pnpm --filter api exec prisma migration plan --name describe_change
```

Review the generated migration under `apps/api/migrations`. The API container applies checked-in migrations at startup. PostgreSQL data is kept in the `postgres_data` volume.

Prisma ORM 8 is currently a release candidate. Package versions are locked in `pnpm-lock.yaml`.

## Environment variables

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: Compose creates the local PostgreSQL database/container from these values.
- `SEED_ALICE_PASSWORD`, `SEED_BOB_PASSWORD`: required demo credentials (20-128 bytes); do not commit real values.
- `WEB_ORIGINS`: comma-separated allowed browser origins for login/logout. The local defaults cover the web app and Swagger UI.
- `API_INTERNAL_URL`: API URL reachable from the Next.js server. Keep `http://api:3000` under Compose.
- `SESSION_COOKIE_SECURE`: enable for HTTPS deployments.
- `WEB_PORT`, `API_PORT`: local host ports.

The root `.env` is ignored by Git. Do not put real demo passwords in `.env.example`.
