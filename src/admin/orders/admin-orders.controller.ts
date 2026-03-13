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
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('admin/orders')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

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

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.adminOrdersService.updateStatus(id, dto);
  }
}
