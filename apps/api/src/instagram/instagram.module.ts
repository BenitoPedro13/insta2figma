import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InstagramController } from './instagram.controller';
import { InstagramPreviewService } from './instagram-preview.service';

@Module({
  imports: [AuthModule],
  controllers: [InstagramController],
  providers: [InstagramPreviewService],
})
export class InstagramModule {}
