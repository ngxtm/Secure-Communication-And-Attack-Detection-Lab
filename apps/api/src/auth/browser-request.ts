import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

export function assertBrowserRequest(request: Request): void {
  const origin = request.get('origin');
  const csrfHeader = request.get('x-csrf-protection');
  const allowedOrigins = (
    process.env.WEB_ORIGINS ??
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin || !allowedOrigins.includes(origin) || csrfHeader !== '1') {
    throw new ForbiddenException('Request origin or CSRF check failed');
  }
}
