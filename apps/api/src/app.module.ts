import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { FilesModule } from './files/files.module.js';

@Module({
  imports: [AuthModule, MessagesModule, FilesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
