import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminProductsService } from './products/admin-products.service';

@Module({
  imports: [UsersModule],
  controllers: [AdminDashboardController, AdminProductsController],
  providers: [AdminDashboardService, AdminProductsService],
})
export class AdminModule {}
