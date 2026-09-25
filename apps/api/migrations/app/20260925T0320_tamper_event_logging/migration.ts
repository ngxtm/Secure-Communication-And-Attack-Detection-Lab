#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2c17f02d9c1a92925cf57d66c1c1da4e14310d28bff4ad4c9b0611d15e9f9996/contract';
import endContract from '../../snapshots/2c17f02d9c1a92925cf57d66c1c1da4e14310d28bff4ad4c9b0611d15e9f9996/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5b4567bcd15f114f1a908a5248624a437df851b8c489c41781425c963fbba726/contract';
import startContract from '../../snapshots/5b4567bcd15f114f1a908a5248624a437df851b8c489c41781425c963fbba726/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'securityEvent',
        columns: [
          col('actorId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('details', 'text', {
            notNull: true,
            default: lit('{}'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('eventType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurredAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('referenceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('severity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'securityEvent',
        index: 'securityEvent_actorId_idx_a58f6b4b',
        columns: ['actorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'securityEvent',
        index: 'securityEvent_actorId_occurredAt_idx_38439793',
        columns: ['actorId', 'occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'securityEvent',
        index: 'securityEvent_eventType_occurredAt_idx_d85e1cc5',
        columns: ['eventType', 'occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'securityEvent',
        index: 'securityEvent_referenceId_eventType_occurredAt_idx_ae488262',
        columns: ['referenceId', 'eventType', 'occurredAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'securityEvent',
        foreignKey: {
          name: 'securityEvent_actorId_fkey',
          columns: ['actorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
