import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { assertBrowserRequest } from './browser-request.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './login.dto.js';
import { SESSION_COOKIE_NAME, SessionGuard } from './session.guard.js';
import {
  readCookie,
  type AuthenticatedRequest,
} from './auth.types.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Authenticate a seeded demo user' })
  @ApiBody({ type: LoginDto })
  @ApiHeader({
    name: 'X-CSRF-Protection',
    required: true,
    description: 'Set to 1 for browser-origin protection.',
  })
  @ApiOkResponse({
    description: 'A session cookie was set.',
    schema: {
      example: {
        user: {
          id: 'cm0000000000000000000000',
          username: 'alice',
          displayName: 'Alice',
          role: 'user',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid username or password.' })
  @ApiTooManyRequestsResponse({ description: 'Login attempts are temporarily limited.' })
  @ApiForbiddenResponse({ description: 'Origin or CSRF header was rejected.' })
  async login(
    @Body() credentials: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertBrowserRequest(request);
    response.setHeader('Cache-Control', 'no-store');

    const result = await this.authService.login(
      credentials,
      this.getSource(request),
    );
    response.cookie(SESSION_COOKIE_NAME, result.token, this.cookieOptions());

    return { user: result.user };
  }

  @Get('session')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Return the current authenticated user' })
  @ApiOkResponse({
    schema: {
      example: {
        user: {
          id: 'cm0000000000000000000000',
          username: 'alice',
          displayName: 'Alice',
          role: 'user',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No valid session cookie.' })
  async session(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { user: request.authUser };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiHeader({
    name: 'X-CSRF-Protection',
    required: true,
    description: 'Set to 1 for browser-origin protection.',
  })
  @ApiOkResponse({ schema: { example: { success: true } } })
  @ApiForbiddenResponse({ description: 'Origin or CSRF header was rejected.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertBrowserRequest(request);
    response.setHeader('Cache-Control', 'no-store');

    await this.authService.logout(
      readCookie(request, SESSION_COOKIE_NAME),
      this.getSource(request),
    );
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions(false));
    return { success: true };
  }

  private cookieOptions(includeMaxAge = true) {
    return {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      sameSite: 'strict' as const,
      path: '/',
      ...(includeMaxAge ? { maxAge: SESSION_TTL_MS } : {}),
    };
  }

  private getSource(request: Request): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown';
  }
}
