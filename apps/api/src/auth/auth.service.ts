import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../prisma/db.js';
import type { LoginDto } from './login.dto.js';
import {
  isSessionToken,
  toPublicUser,
  type PublicUser,
} from './auth.types.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_BLOCK_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 5;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface LoginAttempts {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastBlockedEventAt: number;
}

export interface LoginResult {
  user: PublicUser;
  token: string;
  expiresAt: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash = '';
  private readonly attempts = new Map<string, LoginAttempts>();

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await argon2.hash(
      randomBytes(32),
      ARGON2_OPTIONS,
    );
  }

  async login(
    credentials: LoginDto,
    source: string,
  ): Promise<LoginResult> {
    const username = credentials.username.toLowerCase();
    const key = this.attemptKey(username, source);
    const now = Date.now();
    const previousAttempts = this.attempts.get(key);

    if (previousAttempts && previousAttempts.blockedUntil > now) {
      if (now - previousAttempts.lastBlockedEventAt >= 10_000) {
        previousAttempts.lastBlockedEventAt = now;
        await this.writeLoginEvent(
          username,
          null,
          'AUTH_LOGIN_BLOCKED',
          source,
        );
      }
      throw new HttpException(
        'Too many failed login attempts. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await db.orm.public.User
      .where((row) => row.username.eq(username))
      .first();
    const passwordMatches = user
      ? await this.verifyPassword(credentials.password, user.passwordHash)
      : await this.verifyPassword(
          credentials.password,
          this.dummyPasswordHash,
        );

    if (!user || !passwordMatches) {
      const attemptState = this.recordFailedAttempt(key, now);
      await this.writeLoginEvent(
        username,
        user?.id ?? null,
        'AUTH_LOGIN_FAILED',
        source,
      );

      if (
        attemptState.count === MAX_FAILED_ATTEMPTS &&
        attemptState.blockedUntil > now
      ) {
        await this.writeLoginEvent(
          username,
          user?.id ?? null,
          'AUTH_BRUTE_FORCE_DETECTED',
          source,
        );
      }

      throw new UnauthorizedException('Invalid username or password');
    }

    this.attempts.delete(key);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    await db.transaction(async (transaction) => {
      await transaction.orm.public.AuthSession.create({
        tokenHash,
        userId: user.id,
        expiresAt,
      });
      await transaction.orm.public.LoginEvent.create({
        username,
        userId: user.id,
        eventType: 'AUTH_LOGIN_SUCCESS',
        source,
      });
    });

    return {
      user: toPublicUser(user),
      token,
      expiresAt,
    };
  }

  async logout(token: string | undefined, source: string): Promise<void> {
    if (!token || !isSessionToken(token)) return;

    const tokenHash = hashToken(token);
    const session = await db.orm.public.AuthSession
      .where((row) => row.tokenHash.eq(tokenHash))
      .first();

    if (!session || session.revokedAt !== null) return;

    const revokedAt = new Date().toISOString();
    const user = await db.orm.public.User
      .where((row) => row.id.eq(session.userId))
      .first();

    await db.transaction(async (transaction) => {
      await transaction.orm.public.AuthSession
        .where((row) => row.id.eq(session.id))
        .update({ revokedAt });
      if (user) {
        await transaction.orm.public.LoginEvent.create({
          username: user.username,
          userId: user.id,
          eventType: 'AUTH_LOGOUT',
          source,
        });
      }
    });
  }

  private async verifyPassword(password: string, passwordHash: string) {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  private recordFailedAttempt(
    key: string,
    now: number,
  ): LoginAttempts {
    let state = this.attempts.get(key);
    if (!state || now - state.windowStartedAt > LOGIN_WINDOW_MS) {
      state = {
        count: 0,
        windowStartedAt: now,
        blockedUntil: 0,
        lastBlockedEventAt: 0,
      };
    }

    state.count += 1;
    if (state.count >= MAX_FAILED_ATTEMPTS) {
      state.blockedUntil = now + LOGIN_BLOCK_MS;
      state.lastBlockedEventAt = now;
    }

    this.attempts.set(key, state);
    this.pruneAttemptMap(now);
    return state;
  }

  private pruneAttemptMap(now: number): void {
    for (const [key, value] of this.attempts) {
      const stale =
        value.blockedUntil <= now &&
        now - value.windowStartedAt > LOGIN_WINDOW_MS * 2;
      if (stale) this.attempts.delete(key);
    }

    while (this.attempts.size > 5_000) {
      const oldestKey = this.attempts.keys().next().value;
      if (oldestKey === undefined) break;
      this.attempts.delete(oldestKey);
    }
  }

  private attemptKey(username: string, source: string): string {
    return `${source.slice(0, 128)}:${username}`;
  }

  private async writeLoginEvent(
    username: string,
    userId: string | null,
    eventType: string,
    source: string,
  ): Promise<void> {
    await db.orm.public.LoginEvent.create({
      username,
      userId,
      eventType,
      source: source.slice(0, 128),
    });
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
