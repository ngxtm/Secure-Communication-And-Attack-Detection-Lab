"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createLocalIdentityKey,
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
  getLocalIdentityKeys,
  saveLocalIdentityKey,
  tamperFileCiphertextForDemo,
  type EncryptedFileEnvelope,
  type LocalIdentityKey,
  type MessageCiphertext,
} from "./crypto";

interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

interface Identity {
  userId: string;
  username: string;
  displayName: string;
  publicKey: string;
  fingerprint: string;
}

interface MessageResponse {
  messages: MessageCiphertext[];
  conversationWith: {
    id: string;
    username: string;
    displayName: string;
  };
}

type StoredFileSummary = Pick<
  EncryptedFileEnvelope,
  "id" | "senderId" | "recipientId" | "ciphertextBytes" | "createdAt"
>;

interface FileResponse {
  files: StoredFileSummary[];
  conversationWith: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface ReplayableFileUpload {
  requestId: string;
  recipientUsername: string;
  iv: string;
  senderWrappedKey: string;
  recipientWrappedKey: string;
  ciphertext: Uint8Array<ArrayBuffer>;
}

interface DisplayMessage extends MessageCiphertext {
  plaintext: string | null;
}

type AuthState = "checking" | "signed-in" | "signed-out" | "error";
type IdentityState = "checking" | "ready" | "missing" | "error";
type PeerState = "checking" | "ready" | "missing" | "error";
type PeerTrustState = "unverified" | "trusted" | "changed" | "unavailable";

const mutationHeaders = {
  "Content-Type": "application/json",
  "X-CSRF-Protection": "1",
};

function trustedFingerprintKey(userId: string): string {
  return `nsl:trusted-public-key:${userId}`;
}

function formatEncryptedSize(bytes: number): string {
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
      bytes / 1024,
    ) + " KiB encrypted"
  );
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join(" ");
  } catch {
    // Use the generic status message when the response is not JSON.
  }
  return `Request failed (${response.status})`;
}

function matchingLocalKey(
  keys: LocalIdentityKey[],
  identity: Identity | null,
): LocalIdentityKey | undefined {
  if (!identity) return undefined;
  return keys.find(
    (key) =>
      key.userId === identity.userId &&
      key.publicKey === identity.publicKey &&
      key.fingerprint === identity.fingerprint,
  );
}

function createFileUploadFormData(upload: ReplayableFileUpload): FormData {
  const formData = new FormData();
  formData.append("requestId", upload.requestId);
  formData.append("recipientUsername", upload.recipientUsername);
  formData.append("iv", upload.iv);
  formData.append("senderWrappedKey", upload.senderWrappedKey);
  formData.append("recipientWrappedKey", upload.recipientWrappedKey);
  formData.append(
    "ciphertext",
    new Blob([new Uint8Array(upload.ciphertext).buffer], {
      type: "application/octet-stream",
    }),
    "encrypted.bin",
  );
  return formData;
}

