const KEY_DATABASE_NAME = "network-security-lab-keys";
const KEY_DATABASE_VERSION = 1;
const KEY_STORE_NAME = "identities";
const MESSAGE_MAX_BYTES = 16 * 1024;

export interface LocalIdentityKey {
  keyId: string;
  userId: string;
  publicKey: string;
  fingerprint: string;
  privateKey: CryptoKey;
  createdAt: number;
}

export interface EncryptedMessagePayload {
  ciphertext: string;
  iv: string;
  senderWrappedKey: string;
  recipientWrappedKey: string;
}

export interface MessageCiphertext extends EncryptedMessagePayload {
  id: string;
  senderId: string;
  recipientId: string;
  version: number;
  createdAt: string;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE_NAME, KEY_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
        const store = database.createObjectStore(KEY_STORE_NAME, {
          keyPath: "keyId",
        });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local key storage"));
    request.onblocked = () =>
      reject(new Error("Local key storage is blocked by another tab"));
  });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function fingerprintFor(publicKeyBytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asArrayBuffer(publicKeyBytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join(":")
    .toUpperCase();
}

export async function createLocalIdentityKey(
  userId: string,
): Promise<LocalIdentityKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["wrapKey", "unwrapKey"],
  )) as CryptoKeyPair;

  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const publicKey = encodeBase64Url(publicKeyBytes);
  const fingerprint = await fingerprintFor(publicKeyBytes);

  if (pair.privateKey.extractable) {
    throw new Error("Private key unexpectedly allows export");
  }

  return {
    keyId: `${userId}:${fingerprint}`,
    userId,
    publicKey,
    fingerprint,
    privateKey: pair.privateKey,
    createdAt: Date.now(),
  };
}

export async function saveLocalIdentityKey(
  identityKey: LocalIdentityKey,
): Promise<void> {
  const database = await openKeyDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, "readwrite");
    transaction.objectStore(KEY_STORE_NAME).put(identityKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not store the local private key"),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Local private key storage was aborted"),
      );
  }).finally(() => database.close());
}

export async function getLocalIdentityKeys(
  userId: string,
): Promise<LocalIdentityKey[]> {
  const database = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(KEY_STORE_NAME)
        .index("userId")
        .getAll(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const keys = (request.result as LocalIdentityKey[])
          .filter(
            (entry) =>
              entry.userId === userId &&
              entry.privateKey instanceof CryptoKey &&
              entry.privateKey.type === "private" &&
              entry.privateKey.algorithm.name === "RSA-OAEP" &&
              entry.privateKey.extractable === false,
          )
          .sort((left, right) => right.createdAt - left.createdAt);
        resolve(keys);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read local private keys"));
    });
  } finally {
    database.close();
  }
}

function additionalData(
  version: number,
  senderId: string,
  recipientId: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `secure-message|v${version}|${senderId}|${recipientId}`,
  ) as Uint8Array<ArrayBuffer>;
}

async function importRecipientKey(
  encodedPublicKey: string,
): Promise<CryptoKey> {
  const bytes = decodeBase64Url(encodedPublicKey);
  return crypto.subtle.importKey(
    "spki",
    asArrayBuffer(bytes),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["wrapKey"],
  );
}

