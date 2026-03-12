import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ParcelTrackingModule } from '../parcels/parcel-tracking.module';
import { MailerModule } from '../mailer/mailer.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [UsersModule, ParcelTrackingModule, MailerModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
