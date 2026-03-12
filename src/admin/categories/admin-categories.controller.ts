import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../users/admin.guard';
import { JwtCookieGuard } from '../../users/jwt-cookie.guard';
import { AdminCategoriesService } from './admin-categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('admin/categories')
@UseGuards(JwtCookieGuard, AdminGuard)
export class AdminCategoriesController {
  constructor(private readonly adminCategoriesService: AdminCategoriesService) {}

  @Get('tree')
  getTree() {
    return this.adminCategoriesService.getTree();
  }

  @Get()
  listAll() {
    return this.adminCategoriesService.listAll();
  }

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.adminCategoriesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminCategoriesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.adminCategoriesService.remove(id);
  }
}
