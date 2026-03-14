import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicOrdersController } from './public-orders.controller';
import { PublicOrdersService } from './public-orders.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicOrdersController],
  providers: [PublicOrdersService],
})
export class PublicOrdersModule {}

