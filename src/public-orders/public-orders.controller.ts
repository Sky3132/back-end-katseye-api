import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PublicOrdersService } from './public-orders.service';

@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly publicOrders: PublicOrdersService) {}

  @Get('track/:token')
  async track(@Param('token') token: string) {
    const payload = await this.publicOrders.trackByToken(token);
    if (!payload) {
      throw new NotFoundException('Tracking token not found.');
    }
    return payload;
  }
}

