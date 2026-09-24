import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { assertBrowserRequest } from '../auth/browser-request.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PublishIdentityDto, SendMessageDto } from './messages.dto.js';
import { MessagesService } from './messages.service.js';

@ApiTags('secure messaging')
@Controller('messages')
@UseGuards(SessionGuard)
@ApiUnauthorizedResponse({ description: 'A valid session is required.' })
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('identity')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get the current user encryption identity' })
  @ApiOkResponse({
    schema: {
      example: {
        identity: {
          userId: 'cm0000000000000000000000',
          username: 'alice',
          displayName: 'Alice',
          publicKey: 'base64url-encoded-spki',
          fingerprint: 'SHA-256 public-key fingerprint',
        },
      },
    },
  })
  getOwnIdentity(@Req() request: AuthenticatedRequest) {
    return this.messagesService.getOwnIdentity(request.authUser!);
  }

  @Get('identity/:username')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get another user public encryption identity' })
  @ApiOkResponse({ description: 'Returns null when no key has been published.' })
  getIdentityForUsername(
    @Param('username') username: string,
  ) {
    return this.messagesService.getIdentityForUsername(username);
  }

  @Put('identity')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Publish or explicitly rotate the current public key' })
  @ApiHeader({
    name: 'X-CSRF-Protection',
    required: true,
    description: 'Set to 1 for browser-origin protection.',
  })
  @ApiBody({ type: PublishIdentityDto })
  @ApiOkResponse({ description: 'The public key and its server-computed fingerprint.' })
  @ApiForbiddenResponse({ description: 'Origin or CSRF header was rejected.' })
  async publishIdentity(
    @Body() input: PublishIdentityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    assertBrowserRequest(request);
    return this.messagesService.publishIdentity(request.authUser!, input);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Store an encrypted message for a recipient' })
  @ApiHeader({
    name: 'X-CSRF-Protection',
    required: true,
    description: 'Set to 1 for browser-origin protection.',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiCreatedResponse({
    description: 'The API stores ciphertext, IV, and RSA-wrapped AES keys for both participants.',
  })
  @ApiForbiddenResponse({ description: 'Origin or CSRF header was rejected.' })
  async sendMessage(
    @Body() input: SendMessageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    assertBrowserRequest(request);
    return this.messagesService.sendMessage(request.authUser!, input);
  }

  @Get('conversation/:username')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read ciphertext for a conversation with a user' })
  @ApiOkResponse({ description: 'Returns up to 100 recent encrypted messages.' })
  getConversation(
    @Param('username') username: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.messagesService.getConversation(request.authUser!, username);
  }
}
