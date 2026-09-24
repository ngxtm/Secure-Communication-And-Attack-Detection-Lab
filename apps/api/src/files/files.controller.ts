import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { assertBrowserRequest } from '../auth/browser-request.js';
import { SessionGuard } from '../auth/session.guard.js';
import { MAX_CIPHERTEXT_FILE_BYTES } from './file-limits.js';
import { UploadFileDto } from './files.dto.js';
import { FilesService } from './files.service.js';
import type { EncryptedFileUpload } from './files.types.js';

@ApiTags('encrypted files')
@Controller('files')
@UseGuards(SessionGuard)
@ApiUnauthorizedResponse({ description: 'A valid session is required.' })
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('ciphertext', {
      limits: {
        fileSize: MAX_CIPHERTEXT_FILE_BYTES,
        files: 1,
        fields: 4,
        parts: 5,
        fieldSize: 1024,
      },
    }),
  )
  @ApiOperation({ summary: 'Store an encrypted file envelope for a recipient' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'recipientUsername',
        'iv',
        'senderWrappedKey',
        'recipientWrappedKey',
        'ciphertext',
      ],
      properties: {
        recipientUsername: { type: 'string' },
        iv: { type: 'string', minLength: 16, maxLength: 16 },
        senderWrappedKey: { type: 'string', minLength: 342, maxLength: 342 },
        recipientWrappedKey: {
          type: 'string',
          minLength: 342,
          maxLength: 342,
        },
        ciphertext: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Stores AES-GCM ciphertext and RSA-wrapped keys for both participants.',
  })
  @ApiForbiddenResponse({ description: 'Origin or CSRF header was rejected.' })
  async upload(
    @Body() input: UploadFileDto,
    @UploadedFile() file: EncryptedFileUpload | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    assertBrowserRequest(request);
    if (!file)
      throw new BadRequestException('An encrypted file payload is required');
    return this.filesService.upload(request.authUser!, input, file);
  }

  @Get('conversation/:username')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List encrypted files for a conversation' })
  @ApiOkResponse({
    description: 'Returns up to 50 recent file envelopes without ciphertext.',
  })
  getConversation(
    @Param('username') username: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.filesService.getConversation(request.authUser!, username);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get a participant-authorized encrypted file envelope',
  })
  @ApiOkResponse({
    description:
      'Returns ciphertext and wrapped keys for browser-side decryption.',
  })
  getEncryptedFile(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.filesService.getEncryptedFile(request.authUser!, id);
  }
}
