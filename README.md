# Secure Communication & Attack Detection Lab

Course project for demonstrating network security concepts. The stack is generated with the official Next.js and NestJS CLIs and runs as one Docker Compose application. English is the default language for the application interface and project documentation.

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

## Secure messaging demo

Open `http://localhost:3000/messages` after logging in. Each account creates an RSA-OAEP identity the first time the page loads. The private CryptoKey is non-extractable and stays in this browser's IndexedDB; the API receives only the public key and its SHA-256 fingerprint.

For the demo, log in as Alice and open Messages, then log out, log in as Bob, and open Messages once to create Bob's identity. Return to Alice, compare Bob's displayed fingerprint with the fingerprint shown while logged in as Bob through a separate channel, and confirm it in the UI before sending. Repeat the comparison from Bob's account for Alice.

Each message gets a fresh AES-256-GCM key and 96-bit IV. The client wraps that AES key separately for Alice and Bob with RSA-OAEP/SHA-256, so both participants can read the conversation. The API stores ciphertext, the IV, both wrapped keys, sender/recipient IDs, and time; it does not receive the message plaintext or either private key.

Private keys are tied to this browser profile. Clearing browser storage or moving to another device can make old messages and files unreadable. The explicit key recovery action updates the registered public identity, reusing a locally stored key when one is available or creating a new one otherwise; old content remains readable only if its original private keys still exist locally. The fingerprint step helps detect a substituted public key; accepting the first fingerprint without comparing it independently does not verify the other person's identity.

Message endpoints:

- `GET /api/messages/identity` — get the signed-in account's public identity.
- `GET /api/messages/identity/{username}` — get another account's public identity.
- `PUT /api/messages/identity` — publish an identity; replacement requires an explicit rotation flag.
- `POST /api/messages` — store an encrypted message envelope.
- `GET /api/messages/conversation/{username}` — retrieve up to 100 recent ciphertext envelopes.

## Encrypted file transfer demo

Use the **Encrypted file transfer** section on the Messages page after both Alice and Bob have created their encryption identities and the recipient fingerprint is verified.

- Choose a file up to 8 MiB. The browser encrypts the file bytes and original filename together with AES-256-GCM using a fresh key and 96-bit IV.
- RSA-OAEP/SHA-256 wraps the AES key separately for the sender and recipient. Both people can decrypt the same file using their local private key.
- The API receives a multipart upload named `encrypted.bin` with a UUIDv4 request ID, ciphertext, IV, wrapped keys, and recipient username. It stores binary ciphertext in PostgreSQL `bytea`; it does not store the original filename or plaintext file.
- The API exposes sender, recipient, upload time, and encrypted payload size so the page can list conversation files. Only those two participants can retrieve the encrypted envelope.
- Either conversation participant can use **Download & decrypt** to decrypt locally and download as `application/octet-stream`. Files are never previewed or executed by the app.
- **Simulate tampering** flips one bit in a temporary in-memory copy of the ciphertext. AES-GCM rejects the copy; the original encrypted file remains unchanged.
- After rejection, the browser reports `FILE_DECRYPTION_FAILED_REPORTED` to the API. The API checks that the signed-in user is a file participant and stores a sanitized event marked `client-reported`; it cannot independently verify the AES-GCM tag.
- **Attack simulator · Replay upload** resends the most recent successful encrypted envelope using the same UUIDv4 request ID. The API returns HTTP 409 `REPLAY_DETECTED`, stores no duplicate file, and records `FILE_REPLAY_BLOCKED`.
- Because the API sees only ciphertext, it cannot verify the real MIME type or scan file contents. Use fake course data in this lab.

### Replay the upload with Burp Repeater

1. Route the browser through Burp Proxy (or use Burp's built-in browser), sign in, and send an encrypted file successfully.
2. In Burp's HTTP history, find the successful `POST /api/files` request and send it to Repeater.
3. Keep the `Origin`, session cookie, `X-CSRF-Protection: 1`, multipart body, and `requestId` unchanged. Send the request again while the session is active.
4. Expect HTTP `409` with code `REPLAY_DETECTED`. The database keeps one file row and records `FILE_REPLAY_BLOCKED`.

The request ID is bound to the authenticated server-side session. A new request ID is treated as a new send operation; the ID is a deduplication token, not a digital signature. The in-app simulator uses the same endpoint and sends the latest successful encrypted envelope again.

File endpoints:

- `POST /api/files` — upload an encrypted multipart envelope with a UUIDv4 `requestId`; requires the session cookie, allowed Origin, and `X-CSRF-Protection: 1`. Reusing a request ID in that session returns HTTP 409 `REPLAY_DETECTED`.
- `GET /api/files/conversation/{username}` — list up to 50 recent file summaries without ciphertext.
- `GET /api/files/{id}` — return ciphertext and wrapped keys to a conversation participant.
- `POST /api/files/{id}/tamper-report` — record a sanitized client-reported tamper simulation result for a participant.

After pulling schema changes, run `pnpm compose:up` when you are ready; Compose applies the checked-in tamper-event and replay-protection migrations before starting the app.

## Prisma ORM 8

The project uses Prisma ORM 8's PostgreSQL contract and runtime. After editing `apps/api/src/prisma/contract.prisma`, emit types and plan a reviewed migration:

```sh
pnpm --filter api run contract:emit
pnpm --dir apps/api exec prisma migration plan --name describe_change
```

Review the generated migration under `apps/api/migrations`. The API container applies checked-in migrations at startup. PostgreSQL data is kept in the `postgres_data` volume.

Prisma ORM 8 is currently a release candidate. Package versions are locked in `pnpm-lock.yaml`.

## Environment variables

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: Compose creates the local PostgreSQL database/container from these values.
- `SEED_ALICE_PASSWORD`, `SEED_BOB_PASSWORD`: required demo credentials (20-128 bytes); do not commit real values.
- `WEB_ORIGINS`: comma-separated allowed browser origins for login/logout and secure message/file writes. The local defaults cover the web app and Swagger UI.
- `API_INTERNAL_URL`: API URL reachable from the Next.js server. Keep `http://api:3000` under Compose.
- `SESSION_COOKIE_SECURE`: enable for HTTPS deployments.
- `WEB_PORT`, `API_PORT`: local host ports.

The root `.env` is ignored by Git. Do not put real demo passwords in `.env.example`.
