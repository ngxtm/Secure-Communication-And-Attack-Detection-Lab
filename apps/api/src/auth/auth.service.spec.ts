import { HttpException } from '@nestjs/common';
import argon2 from 'argon2';
import { AuthService, hashToken } from './auth.service.js';

const queries = vi.hoisted(() => ({
  findUser: vi.fn(),
  createSession: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock('../prisma/db.js', () => {
  const orm = {
    public: {
      User: { where: () => ({ first: queries.findUser }) },
      AuthSession: { create: queries.createSession },
      LoginEvent: { create: queries.createEvent },
    },
  };
  return {
    db: {
      orm,
      transaction: (
        callback: (transaction: { orm: typeof orm }) => Promise<void>,
      ) => callback({ orm }),
    },
  };
});

describe('AuthService login protection', () => {
  const password = 'test-only-password-with-enough-length';
  const source = '127.0.0.1';
  let service: AuthService;
  let passwordHash: string;
  let now: number;

  beforeAll(async () => {
    passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    now = Date.parse('2026-10-19T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    queries.findUser.mockResolvedValue({
      id: 'alice-id',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
      passwordHash,
    });
    service = new AuthService();
    await service.onModuleInit();
  });

  afterEach(() => vi.restoreAllMocks());

  async function fail(username = 'alice', from = source) {
    await expect(
      service.login({ username, password: 'incorrect-password' }, from),
    ).rejects.toMatchObject({ status: 401 });
  }

  it('returns only public user fields and stores a hash of the session token', async () => {
    const result = await service.login({ username: 'ALICE', password }, source);
    expect(result.user).toEqual({
      id: 'alice-id',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
    });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(queries.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: hashToken(result.token) }),
    );
    expect(JSON.stringify(queries.createSession.mock.calls)).not.toContain(
      result.token,
    );
    expect(JSON.stringify(queries.createEvent.mock.calls)).not.toContain(
      password,
    );
  });

  it('blocks subsequent attempts after five failures and allows login after cooldown', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await fail();
    expect(queries.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'AUTH_BRUTE_FORCE_DETECTED' }),
    );
    await expect(
      service.login({ username: 'alice', password }, source),
    ).rejects.toMatchObject({ status: 429 });
    now += 60_001;
    await expect(
      service.login({ username: 'alice', password }, source),
    ).resolves.toHaveProperty('token');
  });

  it('keeps the cooldown scoped to the username and source', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await fail();
    await expect(
      service.login({ username: 'alice', password }, '127.0.0.2'),
    ).resolves.toHaveProperty('token');
    await fail('bob');
  });

  it('clears the failure counter after a successful login', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await fail();
    await service.login({ username: 'alice', password }, source);
    for (let attempt = 0; attempt < 4; attempt += 1) await fail();
    await expect(
      service.login({ username: 'alice', password }, source),
    ).resolves.toHaveProperty('token');
  });

  it('expires failures outside the one-minute observation window', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await fail();
    now += 60_001;
    await fail();
    await expect(
      service.login({ username: 'alice', password }, source),
    ).resolves.toHaveProperty('token');
  });

  it('returns the same authentication error for an unknown username', async () => {
    queries.findUser.mockResolvedValue(null);
    try {
      await service.login({ username: 'unknown', password }, source);
      expect.fail('An unknown account must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as Error).message).toBe('Invalid username or password');
    }
    expect(queries.createSession).not.toHaveBeenCalled();
  });
});
