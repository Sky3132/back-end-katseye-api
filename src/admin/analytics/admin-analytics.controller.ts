import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../users/admin.guard';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import type { MostSoldResponse } from './admin-analytics.types';

@Controller()
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminAnalyticsController {
  constructor(private readonly adminAnalyticsService: AdminAnalyticsService) {}

  @Get(['mostSold', 'admin/mostSold'])
  getMostSold(
    @Query('take') take?: string,
    @Query('statuses') statuses?: string,
  ): Promise<MostSoldResponse> {
    const parsedTake = Number(take);
    const takeNumber =
      take !== undefined && Number.isFinite(parsedTake) ? parsedTake : undefined;

    const statusesList = statuses ? [statuses] : undefined;
    return this.adminAnalyticsService.getMostSoldProducts({
      take: takeNumber,
      statuses: statusesList,
    });
  }
}
