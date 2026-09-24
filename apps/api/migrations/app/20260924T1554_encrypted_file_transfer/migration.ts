#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5b4567bcd15f114f1a908a5248624a437df851b8c489c41781425c963fbba726/contract';
import endContract from '../../snapshots/5b4567bcd15f114f1a908a5248624a437df851b8c489c41781425c963fbba726/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7add09319d434993821f5c0a5b92f972d2d9257d8852a302943a730d9a47373f/contract';
import startContract from '../../snapshots/7add09319d434993821f5c0a5b92f972d2d9257d8852a302943a730d9a47373f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'secureFile',
        columns: [
          col('ciphertext', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('ciphertextBytes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('iv', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipientId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipientWrappedKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('senderId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('senderWrappedKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'secureFile',
        index: 'secureFile_recipientId_idx_c9527cf8',
        columns: ['recipientId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'secureFile',
        index: 'secureFile_recipientId_senderId_createdAt_idx_fd885bcc',
        columns: ['recipientId', 'senderId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'secureFile',
        index: 'secureFile_senderId_idx_4689c490',
        columns: ['senderId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'secureFile',
        index: 'secureFile_senderId_recipientId_createdAt_idx_6cf1f7d2',
        columns: ['senderId', 'recipientId', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'secureFile',
        foreignKey: {
          name: 'secureFile_senderId_fkey',
          columns: ['senderId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'secureFile',
        foreignKey: {
          name: 'secureFile_recipientId_fkey',
          columns: ['recipientId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