export async function encryptMessage(
  plaintext: string,
  senderId: string,
  recipientId: string,
  recipientPublicKey: string,
  senderPublicKey: string,
): Promise<EncryptedMessagePayload> {
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (
    plaintextBytes.byteLength === 0 ||
    plaintextBytes.byteLength > MESSAGE_MAX_BYTES
  ) {
    throw new Error(
      "A message must contain text and cannot exceed 16 KiB UTF-8.",
    );
  }

  const [recipientKey, senderKey] = await Promise.all([
    importRecipientKey(recipientPublicKey),
    importRecipientKey(senderPublicKey),
  ]);
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = additionalData(1, senderId, recipientId);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(aad),
      tagLength: 128,
    },
    aesKey,
    asArrayBuffer(plaintextBytes),
  );
  const [recipientWrappedKey, senderWrappedKey] = await Promise.all([
    crypto.subtle.wrapKey("raw", aesKey, recipientKey, { name: "RSA-OAEP" }),
    crypto.subtle.wrapKey("raw", aesKey, senderKey, { name: "RSA-OAEP" }),
  ]);

  return {
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    iv: encodeBase64Url(iv),
    senderWrappedKey: encodeBase64Url(new Uint8Array(senderWrappedKey)),
    recipientWrappedKey: encodeBase64Url(new Uint8Array(recipientWrappedKey)),
  };
}

export async function decryptMessage(
  message: MessageCiphertext,
  currentUserId: string,
  privateKeys: CryptoKey[],
): Promise<string> {
  if (message.version !== 1) {
    throw new Error("Unsupported encrypted message version");
  }

  const wrappedKey =
    message.senderId === currentUserId
      ? message.senderWrappedKey
      : message.recipientWrappedKey;
  const iv = decodeBase64Url(message.iv);
  const ciphertext = decodeBase64Url(message.ciphertext);
  const wrappedKeyBytes = decodeBase64Url(wrappedKey);

  if (iv.byteLength !== 12 || wrappedKeyBytes.byteLength !== 256) {
    throw new Error("Invalid encrypted message format");
  }

  for (const privateKey of privateKeys) {
    try {
      const aesKey = await crypto.subtle.unwrapKey(
        "raw",
        asArrayBuffer(wrappedKeyBytes),
        privateKey,
        { name: "RSA-OAEP" },
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asArrayBuffer(iv),
          additionalData: asArrayBuffer(
            additionalData(
              message.version,
              message.senderId,
              message.recipientId,
            ),
          ),
          tagLength: 128,
        },
        aesKey,
        asArrayBuffer(ciphertext),
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      // Try the next locally held RSA private key; rotation preserves old keys.
    }
  }

  throw new Error(
    "The message cannot be decrypted or its authentication tag is invalid.",
  );
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_METADATA_BYTES = 4 * 1024;
const FILE_CIPHERTEXT_OVERHEAD_BYTES = 4 + 16;

export interface EncryptedFilePayload {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: string;
  senderWrappedKey: string;
  recipientWrappedKey: string;
}

export interface EncryptedFileEnvelope {
  id: string;
  senderId: string;
  recipientId: string;
  version: number;
  ciphertext: string;
  ciphertextBytes: number;
  iv: string;
  senderWrappedKey: string;
  recipientWrappedKey: string;
  createdAt: string;
}

export interface DecryptedFilePayload {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
}

function fileAdditionalData(
  version: number,
  senderId: string,
  recipientId: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `secure-file|v${version}|${senderId}|${recipientId}`,
  ) as Uint8Array<ArrayBuffer>;
}

function safeFileName(value: string): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  const shortened = Array.from(cleaned).slice(0, 200).join("");
  return shortened && shortened !== "." && shortened !== ".."
    ? shortened
    : "download";
}

