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

describe("browser encryption using the real Web Crypto API", () => {
  let alice: LocalIdentityKey;
  let bob: LocalIdentityKey;
  let outsider: LocalIdentityKey;

  beforeAll(async () => {
    [alice, bob, outsider] = await Promise.all(
      ["alice", "bob", "outsider"].map(createLocalIdentityKey),
    );
  });

  async function message(
    plaintext = "Xin chào Bob 🔐",
  ): Promise<MessageCiphertext> {
    return {
      id: "message-1",
      version: 1,
      senderId: alice.userId,
      recipientId: bob.userId,
      createdAt: new Date().toISOString(),
      ...(await encryptMessage(
        plaintext,
        alice.userId,
        bob.userId,
        bob.publicKey,
        alice.publicKey,
      )),
    };
  }

  async function file(): Promise<EncryptedFileEnvelope> {
    const encrypted = await encryptFile(
      new File(
        [new Uint8Array([0, 255, 1, 128]), "Nội dung mẫu"],
        "báo cáo.txt",
      ),
      alice.userId,
      bob.userId,
      bob.publicKey,
      alice.publicKey,
    );
    return {
      ...encrypted,
      id: "file-1",
      version: 1,
      senderId: alice.userId,
      recipientId: bob.userId,
      ciphertext: Buffer.from(encrypted.ciphertext).toString("base64url"),
      ciphertextBytes: encrypted.ciphertext.byteLength,
      createdAt: new Date().toISOString(),
    };
  }

  it("keeps RSA private keys non-extractable", async () => {
    expect(alice.privateKey.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey("pkcs8", alice.privateKey),
    ).rejects.toThrow();
  });

  it("lets both participants decrypt the same Unicode message", async () => {
    const encrypted = await message();
    for (const identity of [alice, bob]) {
      await expect(
        decryptMessage(encrypted, identity.userId, [identity.privateKey]),
      ).resolves.toBe("Xin chào Bob 🔐");
    }
  });

  it("rejects an unrelated private key", async () => {
    await expect(
      decryptMessage(await message(), bob.userId, [outsider.privateKey]),
    ).rejects.toThrow("cannot be decrypted");
  });

  it("authenticates conversation metadata as well as ciphertext", async () => {
    const encrypted = await message();
    await expect(
      decryptMessage(
        { ...encrypted, senderId: "substituted-sender" },
        bob.userId,
        [bob.privateKey],
      ),
    ).rejects.toThrow("authentication tag");
  });

  it("uses fresh encryption material for repeated plaintext", async () => {
    const first = await message("same plaintext");
    const second = await message("same plaintext");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.recipientWrappedKey).not.toBe(second.recipientWrappedKey);
  });

  it("preserves binary bytes and the encrypted Unicode filename for both participants", async () => {
    const encrypted = await file();
    const original = new Uint8Array(
      await new Blob([
        new Uint8Array([0, 255, 1, 128]),
        "Nội dung mẫu",
      ]).arrayBuffer(),
    );
    for (const identity of [alice, bob]) {
      const decrypted = await decryptFile(encrypted, identity.userId, [
        identity.privateKey,
      ]);
      expect(decrypted.fileName).toBe("báo cáo.txt");
      expect(decrypted.bytes).toEqual(original);
    }
  });

  it("rejects a one-bit modification while leaving the original file readable", async () => {
    const original = await file();
    const snapshot = original.ciphertext;
    const modified = tamperFileCiphertextForDemo(original);
    expect(modified.ciphertext).not.toBe(snapshot);
    expect(original.ciphertext).toBe(snapshot);
    await expect(
      decryptFile(modified, bob.userId, [bob.privateKey]),
    ).rejects.toThrow("GCM detected modified data");
    await expect(
      decryptFile(original, bob.userId, [bob.privateKey]),
    ).resolves.toHaveProperty("fileName", "báo cáo.txt");
  });

  it("tries older local private keys after a key rotation", async () => {
    await expect(
      decryptMessage(await message(), bob.userId, [
        outsider.privateKey,
        bob.privateKey,
      ]),
    ).resolves.toBe("Xin chào Bob 🔐");
  });

  it("rejects files larger than the lab limit before encryption", async () => {
    await expect(
      encryptFile(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], "too-large.bin"),
        alice.userId,
        bob.userId,
        bob.publicKey,
        alice.publicKey,
      ),
    ).rejects.toThrow("8 MiB");
  });

  it("rejects empty messages and unsupported envelope versions", async () => {
    await expect(
      encryptMessage(
        "",
        alice.userId,
        bob.userId,
        bob.publicKey,
        alice.publicKey,
      ),
    ).rejects.toThrow("must contain text");
    await expect(
      decryptFile({ ...(await file()), version: 2 }, bob.userId, [
        bob.privateKey,
      ]),
    ).rejects.toThrow("Unsupported");
  });
});
