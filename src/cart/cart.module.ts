import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [UsersModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