export default function MessagesClient() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [identityState, setIdentityState] = useState<IdentityState>("checking");
  const [peerState, setPeerState] = useState<PeerState>("checking");
  const [peerTrustState, setPeerTrustState] =
    useState<PeerTrustState>("unverified");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ownIdentity, setOwnIdentity] = useState<Identity | null>(null);
  const [localKeys, setLocalKeys] = useState<LocalIdentityKey[]>([]);
  const [peerIdentity, setPeerIdentity] = useState<Identity | null>(null);
  const [pinnedFingerprint, setPinnedFingerprint] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [pageError, setPageError] = useState("");
  const [conversationError, setConversationError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [files, setFiles] = useState<StoredFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
    null,
  );
  const [tamperingFileId, setTamperingFileId] = useState<string | null>(null);
  const [replayableUpload, setReplayableUpload] =
    useState<ReplayableFileUpload | null>(null);
  const [isReplayingUpload, setIsReplayingUpload] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileNotice, setFileNotice] = useState("");

  const peerUsername =
    user?.username.toLowerCase() === "alice" ? "bob" : "alice";
  const activeLocalKey = matchingLocalKey(localKeys, ownIdentity);

  useEffect(() => {
    let cancelled = false;
    let sessionLoaded = false;

    async function loadIdentity() {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (sessionResponse.status === 401) {
          if (!cancelled) setAuthState("signed-out");
          return;
        }
        if (!sessionResponse.ok) {
          throw new Error(await responseError(sessionResponse));
        }

        const session = (await sessionResponse.json()) as { user: PublicUser };
        sessionLoaded = true;
        if (!cancelled) {
          setUser(session.user);
          setAuthState("signed-in");
        }

        const identityResponse = await fetch("/api/messages/identity", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!identityResponse.ok) {
          throw new Error(await responseError(identityResponse));
        }
        const identityData = (await identityResponse.json()) as {
          identity: Identity | null;
        };
        let identity = identityData.identity;
        let keys = await getLocalIdentityKeys(session.user.id);

        if (!identity) {
          if (keys.length === 0) {
            const generated = await createLocalIdentityKey(session.user.id);
            await saveLocalIdentityKey(generated);
            keys = [generated];
          }

          const keyToPublish = keys[0]!;
          const publishResponse = await fetch("/api/messages/identity", {
            method: "PUT",
            headers: mutationHeaders,
            credentials: "same-origin",
            body: JSON.stringify({ publicKey: keyToPublish.publicKey }),
          });
          if (!publishResponse.ok) {
            throw new Error(await responseError(publishResponse));
          }

          const published = (await publishResponse.json()) as {
            identity: Identity;
          };
          identity = published.identity;
          keys = await getLocalIdentityKeys(session.user.id);
        }

        if (cancelled) return;
        setOwnIdentity(identity);
        setLocalKeys(keys);
        setIdentityState(
          matchingLocalKey(keys, identity) ? "ready" : "missing",
        );
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Could not initialize the encryption key.";
        setPageError(message);
        if (sessionLoaded) setIdentityState("error");
        else setAuthState("error");
      }
    }

    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setPeerState("checking");
    setPeerIdentity(null);

    async function loadPeerIdentity() {
      try {
        const response = await fetch(
          `/api/messages/identity/${encodeURIComponent(peerUsername)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const data = (await response.json()) as { identity: Identity | null };
        if (cancelled) return;

        setPeerIdentity(data.identity);
        if (!data.identity) {
          setPeerState("missing");
          return;
        }

        try {
          const pinned = window.localStorage.getItem(
            trustedFingerprintKey(data.identity.userId),
          );
          setPinnedFingerprint(pinned);
          setPeerTrustState(
            !pinned
              ? "unverified"
              : pinned === data.identity.fingerprint
                ? "trusted"
                : "changed",
          );
        } catch {
          setPinnedFingerprint(null);
          setPeerTrustState("unavailable");
        }
        setPeerState("ready");
      } catch (error) {
        if (cancelled) return;
        setPeerState("error");
        setPageError(
          error instanceof Error
            ? error.message
            : "Could not load the recipient public key.",
        );
      }
    }

    void loadPeerIdentity();
    return () => {
      cancelled = true;
    };
  }, [peerUsername, user]);

  const refreshMessages = useCallback(async () => {
    if (!user || !peerIdentity) return;

    setIsLoadingMessages(true);
    setConversationError("");
    try {
      const response = await fetch(
        `/api/messages/conversation/${encodeURIComponent(peerIdentity.username)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw new Error(await responseError(response));

      const data = (await response.json()) as MessageResponse;
      const decrypted = await Promise.all(
        data.messages.map(async (message): Promise<DisplayMessage> => {
          try {
            const plaintext = await decryptMessage(
              message,
              user.id,
              localKeys.map((key) => key.privateKey),
            );
            return { ...message, plaintext };
          } catch {
            return { ...message, plaintext: null };
          }
        }),
      );
      setMessages(decrypted);
    } catch (error) {
      setConversationError(
        error instanceof Error
          ? error.message
          : "Could not load the conversation.",
      );
    } finally {
      setIsLoadingMessages(false);
    }
  }, [localKeys, peerIdentity, user]);

  useEffect(() => {
    void refreshMessages();
  }, [refreshMessages]);

  const refreshFiles = useCallback(async () => {
    if (!user || !peerIdentity) return;

    setFileError("");
    try {
      const response = await fetch(
        "/api/files/conversation/" + encodeURIComponent(peerIdentity.username),
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const data = (await response.json()) as FileResponse;
      setFiles(data.files);
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Could not load encrypted files.",
      );
    }
  }, [peerIdentity, user]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  async function confirmPeerFingerprint() {
    if (!peerIdentity) return;

    if (
      pinnedFingerprint &&
      pinnedFingerprint !== peerIdentity.fingerprint &&
      !window.confirm(
        "The fingerprint has changed. Accept the new key only after verifying it with Bob through another channel. Continue?",
      )
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        trustedFingerprintKey(peerIdentity.userId),
        peerIdentity.fingerprint,
      );
      setPinnedFingerprint(peerIdentity.fingerprint);
      setPeerTrustState("trusted");
      setNotice("The recipient fingerprint has been verified in this browser.");
      setPageError("");
    } catch {
      setPeerTrustState("unavailable");
      setPageError("The browser could not save the verified fingerprint.");
    }
  }

  async function rotateOwnIdentity() {
    if (!user || !ownIdentity) return;
    const accepted = window.confirm(
      "Update the public identity? The app will reuse the latest local private key if available; otherwise, it will create a new key. Old messages can only be decrypted if their matching private keys are still in this browser. Continue?",
    );
    if (!accepted) return;

    setIsRotating(true);
    setPageError("");
    setNotice("");
    try {
      let replacement = localKeys[0];
      if (!replacement || replacement.publicKey === ownIdentity.publicKey) {
        replacement = await createLocalIdentityKey(user.id);
      }
      await saveLocalIdentityKey(replacement);

      const response = await fetch("/api/messages/identity", {
        method: "PUT",
        headers: mutationHeaders,
        credentials: "same-origin",
        body: JSON.stringify({
          publicKey: replacement.publicKey,
          replaceExisting: true,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));

      const result = (await response.json()) as { identity: Identity };
      const updatedKeys = await getLocalIdentityKeys(user.id);
      setOwnIdentity(result.identity);
      setLocalKeys(updatedKeys);
      setIdentityState(
        matchingLocalKey(updatedKeys, result.identity) ? "ready" : "missing",
      );
      setNotice(
        "The public key has been updated. Previous private keys remain on this device.",
      );
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "Could not update the encryption identity.",
      );
    } finally {
      setIsRotating(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !ownIdentity || !activeLocalKey || !peerIdentity) return;

    setPageError("");
    setNotice("");
    setIsSending(true);
    try {
      const encrypted = await encryptMessage(
        messageText.trim(),
        user.id,
        peerIdentity.userId,
        peerIdentity.publicKey,
        ownIdentity.publicKey,
      );
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: mutationHeaders,
        credentials: "same-origin",
        body: JSON.stringify({
          recipientUsername: peerIdentity.username,
          ...encrypted,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));

      setMessageText("");
      setNotice("Encrypted in the browser and sent ciphertext to the API.");
      await refreshMessages();
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "Could not send the encrypted message.",
      );
    } finally {
      setIsSending(false);
    }
  }

  async function sendFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || !user || !ownIdentity || !peerIdentity || !selectedFile) {
      return;
    }

    const form = event.currentTarget;
    setFileError("");
    setFileNotice("");
    setIsUploadingFile(true);
    try {
      const encrypted = await encryptFile(
        selectedFile,
        user.id,
        peerIdentity.userId,
        peerIdentity.publicKey,
        ownIdentity.publicKey,
      );
      const upload: ReplayableFileUpload = {
        requestId: crypto.randomUUID(),
        recipientUsername: peerIdentity.username,
        iv: encrypted.iv,
        senderWrappedKey: encrypted.senderWrappedKey,
        recipientWrappedKey: encrypted.recipientWrappedKey,
        ciphertext: new Uint8Array(encrypted.ciphertext),
      };

      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
        credentials: "same-origin",
        body: createFileUploadFormData(upload),
      });
      if (!response.ok) throw new Error(await responseError(response));

      setReplayableUpload(upload);
      setSelectedFile(null);
      form.reset();
      setFileNotice("Encrypted in this browser and uploaded as ciphertext.");
      await refreshFiles();
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Could not encrypt and upload the file.",
      );
    } finally {
      setIsUploadingFile(false);
    }
  }

  async function simulateFileReplay() {
    const upload = replayableUpload;
    if (!user || !upload) return;

    setFileError("");
    setFileNotice("");
    setIsReplayingUpload(true);
    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
        credentials: "same-origin",
        body: createFileUploadFormData(upload),
      });

      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          code?: unknown;
          message?: unknown;
        } | null;
        if (body?.code === "REPLAY_DETECTED") {
          setFileNotice(
            "Replay blocked with HTTP 409. No second file was stored, and FILE_REPLAY_BLOCKED was logged.",
          );
          return;
        }
        const message =
          typeof body?.message === "string"
            ? body.message
            : "Replay request was rejected (HTTP 409).";
        throw new Error(message);
      }

      if (!response.ok) throw new Error(await responseError(response));

      setFileError(
        "Replay simulation was not blocked: the server accepted the upload again.",
      );
      await refreshFiles();
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Could not run the replay simulation.",
      );
    } finally {
      setIsReplayingUpload(false);
    }
  }

  async function downloadFile(fileId: string) {
    if (!user) return;

    setFileError("");
    setFileNotice("");
    setDownloadingFileId(fileId);
    try {
      const response = await fetch("/api/files/" + encodeURIComponent(fileId), {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));

      const data = (await response.json()) as { file: EncryptedFileEnvelope };
      const decrypted = await decryptFile(
        data.file,
        user.id,
        localKeys.map((key) => key.privateKey),
      );
      const blob = new Blob([decrypted.bytes.buffer], {
        type: "application/octet-stream",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = decrypted.fileName;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setFileNotice(
        "Decrypted locally and downloaded " + decrypted.fileName + ".",
      );
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Could not decrypt and download the file.",
      );
    } finally {
      setDownloadingFileId(null);
    }
  }

  async function simulateFileTampering(fileId: string) {
    if (!user) return;

    setFileError("");
    setFileNotice("");
    setTamperingFileId(fileId);
    try {
      const response = await fetch("/api/files/" + encodeURIComponent(fileId), {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));

      const data = (await response.json()) as { file: EncryptedFileEnvelope };
      const tampered = tamperFileCiphertextForDemo(data.file);
      try {
        await decryptFile(
          tampered,
          user.id,
          localKeys.map((key) => key.privateKey),
        );
        setFileError(
          "Tamper simulation failed: AES-GCM accepted the modified ciphertext.",
        );
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("GCM detected modified data.")
        ) {
          throw error;
        }
      }

      const reportResponse = await fetch(
        "/api/files/" + encodeURIComponent(fileId) + "/tamper-report",
        {
          method: "POST",
          headers: { "X-CSRF-Protection": "1" },
          credentials: "same-origin",
        },
      );
      if (!reportResponse.ok) {
        setFileError(
          "AES-GCM rejected the modified ciphertext, but the security event could not be saved: " +
            (await responseError(reportResponse)),
        );
        return;
      }

      setFileNotice(
        "Tampering detected by AES-GCM. A client-reported event was logged. The stored file was not changed.",
      );
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Could not run the tamper simulation.",
      );
    } finally {
      setTamperingFileId(null);
    }
  }

  async function signOut() {
    setPageError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: mutationHeaders,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setUser(null);
      setOwnIdentity(null);
      setPeerIdentity(null);
      setMessages([]);
      setFiles([]);
      setSelectedFile(null);
      setReplayableUpload(null);
      setAuthState("signed-out");
      setNotice("Signed out and revoked the session.");
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    }
  }

  const canSend =
    authState === "signed-in" &&
    identityState === "ready" &&
    peerState === "ready" &&
    peerTrustState === "trusted" &&
    Boolean(activeLocalKey && peerIdentity);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
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

          <div className="flex items-center gap-3">
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300">
              Phase 2 · Secure Messaging & Files
            </span>
            {user && (
              <>
                <span className="hidden text-sm text-slate-300 sm:inline">
                  {user.displayName} · @{user.username}
                </span>
                <button
                  type="button"
                  onClick={signOut}
                  className="min-h-9 rounded-full border border-white/15 px-3 text-xs font-medium text-slate-200 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:py-10">
          <div className="min-w-0">
            <div className="mb-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                Browser encryption · RSA key wrapping · AES-GCM
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Messages are readable only on a device with the matching key.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                The browser encrypts each message and file before sending. The
                API stores ciphertext, the IV, and RSA-OAEP-wrapped AES keys for
                both people in the conversation. File names are encrypted inside
                the file payload.
              </p>
            </div>

            {authState === "checking" && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-300">
                Checking the session and local keys…
              </div>
            )}

            {authState === "signed-out" && (
              <div className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-5">
                <h2 className="font-semibold">You are not signed in</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Sign in as Alice or Bob first. Each account will create and
                  store its own private key in this browser.
                </p>
                <Link
                  href="/login"
                  className="mt-4 inline-flex min-h-10 items-center rounded-full bg-emerald-200 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-100"
                >
                  Go to sign in
                </Link>
              </div>
            )}

            {authState === "error" && (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-5">
                <h2 className="font-semibold">Could not connect to the lab</h2>
                <p className="mt-2 text-sm leading-6 text-rose-100">
                  {pageError || "Check the API and PostgreSQL status."}
                </p>
                <Link
                  href="/login"
                  className="mt-4 inline-flex text-sm text-slate-200 underline underline-offset-4"
                >
                  Back to sign in
                </Link>
              </div>
            )}

            {authState === "signed-in" && (
              <>
                {pageError && (
                  <div
                    role="alert"
                    className="mb-5 rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 text-sm leading-6 text-rose-100"
                  >
                    {pageError}
                  </div>
                )}
                {notice && (
                  <div
                    role="status"
                    className="mb-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-3 text-sm leading-6 text-emerald-100"
                  >
                    {notice}
                  </div>
                )}

                <section
                  aria-labelledby="conversation-heading"
                  className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20"
                >
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
                    <div>
                      <p className="font-mono text-xs text-emerald-200">
                        MESSAGE / 01
                      </p>
                      <h2
                        id="conversation-heading"
                        className="mt-1 text-lg font-semibold"
                      >
                        Conversation with{" "}
                        {peerIdentity?.displayName ?? peerUsername}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshMessages()}
                      disabled={!peerIdentity || isLoadingMessages}
                      className="min-h-9 rounded-full border border-white/15 px-3 text-xs font-medium text-slate-200 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-50"
                    >
                      {isLoadingMessages ? "Loading…" : "Refresh"}
                    </button>
                  </header>

                  <div className="max-h-[32rem] min-h-64 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
                    {peerState === "checking" && (
                      <p className="text-sm text-slate-400">
                        Loading the public key for {peerUsername}…
                      </p>
                    )}
                    {peerState === "missing" && (
                      <div className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-4 text-sm leading-6 text-amber-100">
                        {peerUsername} has not created an encryption identity
                        yet. Sign out, sign in as that account, and open
                        Messages once.
                      </div>
                    )}
                    {conversationError && (
                      <p
                        role="alert"
                        className="text-sm leading-6 text-rose-200"
                      >
                        {conversationError}
                      </p>
                    )}
                    {peerState === "ready" &&
                      messages.length === 0 &&
                      !isLoadingMessages && (
                        <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-white/10 px-5 text-center">
                          <div>
                            <p className="text-sm font-medium text-slate-200">
                              No messages yet
                            </p>
                            <p className="mt-2 text-xs leading-5 text-slate-400">
                              Verify the recipient fingerprint to enable
                              messaging.
                            </p>
                          </div>
                        </div>
                      )}

                    {messages.map((message) => {
                      const isOwnMessage = message.senderId === user?.id;
                      return (
                        <article
                          key={message.id}
                          className={`max-w-[92%] rounded-2xl border px-4 py-3 sm:max-w-[82%] ${isOwnMessage ? "ml-auto border-emerald-200/20 bg-emerald-200/[0.08]" : "border-white/10 bg-slate-950/40"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                            <p className="text-xs font-semibold text-slate-200">
                              {isOwnMessage
                                ? "You"
                                : (peerIdentity?.displayName ?? peerUsername)}
                            </p>
                            <time className="font-mono text-[10px] text-slate-500">
                              {message.createdAt.replace("T", " ").slice(0, 16)}{" "}
                              UTC
                            </time>
                          </div>
                          {message.plaintext !== null ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">
                              {message.plaintext}
                            </p>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-amber-100">
                              Could not decrypt: the key is incorrect or GCM
                              detected modified data.
                            </p>
                          )}
                          <details className="mt-3 border-t border-white/[0.08] pt-2">
                            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                              View the encrypted envelope stored on the server
                            </summary>
                            <dl className="mt-3 grid gap-2 text-[11px]">
                              <div>
                                <dt className="text-slate-500">
                                  AES-GCM ciphertext
                                </dt>
                                <dd className="mt-1 break-all font-mono text-slate-300">
                                  {message.ciphertext.slice(0, 112)}…
                                </dd>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <dt className="text-slate-500">
                                    IV · base64url
                                  </dt>
                                  <dd className="mt-1 break-all font-mono text-slate-300">
                                    {message.iv}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-slate-500">
                                    RSA envelopes
                                  </dt>
                                  <dd className="mt-1 font-mono text-slate-300">
                                    2 × 256 bytes
                                  </dd>
                                </div>
                              </div>
                            </dl>
                          </details>
                        </article>
                      );
                    })}
                  </div>

                  <form
                    onSubmit={sendMessage}
                    className="border-t border-white/10 bg-slate-950/25 p-4 sm:p-5"
                  >
                    <label
                      htmlFor="message"
                      className="mb-2 block text-xs font-medium text-slate-300"
                    >
                      Message · up to 16 KiB UTF-8
                    </label>
                    <textarea
                      id="message"
                      value={messageText}
                      onChange={(event) => setMessageText(event.target.value)}
                      maxLength={8000}
                      rows={3}
                      placeholder="Enter a message to encrypt…"
                      className="w-full resize-y rounded-2xl border border-white/15 bg-slate-950/60 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-200/70 focus:ring-2 focus:ring-emerald-200/15"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs leading-5 text-slate-500">
                        Plaintext is never sent to the API.
                      </p>
                      <button
                        type="submit"
                        disabled={
                          !canSend ||
                          isSending ||
                          messageText.trim().length === 0
                        }
                        className="min-h-11 rounded-full bg-emerald-200 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
                      >
                        {isSending ? "Encrypting…" : "Encrypt and send"}
                      </button>
                    </div>
                    {!canSend && peerState === "ready" && (
                      <p className="mt-3 text-xs leading-5 text-amber-100/80">
                        A local private key and a verified recipient fingerprint
                        are required before sending.
                      </p>
                    )}
                  </form>
                </section>
                <section
                  aria-labelledby="files-heading"
                  className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]"
                >
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
                    <div>
                      <p className="font-mono text-xs text-emerald-200">
                        FILES / 03
                      </p>
                      <h2
                        id="files-heading"
                        className="mt-1 text-lg font-semibold"
                      >
                        Encrypted file transfer
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshFiles()}
                      disabled={
                        !peerIdentity || isUploadingFile || isReplayingUpload
                      }
                      className="min-h-9 rounded-full border border-white/15 px-3 text-xs font-medium text-slate-200 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-50"
                    >
                      Refresh files
                    </button>
                  </header>

                  <div className="space-y-3 px-5 py-4 sm:px-6">
                    {fileError && (
                      <p
                        role="alert"
                        className="text-sm leading-6 text-rose-200"
                      >
                        {fileError}
                      </p>
                    )}
                    {fileNotice && (
                      <p
                        role="status"
                        className="text-sm leading-6 text-emerald-100"
                      >
                        {fileNotice}
                      </p>
                    )}
                    {files.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        No encrypted files in this conversation yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {files.map((file) => (
                          <li
                            key={file.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-100">
                                {file.senderId === user?.id
                                  ? "Sent by you"
                                  : "Sent by " +
                                    (peerIdentity?.displayName ?? peerUsername)}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {formatEncryptedSize(file.ciphertextBytes)} ·{" "}
                                {file.createdAt.replace("T", " ").slice(0, 16)}{" "}
                                UTC
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void downloadFile(file.id)}
                                disabled={
                                  !activeLocalKey ||
                                  isUploadingFile ||
                                  isReplayingUpload ||
                                  downloadingFileId !== null ||
                                  tamperingFileId !== null
                                }
                                className="min-h-9 rounded-full border border-emerald-200/25 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-200/[0.08] disabled:cursor-wait disabled:opacity-50"
                              >
                                {downloadingFileId === file.id
                                  ? "Decrypting…"
                                  : "Download & decrypt"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void simulateFileTampering(file.id)
                                }
                                disabled={
                                  !activeLocalKey ||
                                  isUploadingFile ||
                                  isReplayingUpload ||
                                  downloadingFileId !== null ||
                                  tamperingFileId !== null
                                }
                                className="min-h-9 rounded-full border border-amber-200/25 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-200/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-wait disabled:opacity-50"
                              >
                                {tamperingFileId === file.id
                                  ? "Simulating…"
                                  : "Simulate tampering"}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="text-xs leading-5 text-slate-400">
                      The tamper demo changes one bit in a temporary browser
                      copy. It never alters the stored file.
                    </p>

                    <div className="rounded-2xl border border-rose-200/15 bg-rose-300/[0.04] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-rose-100">
                            Attack simulator · Replay upload
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            Re-sends the most recent successful encrypted upload
                            with its original request ID.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void simulateFileReplay()}
                          disabled={
                            !replayableUpload ||
                            isUploadingFile ||
                            isReplayingUpload ||
                            downloadingFileId !== null ||
                            tamperingFileId !== null
                          }
                          className="min-h-9 rounded-full border border-rose-200/25 px-3 text-xs font-semibold text-rose-100 hover:bg-rose-200/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isReplayingUpload
                            ? "Replaying…"
                            : "Replay last upload"}
                        </button>
                      </div>
                      {replayableUpload ? (
                        <p className="mt-3 break-all font-mono text-[11px] text-slate-500">
                          Same request ID: {replayableUpload.requestId}
                        </p>
                      ) : (
                        <p className="mt-3 text-xs text-slate-500">
                          Send one file first to create a replayable request.
                        </p>
                      )}
                    </div>

                    <form
                      onSubmit={sendFile}
                      className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                    >
                      <div>
                        <label
                          htmlFor="encrypted-file"
                          className="mb-2 block text-xs font-medium text-slate-300"
                        >
                          Choose a file · maximum 8 MiB
                        </label>
                        <input
                          id="encrypted-file"
                          type="file"
                          disabled={isUploadingFile || isReplayingUpload}
                          onChange={(event) =>
                            setSelectedFile(
                              event.currentTarget.files?.[0] ?? null,
                            )
                          }
                          className="block min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-100"
                        />
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          The browser encrypts the content and original file
                          name. The API receives only ciphertext and participant
                          metadata.
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={
                          !canSend ||
                          isUploadingFile ||
                          isReplayingUpload ||
                          !selectedFile
                        }
                        className="min-h-11 rounded-full bg-emerald-200 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isUploadingFile
                          ? "Encrypting & uploading…"
                          : "Encrypt and send file"}
                      </button>
                    </form>
                    {!canSend && peerState === "ready" && (
                      <p className="text-xs leading-5 text-amber-100/80">
                        A local private key and a verified recipient fingerprint
                        are required before sending files.
                      </p>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>

          {authState === "signed-in" && (
            <aside className="space-y-5">
              <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-emerald-200">
                      KEYS / 01
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">
                      Encryption identity
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] ${identityState === "ready" ? "bg-emerald-300/10 text-emerald-100" : "bg-amber-200/10 text-amber-100"}`}
                  >
                    {identityState === "checking"
                      ? "Checking"
                      : identityState === "ready"
                        ? "Key ready"
                        : identityState === "missing"
                          ? "Private key missing"
                          : "Error"}
                  </span>
                </div>

                {ownIdentity ? (
                  <>
                    <p className="mt-4 text-xs text-slate-400">
                      Public key for {ownIdentity.displayName}
                    </p>
                    <code className="mt-2 block break-all rounded-xl border border-white/10 bg-slate-950/50 p-3 text-[10px] leading-5 text-slate-300">
                      SHA-256: {ownIdentity.fingerprint}
                    </code>
                  </>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-400">
                    Creating the RSA-OAEP 2048-bit identity for the first time.
                  </p>
                )}

                <div className="mt-4 space-y-2 text-xs leading-5 text-slate-400">
                  <p>RSA-OAEP / SHA-256 · non-extractable private key</p>
                  <p>The private key is stored in this browser's IndexedDB.</p>
                  <p>AES-256-GCM uses a new random key for each message.</p>
                </div>

                {identityState === "missing" && (
                  <div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-4">
                    <p className="text-xs leading-5 text-amber-100">
                      The server has the public key, but this browser has no
                      matching private key. Old messages may not be decryptable.
                    </p>
                    <button
                      type="button"
                      onClick={rotateOwnIdentity}
                      disabled={isRotating}
                      className="mt-3 min-h-10 w-full rounded-xl border border-amber-100/20 px-3 text-xs font-semibold text-amber-50 hover:bg-amber-100/[0.06] disabled:opacity-50"
                    >
                      {isRotating ? "Updating key…" : "Recover identity"}
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-emerald-200">
                      TRUST / 02
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">
                      Verify recipient
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] ${peerTrustState === "trusted" ? "bg-emerald-300/10 text-emerald-100" : "bg-amber-200/10 text-amber-100"}`}
                  >
                    {peerTrustState === "trusted"
                      ? "Verified"
                      : peerTrustState === "changed"
                        ? "Fingerprint changed"
                        : peerTrustState === "unavailable"
                          ? "Could not save"
                          : "Unverified"}
                  </span>
                </div>

                {peerIdentity ? (
                  <>
                    <p className="mt-4 text-xs text-slate-400">
                      Public key for {peerIdentity.displayName}
                    </p>
                    <code className="mt-2 block break-all rounded-xl border border-white/10 bg-slate-950/50 p-3 text-[10px] leading-5 text-slate-300">
                      SHA-256: {peerIdentity.fingerprint}
                    </code>
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      Compare this value with the fingerprint shown in{" "}
                      {peerUsername}'s account, using another channel. The
                      server distributes the public key but does not
                      authenticate its owner.
                    </p>
                    {peerTrustState !== "trusted" &&
                      peerTrustState !== "unavailable" && (
                        <button
                          type="button"
                          onClick={confirmPeerFingerprint}
                          className="mt-4 min-h-10 w-full rounded-xl border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/[0.06]"
                        >
                          {peerTrustState === "changed"
                            ? "Accept the new fingerprint after verification"
                            : "Compared · confirm fingerprint"}
                        </button>
                      )}
                  </>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-400">
                    {peerState === "checking"
                      ? "Loading identity…"
                      : peerState === "missing"
                        ? `Account ${peerUsername} has not published a public key.`
                        : "Could not load the recipient public key."}
                  </p>
                )}
              </section>

              <section className="rounded-3xl border border-emerald-200/15 bg-emerald-200/[0.045] p-5">
                <p className="font-mono text-xs text-emerald-200">
                  SERVER VIEW
                </p>
                <h2 className="mt-2 font-semibold">Data received by the API</h2>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                  <li>• AES-GCM ciphertext and a random 96-bit IV</li>
                  <li>• AES key wrapped with RSA for Alice and Bob</li>
                  <li>
                    • Sender/recipient IDs, send time, and encrypted file size
                  </li>
                  <li>
                    • File names and file contents remain inside the encrypted
                    payload
                  </li>
                </ul>
                <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-slate-400">
                  GCM authenticates the ciphertext and metadata. Modified data
                  will fail decryption.
                </p>
              </section>
            </aside>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-500">
          <span>Educational lab · Do not use with real sensitive data</span>
          <Link
            href="/login"
            className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-white"
          >
            Authentication
          </Link>
        </footer>
      </div>
    </main>
  );
}
