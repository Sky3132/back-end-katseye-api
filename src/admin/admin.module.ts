import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AdminCategoriesController } from './categories/admin-categories.controller';
import { AdminCategoriesService } from './categories/admin-categories.service';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminProductsService } from './products/admin-products.service';
import { AdminReportsController } from './reports/admin-reports.controller';
import { AdminReportsService } from './reports/admin-reports.service';
import { ParcelTrackingModule } from '../parcels/parcel-tracking.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [UsersModule, ParcelTrackingModule, MailerModule],
  controllers: [
    AdminAnalyticsController,
    AdminCategoriesController,
    AdminDashboardController,
    AdminProductsController,
    AdminOrdersController,
    AdminReportsController,
  ],
  providers: [
    AdminAnalyticsService,
    AdminCategoriesService,
    AdminDashboardService,
    AdminProductsService,
    AdminOrdersService,
    AdminReportsService,
  ],
})
export class AdminModule {}
