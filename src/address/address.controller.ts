import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtCookieGuard } from '../users/jwt-cookie.guard';
import { UserGuard } from '../users/user.guard';
import { AuthUser } from '../users/auth-user.interface';
import { CreateAddressDto } from './dto/create-address.dto';
import { AddressService } from './address.service';

@Controller('address')
@UseGuards(JwtCookieGuard, UserGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  list(@Req() req: Request & { user?: AuthUser }) {
    return this.addressService.listForUser(this.getUserId(req));
  }

  @Post()
  create(
    @Req() req: Request & { user?: AuthUser },
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressService.createForUser(this.getUserId(req), dto);
  }

  private getUserId(req: Request & { user?: AuthUser }) {
    const id = Number(req.user?.sub);
    if (!Number.isInteger(id) || id <= 0) {
      throw new UnauthorizedException(
        'Token user id is invalid for address operations.',
      );
    }
    return id;
  }
}
