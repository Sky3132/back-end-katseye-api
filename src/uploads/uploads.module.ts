import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [UsersModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
