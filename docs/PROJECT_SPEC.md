# Secure Communication & Attack Detection Lab — MVP Specification

- Version: 1.6
- Updated: 2026-09-24
- Status: Agreed MVP specification
- Purpose: An educational simulation for the Network Security course

## 1. Summary

Secure Communication & Attack Detection Lab is a web application where Alice can send files to Bob, observe the layers that protect data, run controlled attack scenarios in a private lab, and review the results on a security dashboard.

The project demonstrates these concepts separately:

- TLS protects the connection between the client and server.
- AES-256-GCM protects message and file contents.
- RSA-OAEP wraps the AES key for the recipient. Messages also include a sender-wrapped copy so both participants can review the conversation.
- Argon2id protects stored passwords.
- Hashes and HMAC demonstrate different integrity checks.
- Replay protection, brute-force detection, and rate limiting demonstrate how repeated or unusual requests can be detected.

This is an educational lab, not a production-ready design. Cryptographic algorithms are provided by maintained libraries; the project does not implement cryptographic primitives itself.

## 2. Goals and scope

### Goals

1. Show how sample data can be read over a test HTTP connection and protected when HTTPS is used.
2. Send files so the API receives and stores only an encrypted envelope; Bob decrypts it in the client.
3. Detect ciphertext modification through the AES-GCM authentication tag.
4. Distinguish plain hashing, HMAC, and encryption.
5. Detect replayed requests, repeated failed logins, and request rates above a threshold.
6. Record security events with secrets removed and display them on a dashboard.

### Out of scope for the MVP

- Use with real data or production deployment.
- Protecting a compromised client device, stolen private key, or exposed password.
- Preventing Internet-scale DoS or generating large traffic volumes.
- Building a full packet- or network-level IDS.
- Recovering a lost private key or synchronizing private keys across devices.
- Digital signatures and sender non-repudiation.
- Running real malware.

## 3. Threat model

### Assets to protect

- File contents before and after decryption.
- Passwords, session cookies, and private keys.
- File/request integrity and freshness.
- Security events and user data.

### Attacker capabilities in the lab

- Eavesdrop on a test HTTP flow that contains fake data.
- Modify or resend an envelope/request captured in the lab.
- Make repeated login attempts with fake credentials.
- Send requests to a demo endpoint within the simulator's limits.

### Assumptions and limitations

- Alice and Bob use trusted client devices that have not been compromised by malware.
- A recipient's private key exists only on the client.
- Bob's public key is verified by comparing its fingerprint through an independent channel during demo setup.
- The backend can store metadata such as sender, recipient, time, and envelope size; file contents and filenames are inside the encrypted payload.
- Plain HTTP is used only for fake strings on the internal Docker Compose network. Passwords, sessions, and real files are never sent over HTTP.
- TLS is required for normal application traffic. The same Docker Compose stack is used locally and when deployed to Dokploy; only runtime configuration such as the domain, HTTPS, and secrets differs.

## 4. Architecture

    Alice / Bob Web Client
             │
             │ HTTPS
             ▼
      Backend API
      ├── Authentication
      ├── File Transfer
      ├── Replay Guard
      ├── Rate Limiting
      └── Security Event Logging
           │                 │
           ▼                 ▼
       PostgreSQL       Detection Rules
                              │
                              ▼
                       Security Dashboard

    Attack Simulator ─────────► Backend API

The MVP uses one backend with internal modules; it is not split into microservices. The Attack Simulator is an interface for issuing bounded test requests. Detection Rules process application-level events reported by the backend and client; this is not a packet-level network IDS.

The project uses one Docker Compose stack containing Next.js, NestJS, and PostgreSQL. Local runs and Dokploy deployments use the same stack definition, schema, and Prisma migration flow. Each deployment has its own PostgreSQL service. NestJS connects to PostgreSQL over Docker's internal network. The backend is not split into microservices, and there is no second deployment configuration.

### Components

- **Web Client:** signs in, creates an RSA identity, encrypts/decrypts messages and files in the browser, and reports decryption results.
- **Backend API:** validates sessions, distributes public keys/fingerprints, stores encrypted message/file envelopes, blocks replays, applies rate limits, and records events.
- **PostgreSQL:** stores users, public keys/fingerprints, ciphertext envelopes, message metadata, replay IDs, and security events; the database runs in Docker Compose.
- **Detection Rules:** count events over time windows and trigger cooldowns or rate limits.
- **Dashboard:** displays system status, event counts, and alert history.
- **Attack Simulator:** an in-app scenario interface that sends tamper, replay, brute-force, and bounded-flood requests to this project's API. It requires a lab account and enforces fixed limits. A separate attacker service is not required.

