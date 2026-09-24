import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import type { PublicUser } from '../auth/auth.types.js';
import type { UploadFileDto } from './files.dto.js';
import { MAX_CIPHERTEXT_FILE_BYTES } from './file-limits.js';
import type { EncryptedFileUpload } from './files.types.js';

const RSA_2048_CIPHERTEXT_BYTES = 256;
const MIN_CIPHERTEXT_FILE_BYTES = 22;

function decodeCanonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new BadRequestException('Binary fields must use canonical base64url');
  }
  return decoded;
}

function toFileSummary(file: {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertextBytes: number;
  createdAt: string;
}) {
  return {
    id: file.id,
    senderId: file.senderId,
    recipientId: file.recipientId,
    ciphertextBytes: file.ciphertextBytes,
    createdAt: file.createdAt,
  };
}

@Injectable()
export class FilesService {
  async upload(
    sender: PublicUser,
    input: UploadFileDto,
    file: EncryptedFileUpload | undefined,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('An encrypted file payload is required');
    }

    const ciphertextBytes = file.buffer.byteLength;
    if (
      ciphertextBytes < MIN_CIPHERTEXT_FILE_BYTES ||
      ciphertextBytes > MAX_CIPHERTEXT_FILE_BYTES
    ) {
      throw new BadRequestException(
        'Encrypted file size is outside the allowed range',
      );
    }

    const iv = decodeCanonicalBase64Url(input.iv);
    const senderWrappedKey = decodeCanonicalBase64Url(input.senderWrappedKey);
    const recipientWrappedKey = decodeCanonicalBase64Url(
      input.recipientWrappedKey,
    );
    if (iv.byteLength !== 12) {
      throw new BadRequestException('AES-GCM IV must be exactly 12 bytes');
    }
    if (
      senderWrappedKey.byteLength !== RSA_2048_CIPHERTEXT_BYTES ||
      recipientWrappedKey.byteLength !== RSA_2048_CIPHERTEXT_BYTES
    ) {
      throw new BadRequestException(
        'Wrapped AES keys must match a 2048-bit RSA key',
      );
    }

    const recipient = await this.findUserByUsername(input.recipientUsername);
    if (recipient.id === sender.id) {
      throw new BadRequestException('Choose a different recipient');
    }

    const [senderIdentity, recipientIdentity] = await Promise.all([
      db.orm.public.CryptoIdentity.where((row) =>
        row.userId.eq(sender.id),
      ).first(),
      db.orm.public.CryptoIdentity.where((row) =>
        row.userId.eq(recipient.id),
      ).first(),
    ]);
    if (!senderIdentity) {
      throw new ConflictException(
        'Publish your encryption identity before sending',
      );
    }
    if (!recipientIdentity) {
      throw new ConflictException(
        'Recipient has not published an encryption identity',
      );
    }

    const saved = await db.orm.public.SecureFile.create({
      senderId: sender.id,
      recipientId: recipient.id,
      ciphertext: Uint8Array.from(file.buffer),
      ciphertextBytes,
      iv: input.iv,
      senderWrappedKey: input.senderWrappedKey,
      recipientWrappedKey: input.recipientWrappedKey,
    });

    return { file: toFileSummary(saved) };
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
        files: [],
      };
    }

    const fields = [
      'id',
      'senderId',
      'recipientId',
      'ciphertextBytes',
      'createdAt',
    ] as const;
    const [sent, received] = await Promise.all([
      db.orm.public.SecureFile.where((row) => row.senderId.eq(user.id))
        .where((row) => row.recipientId.eq(peer.id))
        .select(...fields)
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(50)
        .all(),
      db.orm.public.SecureFile.where((row) => row.senderId.eq(peer.id))
        .where((row) => row.recipientId.eq(user.id))
        .select(...fields)
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(50)
        .all(),
    ]);

    const files = sent
      .concat(received)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(-50)
      .map(toFileSummary);

    return {
      conversationWith: {
        id: peer.id,
        username: peer.username,
        displayName: peer.displayName,
      },
      files,
    };
  }

  async getEncryptedFile(user: PublicUser, id: string) {
    if (!id || id.length > 64) throw new NotFoundException('File not found');

    const [sent, received] = await Promise.all([
      db.orm.public.SecureFile.where((row) => row.id.eq(id))
        .where((row) => row.senderId.eq(user.id))
        .first(),
      db.orm.public.SecureFile.where((row) => row.id.eq(id))
        .where((row) => row.recipientId.eq(user.id))
        .first(),
    ]);
    const file = sent ?? received;

    if (!file) throw new NotFoundException('File not found');

    return {
      file: {
        id: file.id,
        senderId: file.senderId,
        recipientId: file.recipientId,
        version: file.version,
        ciphertext: Buffer.from(file.ciphertext).toString('base64url'),
        ciphertextBytes: file.ciphertextBytes,
        iv: file.iv,
        senderWrappedKey: file.senderWrappedKey,
        recipientWrappedKey: file.recipientWrappedKey,
        createdAt: file.createdAt,
      },
    };
  }

  private async findUserByUsername(username: string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
      throw new BadRequestException('Invalid username');
    }

    const user = await db.orm.public.User.where((row) =>
      row.username.eq(username.toLowerCase()),
    ).first();

    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
