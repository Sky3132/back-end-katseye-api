import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicParcelsController } from './public-parcels.controller';
import { PublicParcelsService } from './public-parcels.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicParcelsController],
  providers: [PublicParcelsService],
})
export class PublicParcelsModule {}