## 5. Encryption and file-transfer flows

### Key setup

1. Each account creates a 2048-bit RSA-OAEP key pair with SHA-256 in the browser.
2. The client registers its public key and fingerprint with the API; the private key is never sent to the server.
3. Before trusting a recipient key, the sender retrieves the recipient's public key and compares its fingerprint through an independent channel.
4. The non-extractable private CryptoKey is kept in IndexedDB for that browser profile. Clearing browser storage or changing devices can make old content undecryptable; the MVP does not synchronize or back up private keys.

### Text messaging

1. The client creates a new random AES-256 key and 96-bit IV for each message.
2. The client encrypts the plaintext with AES-256-GCM. The version, sender ID, and recipient ID are included as AAD.
3. The client wraps the same AES key twice with RSA-OAEP/SHA-256: once for the sender to review sent messages and once for the recipient.
4. The API stores only the ciphertext, IV, two wrapped AES keys, and conversation metadata.
5. The client decrypts with its local private key. Modification of the ciphertext or authenticated metadata causes AES-GCM authentication to fail.

This is the first slice of Phase 2. File transfer will reuse the client-side encryption envelope and add encrypted file metadata and a download flow.

### File transfer

1. Alice's client creates a random AES-256 key and a new nonce for this encryption operation.
2. The client encrypts the file contents and filename with AES-256-GCM. Envelope-binding data such as the version, file ID, sender ID, and recipient ID is included as AAD.
3. The client wraps the AES key with Bob's public key using RSA-OAEP and SHA-256.
4. The client sends the envelope over HTTPS.
5. The API validates the session and send permission, checks that the file ID/request ID has not been used, then stores the ciphertext, wrapped key, and metadata.
6. Bob's client retrieves the envelope, unwraps the AES key with the private key, and decrypts the file. Modification of the ciphertext or tag must cause decryption to fail.

Conceptual envelope:

~~~json
{
  "version": "...",
  "file_id": "...",
  "sender_id": "...",
  "recipient_id": "...",
  "encrypted_payload": "...",
  "wrapped_aes_key": "...",
  "nonce": "...",
  "request_id": "..."
}
~~~

In the Web Crypto API, AES-GCM ciphertext includes the authentication tag. The implementation must specify how ciphertext and tag are serialized; it must not discard the tag.

