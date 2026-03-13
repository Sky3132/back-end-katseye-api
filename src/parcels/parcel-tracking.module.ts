import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { ParcelTrackingService } from './parcel-tracking.service';

@Module({
  imports: [PrismaModule, MailerModule],
  providers: [ParcelTrackingService],
  exports: [ParcelTrackingService],
})
export class ParcelTrackingModule {}
