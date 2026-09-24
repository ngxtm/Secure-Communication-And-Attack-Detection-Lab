import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { db } from './prisma/db.js';

@Injectable()
export class AppService implements OnApplicationShutdown {
  async checkHealth(): Promise<{ status: string; database: string }> {
    await db.orm.public.User.limit(1).all();
    return { status: 'ok', database: 'connected' };
  }

  async onApplicationShutdown(): Promise<void> {
    await db.close();
  }
}
