import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../users/admin.guard';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminOrdersService } from './admin-orders.service';
import { OrderTrackerQueryDto } from './dto/order-tracker-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('admin/orders')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get('tracker/summary')
  trackerSummary() {
    return this.adminOrdersService.getTrackerSummary();
  }

  @Get('tracker')
  listTracker(@Query() query: OrderTrackerQueryDto) {
    return this.adminOrdersService.listTracker(query);
  }

  @Get()
  listAll(@Query('take') take?: string) {
    const parsed = Number(take);
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return this.adminOrdersService.listAll(count);
  }

  @Get('recent')
  listRecent(@Query('take') take?: string) {
    const parsed = Number(take);
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return this.adminOrdersService.listRecent(count);
  }

  @Get(':id')
  getDetails(@Param('id', ParseIntPipe) id: number) {
    return this.adminOrdersService.getDetails(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.adminOrdersService.updateStatus(id, dto);
  }
}
