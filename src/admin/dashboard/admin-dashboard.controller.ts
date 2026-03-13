import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../users/admin.guard';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get('kpis')
  getKpis() {
    return this.adminDashboardService.getKpis();
  }

  @Get('summary')
  getSummary() {
    return this.adminDashboardService.getSummary();
  }

  @Get('stocks')
  getCurrentStocks(@Query('lowThreshold') lowThreshold?: string) {
    const parsed = Number(lowThreshold);
    const threshold =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    return this.adminDashboardService.getCurrentStocks(threshold);
  }
}
