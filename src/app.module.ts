import { Module } from '@nestjs/common';
import { AddressModule } from './address/address.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { CartModule } from './cart/cart.module';
import { CategoriesModule } from './categories/categories.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { UploadsModule } from './uploads/uploads.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { PublicParcelsModule } from './public-parcels/public-parcels.module';
import { ParcelTrackingModule } from './parcels/parcel-tracking.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    ProductsModule,
    CartModule,
    CategoriesModule,
    AddressModule,
    OrdersModule,
    NotificationsModule,
    UploadsModule,
    AdminModule,
    PublicParcelsModule,
    ParcelTrackingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
