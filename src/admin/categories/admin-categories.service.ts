import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll() {
    try {
      const categories = await this.prisma.category.findMany({
        orderBy: { category_id: 'desc' },
      });

      return categories.map((c) => ({
        id: c.category_id,
        category_name: c.category_name,
        parent_category_id: c.parent_category_id ?? null,
      }));
    } catch (err) {
      this.throwIfMissingParentCategoryColumn(err);
      throw err;
    }
  }

  async getTree() {
    try {
      const parents = await this.prisma.category.findMany({
        where: {
          parent_category_id: null,
        },
        include: {
          children: {
            orderBy: { category_name: 'asc' },
          },
        },
        orderBy: { category_name: 'asc' },
      });

      return parents.map((c) => ({
        id: c.category_id,
        category_name: c.category_name,
        children: c.children.map((child) => ({
          id: child.category_id,
          category_name: child.category_name,
          children: [],
        })),
      }));
    } catch (err) {
      this.throwIfMissingParentCategoryColumn(err);
      throw err;
    }
  }

  async listSubcategories(parentCategoryId: number) {
    const parent = await this.ensureCategory(parentCategoryId);
    if (parent.category_name.trim().toLowerCase() === 'album') {
      return [];
    }

    try {
      const categories = await this.prisma.category.findMany({
        where: { parent_category_id: parentCategoryId },
        orderBy: { category_name: 'asc' },
      });

      return categories.map((c) => ({
        id: c.category_id,
        category_name: c.category_name,
        parent_category_id: c.parent_category_id ?? null,
      }));
    } catch (err) {
      this.throwIfMissingParentCategoryColumn(err);
      throw err;
    }
  }

  async create(dto: CreateCategoryDto) {
    const name = dto.category_name.trim();
    if (!name) {
      throw new BadRequestException('category_name is required.');
    }

    if (dto.parent_category_id != null) {
      const parent = await this.ensureCategory(dto.parent_category_id);
      if (parent.category_name.trim().toLowerCase() === 'album') {
        throw new BadRequestException('Album cannot have subcategories.');
      }
    }

    let created;
    try {
      created = await this.prisma.category.create({
        data: {
          category_name: name,
          parent_category_id: dto.parent_category_id ?? null,
        },
      });
    } catch (err) {
      this.throwIfMissingParentCategoryColumn(err);
      throw err;
    }

    return {
      id: created.category_id,
      category_name: created.category_name,
      parent_category_id: created.parent_category_id ?? null,
    };
  }

  async update(categoryId: number, dto: UpdateCategoryDto) {
    await this.ensureCategory(categoryId);

    const nextName =
      dto.category_name === undefined ? undefined : dto.category_name.trim();
    if (nextName !== undefined && !nextName) {
      throw new BadRequestException('category_name cannot be empty.');
    }

    if (dto.parent_category_id != null) {
      if (dto.parent_category_id === categoryId) {
        throw new BadRequestException('parent_category_id cannot be itself.');
      }
      const parent = await this.ensureCategory(dto.parent_category_id);
      if (parent.category_name.trim().toLowerCase() === 'album') {
        throw new BadRequestException('Album cannot have subcategories.');
      }
    }

    let updated;
    try {
      updated = await this.prisma.category.update({
        where: { category_id: categoryId },
        data: {
          category_name: nextName,
          parent_category_id:
            dto.parent_category_id === undefined
              ? undefined
              : dto.parent_category_id,
        },
      });
    } catch (err) {
      this.throwIfMissingParentCategoryColumn(err);
      throw err;
    }

    return {
      id: updated.category_id,
      category_name: updated.category_name,
      parent_category_id: updated.parent_category_id ?? null,
    };
  }

  async remove(categoryId: number) {
    await this.ensureCategory(categoryId);

    const [childCount, productCount] = await Promise.all([
      this.prisma.category.count({
        where: { parent_category_id: categoryId },
      }),
      this.prisma.product.count({
        where: { category_id: categoryId },
      }),
    ]);

    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete category because it has child categories.',
      );
    }

    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete category because it is used by products.',
      );
    }

    await this.prisma.category.delete({
      where: { category_id: categoryId },
    });

    return { message: 'Category deleted successfully.' };
  }

  private async ensureCategory(categoryId: number) {
    const existing = await this.prisma.category.findUnique({
      where: { category_id: categoryId },
    });
    if (!existing) {
      throw new NotFoundException('Category not found.');
    }
    return existing;
  }

  private throwIfMissingParentCategoryColumn(err: unknown): never | void {
    const e = err as { code?: string; meta?: { column?: string } };
    if (
      e?.code === 'P2022' &&
      e?.meta?.column?.includes('parent_category_id')
    ) {
      throw new ServiceUnavailableException(
        'Database is missing category.parent_category_id. Run Prisma migration to add it.',
      );
    }
  }
}
