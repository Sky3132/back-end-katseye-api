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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../../users/admin.guard';
import { AuthUser } from '../../users/auth-user.interface';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminProductsService } from './admin-products.service';
import { CreateAdminProductDto } from './dto/create-admin-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateAdminProductDto } from './dto/update-admin-product.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

@Controller('admin/products')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminProductsController {
  constructor(private readonly adminProductsService: AdminProductsService) {}

  @Post()
  create(
    @Req() req: Request & { user?: AuthUser },
    @Body() dto: CreateAdminProductDto,
  ) {
    return this.adminProductsService.create(this.getAdminId(req), dto);
  }

  @Get()
  findAll() {
    return this.adminProductsService.findAll();
  }

  @Get('archived')
  findArchived() {
    return this.adminProductsService.findArchived();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.adminProductsService.findOne(id);
  }

  @Put(':id')
  update(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminProductDto,
  ) {
    return this.adminProductsService.update(this.getAdminId(req), id, dto);
  }

  @Patch(':id/stock')
  updateStock(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockDto,
  ) {
    return this.adminProductsService.updateStock(
      this.getAdminId(req),
      id,
      dto.stock,
    );
  }

  @Delete(':id')
  archive(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminProductsService.archive(this.getAdminId(req), id);
  }

  @Patch(':id/resell')
  resell(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminProductsService.resell(this.getAdminId(req), id);
  }

  @Delete(':id/hard')
  hardDelete(@Param('id', ParseIntPipe) id: number) {
    return this.adminProductsService.hardDelete(id);
  }

  @Post(':id/variants')
  addVariant(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.adminProductsService.addVariant(this.getAdminId(req), id, dto);
  }

  @Put(':id/variants/:variantId')
  updateVariant(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return this.adminProductsService.updateVariant(
      this.getAdminId(req),
      id,
      variantId,
      dto,
    );
  }

  @Patch(':id/variants/:variantId/stock')
  updateVariantStock(
    @Req() req: Request & { user?: AuthUser },
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateStockDto,
  ) {
    return this.adminProductsService.updateVariantStock(
      this.getAdminId(req),
      id,
      variantId,
      dto.stock,
    );
  }

  @Delete(':id/variants/:variantId')
  removeVariant(
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    return this.adminProductsService.removeVariant(id, variantId);
  }

  private getAdminId(req: Request & { user?: AuthUser }) {
    return Number(req.user?.sub);
  }
}
