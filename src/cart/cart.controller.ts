import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtCookieGuard } from '../users/jwt-cookie.guard';
import { UserGuard } from '../users/user.guard';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
@UseGuards(JwtCookieGuard, UserGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('items')
  addItem(@Req() req: Request, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(this.getUserId(req), dto);
  }

  @Get('items')
  getItems(@Req() req: Request) {
    return this.cartService.getItems(this.getUserId(req));
  }

  @Put('items/:id')
  updateItem(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(this.getUserId(req), id, dto);
  }

  @Delete('items/:id')
  removeItem(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    return this.cartService.removeItem(this.getUserId(req), id);
  }

  @Delete('items')
  clear(@Req() req: Request) {
    return this.cartService.clear(this.getUserId(req));
  }

  private getUserId(req: Request): number {
    const authUser = (req as Request & { user?: { sub?: string } }).user;
    const id = Number(authUser?.sub);

    if (!Number.isInteger(id) || id <= 0) {
      throw new UnauthorizedException(
        'Token user id is invalid for cart operations.',
      );
    }

    return id;
  }
}
