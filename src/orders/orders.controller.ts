import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtCookieGuard } from '../users/jwt-cookie.guard';
import { UserGuard } from '../users/user.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtCookieGuard, UserGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  checkout(@Req() req: Request, @Body() dto: CheckoutOrderDto) {
    return this.ordersService.checkout(this.getUserId(req), dto);
  }

  @Get()
  findMyOrders(@Req() req: Request) {
    return this.ordersService.findMyOrders(this.getUserId(req));
  }

  @Patch(':id/cancel')
  cancelOrder(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() _dto: CancelOrderDto,
  ) {
    return this.ordersService.cancelMyOrder(this.getUserId(req), id);
  }

  // Frontend fallback: only supports cancelling (no other status changes)
  @Patch(':id/status')
  updateMyOrderStatus(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
  ) {
    if (dto.status !== 'cancelled') {
      return this.ordersService.rejectNonCancelStatus();
    }
    return this.ordersService.cancelMyOrder(this.getUserId(req), id);
  }

  private getUserId(req: Request): number {
    const authUser = (req as Request & { user?: { sub?: string } }).user;
    const id = Number(authUser?.sub);

    if (!Number.isInteger(id) || id <= 0) {
      throw new UnauthorizedException(
        'Token user id is invalid for order operations.',
      );
    }

    return id;
  }
}
