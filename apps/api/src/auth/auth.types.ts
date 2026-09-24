import type { Request } from 'express';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: PublicUser;
}

export function toPublicUser(user: {
  id: string;
  username: string;
  displayName: string;
  role: string;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function readCookie(
  request: Request,
  cookieName: string,
): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== cookieName) continue;
    return item.slice(separator + 1).trim();
  }

  return undefined;
}
