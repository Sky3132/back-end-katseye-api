import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { product, product_variant } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAdminProductDto } from './dto/create-admin-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateAdminProductDto } from './dto/update-admin-product.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeGalleryImages(
  value: unknown,
  primary: string | null,
): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) return [];
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return trimmed.split(',');
          }
        })()
      : [];

  const cleaned = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const withoutPrimary = primary
    ? cleaned.filter((v) => v !== primary)
    : cleaned;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of withoutPrimary) {
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

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
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: number, dto: CreateAdminProductDto) {
    await this.findAdmin(adminId);

    const categoryId = await this.resolveProductCategoryId(dto);

    const title = dto.title ?? dto.product_name;
    const stock = dto.stock ?? dto.current_stock ?? 0;

    const primaryImageUrl =
      normalizeImageUrl(dto.image_url) ?? normalizeImageUrl(dto.imgsrc);
    const galleryImages = normalizeGalleryImages(dto.images, primaryImageUrl);
    const imagesJson = galleryImages.length
      ? JSON.stringify(galleryImages)
      : null;

    const created = await this.prisma.product.create({
      data: {
        product_name: title ?? '',
        title: title ?? '',
        description: dto.description,
        imgsrc: primaryImageUrl,
        image_url: primaryImageUrl,
        images: imagesJson,
        price: dto.price,
        stock,
        admin_id: adminId,
        category_id: categoryId,
      },
    });

    if (dto.variants?.length) {
      await this.prisma.product_variant.createMany({
        data: dto.variants.map((variant) => ({
          product_id: created.product_id,
          name: variant.name,
          sku: variant.sku ?? null,
          price: variant.price ?? null,
          stock: variant.stock,
        })),
      });

      const total = dto.variants.reduce(
        (sum, variant) => sum + (variant.stock ?? 0),
        0,
      );
      await this.prisma.product.update({
        where: { product_id: created.product_id },
        data: { stock: total },
      });
    }

    await this.prisma.inventory_log.create({
      data: {
        product_id: created.product_id,
        admin_id: adminId,
        change_qty: stock,
        action: 'product_created',
      },
    });

    return this.findOne(created.product_id);
  }

  findAll() {
    return this.findManyProducts().then((products) =>
      products.map((product) => this.toFrontendProduct(product)),
    );
  }

  async findOne(productId: number) {
    let product;
    try {
      product = await this.prisma.product.findUnique({
        where: { product_id: productId },
        include: {
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
          variants: true,
        },
      });
    } catch (err) {
      if (this.isMissingParentCategoryColumn(err)) {
        product = await this.prisma.product.findUnique({
          where: { product_id: productId },
          include: {
            category: {
              select: {
                category_id: true,
                category_name: true,
              },
            },
            variants: true,
          },
        });
      } else {
        throw err;
      }
    }

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return this.toFrontendProduct(product);
  }

  async update(adminId: number, productId: number, dto: UpdateAdminProductDto) {
    await this.findAdmin(adminId);
    const existing = await this.findProductRecord(productId);

    const nextCategoryId =
      dto.category_id == null &&
      dto.main_category_id == null &&
      dto.subcategory_id == null
        ? undefined
        : await this.resolveProductCategoryId(dto);

    const title = dto.title ?? dto.product_name;
    const stock = dto.stock ?? dto.current_stock;

    const nextPrimaryImageUrl =
      normalizeImageUrl(dto.image_url) ??
      (dto.imgsrc === undefined ? undefined : normalizeImageUrl(dto.imgsrc));

    const nextGalleryImages =
      dto.images === undefined
        ? undefined
        : normalizeGalleryImages(
            dto.images,
            nextPrimaryImageUrl ?? existing.image_url ?? existing.imgsrc,
          );
    const nextImagesJson =
      nextGalleryImages === undefined
        ? undefined
        : nextGalleryImages.length
          ? JSON.stringify(nextGalleryImages)
          : null;

    await this.prisma.product.update({
      where: { product_id: productId },
      data: {
        product_name: title ?? undefined,
        title,
        description: dto.description,
        imgsrc:
          nextPrimaryImageUrl === undefined ? undefined : nextPrimaryImageUrl,
        image_url: nextPrimaryImageUrl,
        images: nextImagesJson,
        price: dto.price,
        stock,
        category_id: nextCategoryId,
      },
    });

    if (typeof dto.stock === 'number' && dto.stock !== existing.stock) {
      await this.prisma.inventory_log.create({
        data: {
          product_id: productId,
          admin_id: adminId,
          change_qty: dto.stock - existing.stock,
          action: 'product_updated',
        },
      });
    }

    return this.findOne(productId);
  }

  async updateStock(adminId: number, productId: number, stock: number) {
    await this.findAdmin(adminId);
    const existing = await this.findProductRecord(productId);

    let updated;
    try {
      updated = await this.prisma.product.update({
        where: { product_id: productId },
        data: { stock },
        include: {
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
          variants: true,
        },
      });
    } catch (err) {
      if (this.isMissingParentCategoryColumn(err)) {
        updated = await this.prisma.product.update({
          where: { product_id: productId },
          data: { stock },
          include: {
            category: {
              select: {
                category_id: true,
                category_name: true,
              },
            },
            variants: true,
          },
        });
      } else {
        throw err;
      }
    }

    await this.prisma.inventory_log.create({
      data: {
        product_id: productId,
        admin_id: adminId,
        change_qty: stock - existing.stock,
        action: 'stock_updated',
      },
    });

    return this.toFrontendProduct(updated);
  }

  async remove(productId: number) {
    await this.findOne(productId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.cart_item.deleteMany({
          where: { product_id: productId },
        });

        await tx.product.delete({
          where: { product_id: productId },
        });
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete this product because it is referenced by existing orders. Consider archiving it instead.',
        );
      }
      throw err;
    }

    return { message: 'Product deleted successfully.' };
  }

  async addVariant(
    adminId: number,
    productId: number,
    dto: CreateProductVariantDto,
  ) {
    await this.findAdmin(adminId);
    await this.findOne(productId);

    const created = await this.prisma.product_variant.create({
      data: {
        product_id: productId,
        name: dto.name,
        sku: dto.sku ?? null,
        price: dto.price ?? null,
        stock: dto.stock,
      },
    });

    const totals = await this.prisma.product_variant.aggregate({
      where: { product_id: productId },
      _sum: { stock: true },
    });
    await this.prisma.product.update({
      where: { product_id: productId },
      data: { stock: totals._sum.stock ?? 0 },
    });

    return created;
  }

  async updateVariant(
    adminId: number,
    productId: number,
    variantId: number,
    dto: UpdateProductVariantDto,
  ) {
    await this.findAdmin(adminId);
    await this.findOne(productId);
    await this.findVariant(productId, variantId);

    return this.prisma.product_variant.update({
      where: { variant_id: variantId },
      data: dto,
    });
  }

  async updateVariantStock(
    adminId: number,
    productId: number,
    variantId: number,
    stock: number,
  ) {
    await this.findAdmin(adminId);
    await this.findOne(productId);
    await this.findVariant(productId, variantId);

    const updated = await this.prisma.product_variant.update({
      where: { variant_id: variantId },
      data: { stock },
    });

    const totals = await this.prisma.product_variant.aggregate({
      where: { product_id: productId },
      _sum: { stock: true },
    });
    await this.prisma.product.update({
      where: { product_id: productId },
      data: { stock: totals._sum.stock ?? 0 },
    });

    return updated;
  }

  async removeVariant(productId: number, variantId: number) {
    await this.findOne(productId);
    await this.findVariant(productId, variantId);

    await this.prisma.product_variant.delete({
      where: { variant_id: variantId },
    });

    return { message: 'Variant deleted successfully.' };
  }

  private async findVariant(productId: number, variantId: number) {
    const variant = await this.prisma.product_variant.findFirst({
      where: {
        variant_id: variantId,
        product_id: productId,
      },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }

    return variant;
  }

  private async findAdmin(adminId: number) {
    const admin = await this.prisma.admin.findUnique({
      where: { admin_id: adminId },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }

    return admin;
  }

  private async findProductRecord(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { product_id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return product;
  }

  private async ensureCategory(categoryId: number) {
    const category = await this.prisma.category.findUnique({
      where: { category_id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }
    return category;
  }

  private isAlbumCategoryName(name: string) {
    return name.trim().toLowerCase() === 'album';
  }

  private async resolveProductCategoryId(dto: {
    category_id?: number;
    main_category_id?: number;
    subcategory_id?: number | null;
  }): Promise<number | null> {
    // Backward compatible: if caller still sends only category_id, keep it.
    if (dto.main_category_id == null) {
      if (dto.category_id == null) return null;
      await this.ensureCategory(dto.category_id);
      return dto.category_id;
    }

    const main = await this.ensureCategory(dto.main_category_id);
    if (main.parent_category_id != null) {
      throw new BadRequestException(
        'main_category_id must be a top-level category.',
      );
    }

    // Album never has subcategories: force storing Album itself as category_id.
    if (this.isAlbumCategoryName(main.category_name)) {
      return main.category_id;
    }

    const subId = dto.subcategory_id ?? null;
    if (subId == null) {
      return main.category_id;
    }

    const sub = await this.ensureCategory(subId);
    if (sub.parent_category_id !== main.category_id) {
      throw new BadRequestException(
        'subcategory_id must be a child of main_category_id.',
      );
    }

    return sub.category_id;
  }

  private toFrontendProduct(
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
    const mainCategoryId = product.category
      ? (product.category.parent?.category_id ?? product.category.category_id)
      : null;
    const mainCategoryName = product.category
      ? (product.category.parent?.category_name ??
        product.category.category_name)
      : null;
    const subCategoryId = product.category?.parent
      ? product.category.category_id
      : null;
    const subCategoryName = product.category?.parent
      ? product.category.category_name
      : null;

    return {
      id: product.product_id,
      title: product.title ?? product.product_name,
      imgsrc: product.image_url ?? product.imgsrc,
      image_url: product.image_url ?? product.imgsrc,
      images: parseGalleryImages(product.images),
      image: product.image_url ?? product.imgsrc,
      gallery: parseGalleryImages(product.images),
      description: product.description,
      price: Number(product.price),
      current_stock: product.stock,
      category_id: product.category?.category_id ?? null,
      category_name: product.category?.category_name ?? null,
      parent_category_id: product.category?.parent_category_id ?? null,
      parent_category_name: product.category?.parent?.category_name ?? null,
      main_category_id: mainCategoryId,
      main_category_name: mainCategoryName,
      subcategory_id: subCategoryId,
      subcategory_name: subCategoryName,
      category: product.category
        ? {
            id: product.category.category_id,
            name: product.category.category_name,
          }
        : null,
      created_at: product.created_at,
      updated_at: product.updated_at,
      variants:
        product.variants?.map((variant) => ({
          id: variant.variant_id,
          name: variant.name,
          sku: variant.sku,
          price: variant.price == null ? null : Number(variant.price),
          stock: variant.stock,
          created_at: variant.created_at,
          updated_at: variant.updated_at,
        })) ?? [],
    };
  }

  private findManyProducts() {
    return this.prisma.product
      .findMany({
        include: {
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
          variants: true,
        },
        orderBy: { product_id: 'desc' },
      })
      .catch((err) => {
        if (!this.isMissingParentCategoryColumn(err)) {
          throw err;
        }
        return this.prisma.product.findMany({
          include: {
            category: {
              select: {
                category_id: true,
                category_name: true,
              },
            },
            variants: true,
          },
          orderBy: { product_id: 'desc' },
        });
      });
  }

  private isMissingParentCategoryColumn(err: unknown) {
    const e = err as { code?: string; meta?: { column?: string } };
    return (
      e?.code === 'P2022' && e?.meta?.column?.includes('parent_category_id')
    );
  }
}
