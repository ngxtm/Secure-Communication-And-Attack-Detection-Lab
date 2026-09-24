import {
  CanActivate,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { db } from '../prisma/db.js';
import {
  isSessionToken,
  readCookie,
  type AuthenticatedRequest,
  toPublicUser,
} from './auth.types.js';

export const SESSION_COOKIE_NAME = 'nsl_session';

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const token = readCookie(request, SESSION_COOKIE_NAME);

    if (!token || !isSessionToken(token)) {
      throw new UnauthorizedException('Authentication required');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await db.orm.public.AuthSession
      .where((row) => row.tokenHash.eq(tokenHash))
      .first();

    if (
      !session ||
      session.revokedAt !== null ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await db.orm.public.User
      .where((row) => row.id.eq(session.userId))
      .first();

    if (!user) throw new UnauthorizedException('Authentication required');

    request.authUser = toPublicUser(user);
    return true;
  }
}

