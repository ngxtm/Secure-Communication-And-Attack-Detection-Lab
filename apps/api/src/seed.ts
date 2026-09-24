import 'dotenv/config';
import argon2 from 'argon2';
import { db } from './prisma/db.js';
import { loadDemoUsers, type DemoUserSeed } from './seed-config.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function seedDemoUser(user: DemoUserSeed): Promise<void> {

  const existing = await db.orm.public.User
    .where((row) => row.username.eq(user.username))
    .first();

  if (!existing) {
    const passwordHash = await argon2.hash(user.password, ARGON2_OPTIONS);
    await db.orm.public.User.create({
      username: user.username,
      displayName: user.displayName,
      passwordHash,
      role: 'user',
    });
    return;
  }

  let passwordMatches = false;
  try {
    passwordMatches = await argon2.verify(
      existing.passwordHash,
      user.password,
    );
  } catch {
    passwordMatches = false;
  }

  if (passwordMatches) return;

  const passwordHash = await argon2.hash(user.password, ARGON2_OPTIONS);
  const revokedAt = new Date().toISOString();

  await db.transaction(async (transaction) => {
    await transaction.orm.public.User
      .where((row) => row.id.eq(existing.id))
      .update({
        passwordHash,
        displayName: user.displayName,
        role: 'user',
      });

    const sessions = await transaction.orm.public.AuthSession
      .where((row) => row.userId.eq(existing.id))
      .all();
    for (const session of sessions) {
      if (session.revokedAt === null) {
        await transaction.orm.public.AuthSession
          .where((row) => row.id.eq(session.id))
          .update({ revokedAt });
      }
    }
  });
}

try {
  const demoUsers = loadDemoUsers();
  for (const user of demoUsers) {
    await seedDemoUser(user);
  }
  console.info('Demo accounts are ready: alice, bob.');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('SEED_') || message.startsWith('Set a real SEED_')) {
    console.error(`Database seed failed: ${message}`);
  } else {
    console.error(
      'Database seed failed. Check database connectivity and demo account configuration; details are hidden to protect secrets.',
    );
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
