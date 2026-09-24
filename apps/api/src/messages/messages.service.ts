import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createPublicKey } from 'node:crypto';
import { db } from '../prisma/db.js';
import type { PublicUser } from '../auth/auth.types.js';
import type { PublishIdentityDto, SendMessageDto } from './messages.dto.js';

const MAX_MESSAGE_BYTES = 16 * 1024 + 16;
const RSA_2048_CIPHERTEXT_BYTES = 256;

export interface IdentityView {
  userId: string;
  username: string;
  displayName: string;
  publicKey: string;
  fingerprint: string;
}

function decodeCanonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new BadRequestException('Binary fields must use canonical base64url');
  }
  return decoded;
}

function fingerprintFor(publicKeyBytes: Buffer): string {
  return createHash('sha256')
    .update(publicKeyBytes)
    .digest('hex')
    .match(/.{2}/g)!
    .join(':')
    .toUpperCase();
}

function toIdentityView(
  identity: {
    userId: string;
    publicKey: string;
    fingerprint: string;
  },
  user: Pick<PublicUser, 'username' | 'displayName'>,
): IdentityView {
  return {
    userId: identity.userId,
    username: user.username,
    displayName: user.displayName,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint,
  };
}

function toMessageView(message: {
  id: string;
  senderId: string;
  recipientId: string;
  version: number;
  ciphertext: string;
  iv: string;
  senderWrappedKey: string;
  recipientWrappedKey: string;
  createdAt: string;
}) {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    version: message.version,
    ciphertext: message.ciphertext,
    iv: message.iv,
    senderWrappedKey: message.senderWrappedKey,
    recipientWrappedKey: message.recipientWrappedKey,
    createdAt: message.createdAt,
  };
}

@Injectable()
export class MessagesService {
  async getOwnIdentity(user: PublicUser) {
    const identity = await db.orm.public.CryptoIdentity
      .where((row) => row.userId.eq(user.id))
      .first();

    return {
      identity: identity ? toIdentityView(identity, user) : null,
    };
  }

  async getIdentityForUsername(username: string) {
    const user = await this.findUserByUsername(username);
    const identity = await db.orm.public.CryptoIdentity
      .where((row) => row.userId.eq(user.id))
      .first();

    return {
      identity: identity ? toIdentityView(identity, user) : null,
    };
  }

  async publishIdentity(user: PublicUser, input: PublishIdentityDto) {
    const publicKeyBytes = decodeCanonicalBase64Url(input.publicKey);
    let publicKey: ReturnType<typeof createPublicKey>;

    try {
      publicKey = createPublicKey({
        key: publicKeyBytes,
        format: 'der',
        type: 'spki',
      });
    } catch {
      throw new BadRequestException('Public key must be a valid RSA SPKI key');
    }

    if (
      publicKey.asymmetricKeyType !== 'rsa' ||
      publicKey.asymmetricKeyDetails?.modulusLength !== 2048
    ) {
      throw new BadRequestException('Only 2048-bit RSA public keys are accepted');
    }

    const fingerprint = fingerprintFor(publicKeyBytes);
    const current = await db.orm.public.CryptoIdentity
      .where((row) => row.userId.eq(user.id))
      .first();

    if (current?.publicKey === input.publicKey) {
      return { identity: toIdentityView(current, user) };
    }

    if (current && !input.replaceExisting) {
      throw new ConflictException(
        'An encryption identity already exists. Compare fingerprints before rotating it.',
      );
    }

    if (current) {
      await db.orm.public.CryptoIdentity
        .where((row) => row.userId.eq(user.id))
        .update({ publicKey: input.publicKey, fingerprint });
      const updated = await db.orm.public.CryptoIdentity
        .where((row) => row.userId.eq(user.id))
        .first();
      if (!updated) throw new ConflictException('Encryption identity changed; reload and retry.');
      return { identity: toIdentityView(updated, user) };
    }

    try {
      const created = await db.orm.public.CryptoIdentity.create({
        userId: user.id,
        publicKey: input.publicKey,
        fingerprint,
      });
      return { identity: toIdentityView(created, user) };
    } catch {
      const raced = await db.orm.public.CryptoIdentity
        .where((row) => row.userId.eq(user.id))
        .first();

      if (raced?.publicKey === input.publicKey) {
        return { identity: toIdentityView(raced, user) };
      }

      if (raced) {
        throw new ConflictException(
          'An encryption identity was created in another session. Reload and compare its fingerprint.',
        );
      }
      throw new ConflictException('Could not publish encryption identity; reload and retry.');
    }
  }

