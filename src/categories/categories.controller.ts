import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  listAll() {
    return this.categoriesService.listAll();
  }

  @Get('tree')
  getTree() {
    return this.categoriesService.getTree();
  }

  @Get(':id/subcategories')
  listSubcategories(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.listSubcategories(id);
  }
}
