import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtCookieGuard } from '../users/jwt-cookie.guard';
import { UserGuard } from '../users/user.guard';
import { AuthUser } from '../users/auth-user.interface';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressService } from './address.service';
import { PlainTextHttpExceptionFilter } from '../common/plain-text-http-exception.filter';

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

  @Put(':id')
  @UseFilters(PlainTextHttpExceptionFilter)
  updatePut(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.updateForUser(this.getUserId(req), id, dto);
  }

  @Patch(':id')
  @UseFilters(PlainTextHttpExceptionFilter)
  updatePatch(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.updateForUser(this.getUserId(req), id, dto);
  }

  // Frontend convenience: allow "Save" button to POST to the same update endpoint.
  @Post(':id')
  @UseFilters(PlainTextHttpExceptionFilter)
  updatePost(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.updateForUser(this.getUserId(req), id, dto);
  }

  @Delete(':id')
  @UseFilters(PlainTextHttpExceptionFilter)
  remove(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.addressService.deleteForUser(this.getUserId(req), id);
  }

  @Patch(':id/default')
  @UseFilters(PlainTextHttpExceptionFilter)
  setDefault(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.addressService.setDefaultForUser(this.getUserId(req), id);
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
