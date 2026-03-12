import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PublicParcelsService } from './public-parcels.service';

@Controller('public/parcels')
export class PublicParcelsController {
  constructor(private readonly publicParcels: PublicParcelsService) {}

  @Get('track/:token')
  async track(@Param('token') token: string) {
    const payload = await this.publicParcels.trackByToken(token);
    if (!payload) {
      throw new NotFoundException('Tracking token not found.');
    }
    return payload;
  }
}

