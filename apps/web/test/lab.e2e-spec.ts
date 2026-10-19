import { beforeAll, describe, expect, it } from "vitest";
import {
  createLocalIdentityKey,
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
  tamperFileCiphertextForDemo,
  type EncryptedFileEnvelope,
  type LocalIdentityKey,
  type MessageCiphertext,
} from "../app/messages/crypto";

// Run only against a fresh, isolated Compose project; never rotate existing keys.
if (process.env.LAB_E2E !== "1") {
  throw new Error(
    "Set LAB_E2E=1 and use the isolated Compose project described in README.md.",
  );
}
process.loadEnvFile(new URL("../../../.env", import.meta.url));
const baseUrl = process.env.LAB_BASE_URL ?? "http://localhost:3000";

interface Participant {
  id: string;
  cookie: string;
  key: LocalIdentityKey;
}

function request(path: string, cookie = "", init: RequestInit = {}) {
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Origin: new URL(baseUrl).origin,
      "X-CSRF-Protection": "1",
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function login(username: "alice" | "bob"): Promise<Participant> {
  const password =
    process.env[
      username === "alice" ? "SEED_ALICE_PASSWORD" : "SEED_BOB_PASSWORD"
    ];
  if (!password)
    throw new Error("Demo credentials are missing from the environment.");
  const response = await request(
    "/api/auth/login",
    "",
    jsonBody({ username, password }),
  );
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not set a session cookie.");
  const { user } = (await response.json()) as { user: { id: string } };
  return { id: user.id, cookie, key: await createLocalIdentityKey(user.id) };
}

describe("running lab through the web/API proxy and PostgreSQL", () => {
  let alice: Participant;
  let bob: Participant;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([login("alice"), login("bob")]);
  });

  it("sends messages/files, rejects tampering and atomically blocks concurrent replay", async () => {
    for (const participant of [alice, bob]) {
      const response = await request(
        "/api/messages/identity",
        participant.cookie,
      );
      expect(response.status).toBe(200);
      const current = (await response.json()) as { identity: unknown };
      if (current.identity !== null) {
        throw new Error(
          "Existing identity found. Stop and use a fresh isolated Compose volume; this test will not replace keys.",
        );
      }
      const published = await request(
        "/api/messages/identity",
        participant.cookie,
        {
          ...jsonBody({ publicKey: participant.key.publicKey }),
          method: "PUT",
        },
      );
      expect(published.status).toBe(200);
      const { identity } = (await published.json()) as {
        identity: { fingerprint: string };
      };
      expect(identity.fingerprint).toBe(participant.key.fingerprint);
    }

    const plaintext = "End-to-end lab verification 🔐";
    const encryptedMessage = await encryptMessage(
      plaintext,
      alice.id,
      bob.id,
      bob.key.publicKey,
      alice.key.publicKey,
    );
    const sent = await request(
      "/api/messages",
      alice.cookie,
      jsonBody({ recipientUsername: "bob", ...encryptedMessage }),
    );
    expect(sent.status).toBe(201);
    const conversation = await request(
      "/api/messages/conversation/alice",
      bob.cookie,
    );
    const { messages } = (await conversation.json()) as {
      messages: MessageCiphertext[];
    };
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toHaveProperty("plaintext");
    await expect(
      decryptMessage(messages[0]!, bob.id, [bob.key.privateKey]),
    ).resolves.toBe(plaintext);

    const originalBytes = new Uint8Array([0, 1, 255, 128, 42]);
    const encrypted = await encryptFile(
      new File([originalBytes], "verification.txt"),
      alice.id,
      bob.id,
      bob.key.publicKey,
      alice.key.publicKey,
    );
    const requestId = crypto.randomUUID();
    function upload() {
      const body = new FormData();
      body.set("requestId", requestId);
      body.set("recipientUsername", "bob");
      body.set("iv", encrypted.iv);
      body.set("senderWrappedKey", encrypted.senderWrappedKey);
      body.set("recipientWrappedKey", encrypted.recipientWrappedKey);
      body.set("ciphertext", new Blob([encrypted.ciphertext]), "encrypted.bin");
      return request("/api/files", alice.cookie, { method: "POST", body });
    }

    const uploads = await Promise.all([upload(), upload()]);
    expect(uploads.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const accepted = uploads.find((response) => response.status === 201)!;
    const rejected = uploads.find((response) => response.status === 409)!;
    expect(((await rejected.json()) as { code: string }).code).toBe(
      "REPLAY_DETECTED",
    );
    const { file } = (await accepted.json()) as { file: { id: string } };
    const listing = await request("/api/files/conversation/alice", bob.cookie);
    expect(((await listing.json()) as { files: unknown[] }).files).toHaveLength(
      1,
    );

    const fetched = await request(`/api/files/${file.id}`, bob.cookie);
    expect(fetched.status).toBe(200);
    const { file: envelope } = (await fetched.json()) as {
      file: EncryptedFileEnvelope;
    };
    expect(envelope).not.toHaveProperty("fileName");
    for (const participant of [alice, bob]) {
      const decoded = await decryptFile(envelope, participant.id, [
        participant.key.privateKey,
      ]);
      expect(decoded.bytes).toEqual(originalBytes);
      expect(decoded.fileName).toBe("verification.txt");
    }
    await expect(
      decryptFile(tamperFileCiphertextForDemo(envelope), bob.id, [
        bob.key.privateKey,
      ]),
    ).rejects.toThrow("GCM detected modified data");
    const report = await request(
      `/api/files/${file.id}/tamper-report`,
      bob.cookie,
      { method: "POST" },
    );
    expect(report.status).toBe(201);
    expect(
      ((await report.json()) as { event: { source: string } }).event.source,
    ).toBe("client-reported");
    expect((await request(`/api/files/${file.id}`)).status).toBe(401);
    expect((await upload()).status).toBe(409);

    const logout = await request("/api/auth/logout", bob.cookie, {
      method: "POST",
    });
    expect(logout.status).toBe(201);
    expect((await request("/api/auth/session", bob.cookie)).status).toBe(401);
  });

  it("rejects mutations without CSRF protection", async () => {
    const response = await fetch(new URL("/api/auth/logout", baseUrl), {
      method: "POST",
      headers: { Origin: new URL(baseUrl).origin, Cookie: alice.cookie },
      signal: AbortSignal.timeout(15_000),
    });
    expect(response.status).toBe(403);
  });

  it("blocks the sixth failed login without locking either demo account", async () => {
    const username = `test-${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(
        "/api/auth/login",
        "",
        jsonBody({ username, password: "invalid-test-only-password" }),
      );
      expect(response.status).toBe(attempt < 5 ? 401 : 429);
    }
  });
});
