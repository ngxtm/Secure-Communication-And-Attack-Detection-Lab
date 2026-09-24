import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and PostgreSQL readiness' })
  @ApiOkResponse({
    description: 'The API can query PostgreSQL.',
    schema: {
      example: { status: 'ok', database: 'connected' },
    },
  })
  check(): Promise<{ status: string; database: string }> {
    return this.appService.checkHealth();
  }
}