RSA-OAEP in this project is an educational model for wrapping an AES key. TLS 1.3 is a separate connection-protection layer and does not use this exact RSA key-wrapping flow. References: [RFC 8017](https://www.rfc-editor.org/rfc/rfc8017.html), [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html), [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).

## 6. Authentication and sessions

- Passwords are hashed with Argon2id and a unique salt per password, using a maintained library.
- Plaintext passwords are never stored. Fast hashes such as MD5 or SHA-256 are not used for password storage.
- After login, the server creates an opaque session. The cookie uses HttpOnly, SameSite, and Secure when the connection uses HTTPS.
- Sessions expire; logging out revokes the session.
- Default demo threshold: five failed logins within 60 seconds for the same account or test source, followed by a 60-second cooldown. These values should be configurable for demonstrations.
- Follow the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Login authenticates the account/session at the application layer. Encrypting with Bob's public key does not prove that Alice sent the message. RSA-PSS digital signatures could be added as an extension.

## 7. Hash and HMAC demo

The Crypto Concepts screen can accept a sample file and display:

- MD5 digest.
- SHA-256 digest.
- HMAC-SHA256 using a demo key created for the lab.

Explain the following:

- A SHA-256 digest can compare content only when the reference digest is protected; an attacker can replace the file and calculate a new plain digest.
- HMAC uses a shared secret key to verify message authentication.
- MD5 is unsuitable where collision resistance is required. A prepared collision pair can demonstrate this; there is no need to implement a collision-generation tool.
- AES-GCM already provides a tag to check ciphertext in the file-transfer flow; do not add a second HMAC to that same flow solely to detect modification.

References: [RFC 2104 — HMAC](https://www.rfc-editor.org/rfc/rfc2104.html), [RFC 6151 — MD5 security considerations](https://www.rfc-editor.org/rfc/rfc6151.html).

## 8. Replay protection

Each file-send operation has a random request ID. The server stores each user/session and request-ID pair for the lifetime of the session. If a used request is sent again, the server returns 409 REPLAY_DETECTED, does not create another file, and records a security event. A unique file ID also prevents duplicate records in the database.

The AES-GCM nonce and request ID serve different purposes:

- The nonce satisfies AES-GCM's requirements and must not be reused with the same key.
- The request ID helps detect an application operation being submitted again.

The simulator replays a valid request captured in the lab. This models replay at the application layer: TLS protects records at the transport layer, while the replay guard protects business operations.

## 9. Attack Simulator and detection rules

| Scenario | Action | Expected result |
|---|---|---|
| Plain HTTP demo | Send a fake string through the lab endpoint | Wireshark can read the payload |
| HTTPS demo | Send the same fake string over TLS | A packet capture cannot read the application payload |
| Tamper | Modify an envelope's ciphertext or tag | The client cannot decrypt it; the event is marked client-reported |
| Replay | Resend a used request ID | The API returns 409, creates no duplicate file, and records REPLAY_BLOCKED |
| Brute-force | Submit repeated fake passwords | Cooldown/rate limit and AUTH_LOCKED |
| Bounded flood | Send requests to the demo endpoint at a limited rate | The API returns 429 above the threshold and records RATE_LIMITED |

Simulator limits: at most 10 requests per second and 100 requests per run. It targets only this project's API and does not accept arbitrary destination URLs. Scenarios require an authenticated lab session and use fake payloads. Default demo rate limit: more than 20 requests in five seconds from the same source triggers a 30-second cooldown.

Tampering is simulated at the client/envelope layer. Because the backend does not have the AES key, it cannot independently verify the file's tag. A decryption failure reported by the client is marked client-reported and is not treated as evidence independently verified by the server.

## 10. Security events and dashboard

### Minimum events

- AUTH_LOGIN_SUCCESS
- AUTH_LOGIN_FAILED
- AUTH_LOCKED
- FILE_ENVELOPE_STORED
- FILE_REPLAY_BLOCKED
- FILE_DECRYPTION_FAILED_REPORTED
- RATE_LIMITED
- HASH_DEMO_RUN
- HMAC_DEMO_RUN

### Event fields

- event_id
- event_type
- occurred_at
- actor_id, when available
- source or scenario
- severity
- sanitized details

Never store passwords, session tokens, private keys, plaintext files, or HMAC secrets in the database or logs. The dashboard displays event totals over time, failed logins, blocked requests, rejected replays, and client-reported decryption failures.

## 11. Proposed API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/login | Sign in |
| POST | /api/auth/logout | Revoke the session |
| GET | /api/messages/identity | Get the signed-in account's public identity |
| GET | /api/messages/identity/{username} | Get another account's public identity |
| PUT | /api/messages/identity | Register or explicitly replace a public identity |
| POST | /api/messages | Send an encrypted text-message envelope |
| GET | /api/messages/conversation/{username} | Get the 100 most recent ciphertexts |
| POST | /api/files | Send an encrypted file envelope (planned) |
| GET | /api/files/{file_id} | Let Bob retrieve an envelope |
| GET | /api/security/events | Read dashboard events, subject to authorization |
| POST | /api/lab/scenarios/{scenario} | Run a scenario in lab mode |

API documentation is served through Swagger UI at /docs; the OpenAPI JSON document is available at /docs-json. NestJS routes can be configured.

Endpoints under /api/lab are available only to signed-in lab/admin accounts, enforce hard limits, and target only this project's API. They do not allow arbitrary hosts or unlimited flooding. The plain HTTP demo accepts only fake strings on the internal Docker Compose network; it is not used for login or file transfer.

## 12. MVP completion criteria

1. Alice sends a sample file; Bob decrypts it and receives the correct contents.
2. The API/database stores only ciphertext, the specified wrapped AES key, and metadata; it never stores the plaintext file.
3. Modifying ciphertext/tag causes decryption to fail.
4. A repeated request ID is rejected and does not create a duplicate envelope.
5. Passwords are stored with Argon2id; enough failed logins trigger a cooldown.
6. A bounded flood triggers rate limiting and returns HTTP 429.
7. The dashboard displays events generated by each scenario.
8. A packet capture of the plain HTTP lab demo reveals the fake string; a packet capture of HTTPS does not reveal the application payload.
9. Logs contain no passwords, session tokens, private keys, or plaintext files.

## 13. Implementation plan

### Phase 1 — Skeleton and authentication

- Scaffold the Next.js frontend, NestJS backend, and PostgreSQL database with Docker Compose.
- Use Prisma ORM 8 and the latest compatible packages available at scaffold time.
- Use one Docker Compose definition, one Prisma schema, and one migration flow; do not create separate database configuration or procedures for local and Dokploy.
- Use TypeScript on the frontend and backend; expose the API as REST JSON documented with OpenAPI.
- Seed Alice and Bob.
- Implement Argon2id, sessions, and login events.

### Phase 2 — Secure messaging and file transfer

- Complete secure text messaging first: public identity/fingerprint, private key in IndexedDB, AES-256-GCM encryption, RSA-OAEP key wrapping for both participants, and ciphertext storage/retrieval.
- Verify the recipient fingerprint through an independent channel before trusting the public key.
- Add file transfer next using the same envelope pattern.
- Then add a client-side tamper scenario; AES-GCM must reject decryption when ciphertext/tag is modified.

### Phase 3 — Attack simulation and dashboard

- Add replay guards, brute-force cooldowns, and bounded rate limiting.
- Add scenario controls and security events.
- Build the aggregate dashboard.

### Phase 4 — Dokploy deployment and stabilization

- Deploy Next.js, NestJS, and PostgreSQL to Dokploy using the project's existing Docker Compose definition; do not create a separate stack or migration flow.
- Configure the domain, HTTPS, and secrets in Dokploy; NestJS connects to PostgreSQL over Docker's internal network.
- Keep PostgreSQL unpublished to the Internet and enable a persistent volume. Configure regular PostgreSQL backups and perform a restore test.
- Keep lab scenarios behind lab/admin authentication with hard limits; do not allow external targets or unlimited flooding.
- Check the health endpoint, migration status, file send/receive flow, and main scenarios after deployment.

### Phase 5 — Presentation preparation

- Rehearse the demo scenario in section 14.
- Prepare an architecture diagram, encryption flow, and an “attack → defense → observed result” table.
- Explain the lab's limitations and distinguish TLS, encryption, integrity, authentication, and replay protection.

## 14. Main presentation scenario

1. Use a fake string to compare HTTP and HTTPS with a packet capture.
2. Alice sends an encrypted file to Bob; explain AES-GCM and RSA-OAEP.
3. Modify the envelope; Bob cannot decrypt it because the authentication tag is invalid.
4. Replay the request; the server detects the reused request ID.
5. Run login brute-force and bounded-flood scenarios; observe the cooldown, HTTP 429, and dashboard.
6. Finish by comparing SHA-256 and HMAC and emphasizing that a plain hash does not authenticate the sender.

## 15. Implementation stack

- Frontend: Next.js with React and TypeScript.
- Backend: NestJS with TypeScript on Node.js.
- API: REST JSON; the OpenAPI contract is generated by NestJS through @nestjs/swagger and can be viewed/tested with Swagger UI at /docs.
- Database: one PostgreSQL service per Docker Compose run; use the same schema and migration flow locally and on Dokploy.
- ORM: the latest Prisma ORM 8, including the prisma CLI and PostgreSQL package @prisma/orm-postgres. The packages are released separately, so select the latest version of each and commit the lockfile to pin the chosen set.
- Release status: as of 2026-09-24, Prisma ORM 8 is still a release candidate. The project intentionally uses the latest version as requested, so review API and migration changes before upgrading. See [Prisma ORM release status](https://www.prisma.io/docs/orm/release-status).
- Client-side encryption: Web Crypto API or a maintained standard library.
- Password hashing: Argon2id through an appropriate library.
- Runtime and hosting: one Docker Compose stack for local runs and deployment to the existing Dokploy server; no additional Prisma cloud service is needed.
- Database connection: NestJS uses DATABASE_URL to connect to the PostgreSQL service over Docker's internal network. Use one configuration/migration flow; set runtime secrets in Dokploy for deployment. Do not publish PostgreSQL to the Internet.
- Packet observation: Wireshark, if time permits.
- Do not implement encryption, hashing, HMAC, or RSA algorithms yourself.