export async function encryptFile(
  file: File,
  senderId: string,
  recipientId: string,
  recipientPublicKey: string,
  senderPublicKey: string,
): Promise<EncryptedFilePayload> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("A file cannot exceed 8 MiB.");
  }

  const fileName = safeFileName(file.name);
  const metadata = new TextEncoder().encode(JSON.stringify({ fileName }));
  if (
    metadata.byteLength === 0 ||
    metadata.byteLength > MAX_FILE_METADATA_BYTES
  ) {
    throw new Error("The file name metadata is too large to encrypt.");
  }

  const [recipientKey, senderKey] = await Promise.all([
    importRecipientKey(recipientPublicKey),
    importRecipientKey(senderPublicKey),
  ]);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const plaintext = new Uint8Array(
    4 + metadata.byteLength + fileBytes.byteLength,
  );
  new DataView(plaintext.buffer).setUint32(0, metadata.byteLength, false);
  plaintext.set(metadata, 4);
  plaintext.set(fileBytes, 4 + metadata.byteLength);

  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(
        fileAdditionalData(1, senderId, recipientId),
      ),
      tagLength: 128,
    },
    aesKey,
    asArrayBuffer(plaintext),
  );
  const [recipientWrappedKey, senderWrappedKey] = await Promise.all([
    crypto.subtle.wrapKey("raw", aesKey, recipientKey, { name: "RSA-OAEP" }),
    crypto.subtle.wrapKey("raw", aesKey, senderKey, { name: "RSA-OAEP" }),
  ]);

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv: encodeBase64Url(iv),
    senderWrappedKey: encodeBase64Url(new Uint8Array(senderWrappedKey)),
    recipientWrappedKey: encodeBase64Url(new Uint8Array(recipientWrappedKey)),
  };
}

export async function decryptFile(
  file: EncryptedFileEnvelope,
  currentUserId: string,
  privateKeys: CryptoKey[],
): Promise<DecryptedFilePayload> {
  if (file.version !== 1) {
    throw new Error("Unsupported encrypted file version");
  }

  const wrappedKey =
    file.senderId === currentUserId
      ? file.senderWrappedKey
      : file.recipientWrappedKey;
  const iv = decodeBase64Url(file.iv);
  const ciphertext = decodeBase64Url(file.ciphertext);
  const wrappedKeyBytes = decodeBase64Url(wrappedKey);

  if (
    iv.byteLength !== 12 ||
    wrappedKeyBytes.byteLength !== 256 ||
    ciphertext.byteLength !== file.ciphertextBytes ||
    ciphertext.byteLength < 22 ||
    ciphertext.byteLength >
      MAX_FILE_BYTES + MAX_FILE_METADATA_BYTES + FILE_CIPHERTEXT_OVERHEAD_BYTES
  ) {
    throw new Error("Invalid encrypted file format");
  }

  for (const privateKey of privateKeys) {
    try {
      const aesKey = await crypto.subtle.unwrapKey(
        "raw",
        asArrayBuffer(wrappedKeyBytes),
        privateKey,
        { name: "RSA-OAEP" },
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: asArrayBuffer(iv),
            additionalData: asArrayBuffer(
              fileAdditionalData(file.version, file.senderId, file.recipientId),
            ),
            tagLength: 128,
          },
          aesKey,
          asArrayBuffer(ciphertext),
        ),
      );
      if (plaintext.byteLength < 6) {
        throw new Error("Encrypted file metadata is incomplete");
      }

      const metadataBytes = new DataView(
        plaintext.buffer,
        plaintext.byteOffset,
        4,
      ).getUint32(0, false);
      if (
        metadataBytes === 0 ||
        metadataBytes > MAX_FILE_METADATA_BYTES ||
        4 + metadataBytes > plaintext.byteLength
      ) {
        throw new Error("Encrypted file metadata is invalid");
      }

      const metadataText = new TextDecoder("utf-8", { fatal: true }).decode(
        plaintext.subarray(4, 4 + metadataBytes),
      );
      const metadata: unknown = JSON.parse(metadataText);
      if (
        !metadata ||
        typeof metadata !== "object" ||
        !("fileName" in metadata) ||
        typeof metadata.fileName !== "string"
      ) {
        throw new Error("Encrypted file name is invalid");
      }

      const bytes = plaintext.slice(4 + metadataBytes);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("Decrypted file exceeds the 8 MiB limit");
      }

      return {
        fileName: safeFileName(metadata.fileName),
        bytes,
      };
    } catch {
      // Try the next locally held RSA private key; rotation preserves old keys.
    }
  }

  throw new Error(
    "The file cannot be decrypted or GCM detected modified data.",
  );
}
