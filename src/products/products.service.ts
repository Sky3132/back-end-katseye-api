import { Injectable, NotFoundException } from '@nestjs/common';
import type { product, product_variant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

function parseGalleryImages(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const where = {};

    const include = {
      category: {
        select: {
          category_id: true,
          category_name: true,
          parent_category_id: true,
          parent: {
            select: {
              category_id: true,
              category_name: true,
            },
          },
        },
      },
      variants: {
        orderBy: { variant_id: 'asc' as const },
      },
    };

    let products;
    try {
      products = await this.prisma.product.findMany({
        where,
        include,
        orderBy: { product_id: 'desc' },
      });
    } catch (err) {
      if (this.isMissingParentCategoryColumn(err)) {
        products = await this.prisma.product.findMany({
          where,
          include: {
            ...include,
            category: {
              select: {
                category_id: true,
                category_name: true,
              },
            },
          },
          orderBy: { product_id: 'desc' },
        });
      } else {
        throw err;
      }
    }

    return products.map((product) => this.toStoreProduct(product));
  }

  async findOne(productId: number) {
    const where = {
      product_id: productId,
    };

    const include = {
      category: {
        select: {
          category_id: true,
          category_name: true,
          parent_category_id: true,
          parent: {
            select: {
              category_id: true,
              category_name: true,
            },
          },
        },
      },
      variants: {
        orderBy: { variant_id: 'asc' as const },
      },
    };

    let product;
    try {
      product = await this.prisma.product.findFirst({
        where,
        include,
      });
    } catch (err) {
      if (this.isMissingParentCategoryColumn(err)) {
        product = await this.prisma.product.findFirst({
          where,
          include: {
            ...include,
            category: {
              select: {
                category_id: true,
                category_name: true,
              },
            },
          },
        });
      } else {
        throw err;
      }
    }

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return this.toStoreProduct(product);
  }

  private toStoreProduct(
    product: product & {
      category?: {
        category_id: number;
        category_name: string;
        parent_category_id?: number | null;
        parent?: { category_id: number; category_name: string } | null;
      } | null;
      variants?: product_variant[];
    },
  ) {
    const variantTotalStock =
      product.variants?.reduce((sum, variant) => sum + (variant.stock ?? 0), 0) ??
      0;
    const effectiveStock = (product.variants?.length ?? 0) > 0 ? variantTotalStock : product.stock;

    return {
      id: product.product_id,
      title: product.title ?? product.product_name,
      product_name: product.product_name,
      imgsrc: product.image_url ?? product.imgsrc,
      image_url: product.image_url ?? product.imgsrc,
      images: parseGalleryImages(product.images),
      image: product.image_url ?? product.imgsrc,
      gallery: parseGalleryImages(product.images),
      description: product.description,
      price: Number(product.price),
      stock: effectiveStock,
      in_stock: effectiveStock > 0,
      category_id: product.category?.category_id ?? null,
      category_name: product.category?.category_name ?? null,
      parent_category_id: product.category?.parent_category_id ?? null,
      parent_category_name: product.category?.parent?.category_name ?? null,
      category: product.category
        ? {
            id: product.category.category_id,
            name: product.category.category_name,
          }
        : null,
      variants:
        product.variants?.map((variant) => ({
          id: variant.variant_id,
          name: variant.name,
          sku: variant.sku,
          price: variant.price == null ? null : Number(variant.price),
          stock: variant.stock,
          in_stock: variant.stock > 0,
        })) ?? [],
      created_at: product.created_at,
      updated_at: product.updated_at,
    };
  }

  private isMissingParentCategoryColumn(err: unknown) {
    const e = err as { code?: string; meta?: { column?: string } };
    return e?.code === 'P2022' && e?.meta?.column?.includes('parent_category_id');
  }
}
