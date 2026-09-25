#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2c17f02d9c1a92925cf57d66c1c1da4e14310d28bff4ad4c9b0611d15e9f9996/contract';
import startContract from '../../snapshots/2c17f02d9c1a92925cf57d66c1c1da4e14310d28bff4ad4c9b0611d15e9f9996/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d5b9ce705b48eff7ed2ccf8b0f1001f91f51654a4dfc152593fb0d6f62930703/contract';
import endContract from '../../snapshots/d5b9ce705b48eff7ed2ccf8b0f1001f91f51654a4dfc152593fb0d6f62930703/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'secureFile',
        column: col('requestId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'secureFile',
        column: col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'secureFile',
        constraint: 'secureFile_sessionId_requestId_key',
        columns: ['sessionId', 'requestId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
