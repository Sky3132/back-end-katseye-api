import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll() {
    try {
      const categories = await this.prisma.category.findMany({
        orderBy: [{ parent_category_id: 'asc' }, { category_name: 'asc' }],
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

  private throwIfMissingParentCategoryColumn(err: unknown): never | void {
    const e = err as { code?: string; meta?: { column?: string } };
    if (e?.code === 'P2022' && e?.meta?.column?.includes('parent_category_id')) {
      throw new ServiceUnavailableException(
        'Database is missing category.parent_category_id. Run Prisma migration to add it.',
      );
    }
  }
}
