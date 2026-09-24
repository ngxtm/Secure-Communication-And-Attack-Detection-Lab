#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8361100d7a8eaec6c582bbe2e9d362f5478a6285fc3088eef68f037bd20a185a/contract';
import endContract from '../../snapshots/8361100d7a8eaec6c582bbe2e9d362f5478a6285fc3088eef68f037bd20a185a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e60b140d510ca22825ccfe3637fb34731bb2764a205e94385970c0f6dea7387a/contract';
import startContract from '../../snapshots/e60b140d510ca22825ccfe3637fb34731bb2764a205e94385970c0f6dea7387a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'authSession',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('tokenHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'loginEvent',
        columns: [
          col('eventType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurredAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('username', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'authSession',
        constraint: 'authSession_tokenHash_key',
        columns: ['tokenHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'authSession',
        index: 'authSession_userId_expiresAt_idx_9721b56d',
        columns: ['userId', 'expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'authSession',
        index: 'authSession_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'loginEvent',
        index: 'loginEvent_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'loginEvent',
        index: 'loginEvent_userId_occurredAt_idx_9003f3bb',
        columns: ['userId', 'occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'loginEvent',
        index: 'loginEvent_username_eventType_occurredAt_idx_f3231c61',
        columns: ['username', 'eventType', 'occurredAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'authSession',
        foreignKey: {
          name: 'authSession_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'loginEvent',
        foreignKey: {
          name: 'loginEvent_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
