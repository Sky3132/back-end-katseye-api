import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../../users/admin.guard';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminReportsService } from './admin-reports.service';

@Controller('admin/reports')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Get('sales')
  getSalesReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('statuses') statuses?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const parsedTake = take === undefined ? undefined : Number(take);
    const parsedSkip = skip === undefined ? undefined : Number(skip);
    return this.adminReportsService.getSalesReport({
      from,
      to,
      statuses,
      take: take === undefined ? undefined : parsedTake,
      skip: skip === undefined ? undefined : parsedSkip,
    });
  }

  @Get('sales.csv')
  async downloadSalesCsv(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('statuses') statuses?: string,
  ) {
    const csv = await this.adminReportsService.getSalesReportCsv({
      from,
      to,
      statuses,
    });

    const suffixFrom = from?.trim() ? from.trim() : 'last30days';
    const suffixTo = to?.trim() ? to.trim() : 'today';
    const filename = `sales-report_${suffixFrom}_to_${suffixTo}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}