  async sendMessage(sender: PublicUser, input: SendMessageDto) {
    const ciphertext = decodeCanonicalBase64Url(input.ciphertext);
    const iv = decodeCanonicalBase64Url(input.iv);
    const senderWrappedKey = decodeCanonicalBase64Url(
      input.senderWrappedKey,
    );
    const recipientWrappedKey = decodeCanonicalBase64Url(
      input.recipientWrappedKey,
    );

    if (ciphertext.byteLength < 16 || ciphertext.byteLength > MAX_MESSAGE_BYTES) {
      throw new BadRequestException('Encrypted message size is outside the allowed range');
    }
    if (iv.byteLength !== 12) {
      throw new BadRequestException('AES-GCM IV must be exactly 12 bytes');
    }
    if (
      senderWrappedKey.byteLength !== RSA_2048_CIPHERTEXT_BYTES ||
      recipientWrappedKey.byteLength !== RSA_2048_CIPHERTEXT_BYTES
    ) {
      throw new BadRequestException('Wrapped AES keys must match a 2048-bit RSA key');
    }

    const recipient = await this.findUserByUsername(input.recipientUsername);
    if (recipient.id === sender.id) {
      throw new BadRequestException('Choose a different recipient');
    }

    const [senderIdentity, recipientIdentity] = await Promise.all([
      db.orm.public.CryptoIdentity
        .where((row) => row.userId.eq(sender.id))
        .first(),
      db.orm.public.CryptoIdentity
        .where((row) => row.userId.eq(recipient.id))
        .first(),
    ]);
    if (!senderIdentity) {
      throw new ConflictException('Publish your encryption identity before sending');
    }
    if (!recipientIdentity) {
      throw new ConflictException('Recipient has not published an encryption identity');
    }

    const message = await db.orm.public.SecureMessage.create({
      senderId: sender.id,
      recipientId: recipient.id,
      ciphertext: input.ciphertext,
      iv: input.iv,
      senderWrappedKey: input.senderWrappedKey,
      recipientWrappedKey: input.recipientWrappedKey,
    });

    return { message: toMessageView(message) };
  }

  async getConversation(user: PublicUser, username: string) {
    const peer = await this.findUserByUsername(username);
    if (peer.id === user.id) {
      return {
        conversationWith: {
          id: peer.id,
          username: peer.username,
          displayName: peer.displayName,
        },
        messages: [],
      };
    }

    const [sent, received] = await Promise.all([
      db.orm.public.SecureMessage
        .where((row) => row.senderId.eq(user.id))
        .where((row) => row.recipientId.eq(peer.id))
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(100)
        .all(),
      db.orm.public.SecureMessage
        .where((row) => row.senderId.eq(peer.id))
        .where((row) => row.recipientId.eq(user.id))
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(100)
        .all(),
    ]);

    const messages = sent
      .concat(received)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(-100)
      .map(toMessageView);

    return {
      conversationWith: {
        id: peer.id,
        username: peer.username,
        displayName: peer.displayName,
      },
      messages,
    };
  }

  private async findUserByUsername(username: string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
      throw new BadRequestException('Invalid username');
    }

    const user = await db.orm.public.User
      .where((row) => row.username.eq(username.toLowerCase()))
      .first();

    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
