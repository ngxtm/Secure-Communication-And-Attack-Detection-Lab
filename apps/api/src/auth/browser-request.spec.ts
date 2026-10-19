import type { Request } from 'express';
import { assertBrowserRequest } from './browser-request.js';

describe('browser mutation protection', () => {
  beforeEach(() => vi.stubEnv('WEB_ORIGINS', 'http://localhost:3000'));
  afterEach(() => vi.unstubAllEnvs());

  function request(origin?: string, csrf?: string): Request {
    const headers: Record<string, string | undefined> = {
      origin,
      'x-csrf-protection': csrf,
    };
    return { get: (name: string) => headers[name] } as Request;
  }

  it('accepts only the exact configured origin with the CSRF header', () => {
    expect(() =>
      assertBrowserRequest(request('http://localhost:3000', '1')),
    ).not.toThrow();
  });

  it.each([
    [undefined, '1'],
    ['http://localhost:3000', undefined],
    ['http://localhost:3000.attacker.invalid', '1'],
    ['https://localhost:3000', '1'],
  ])('rejects invalid origin/header combination %s, %s', (origin, csrf) => {
    expect(() => assertBrowserRequest(request(origin, csrf))).toThrow(
      'CSRF check failed',
    );
  });
});
