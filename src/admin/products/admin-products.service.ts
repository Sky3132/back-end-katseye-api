import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAdminProductDto } from './dto/create-admin-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateAdminProductDto } from './dto/update-admin-product.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import type { product, product_variant } from '@prisma/client';

@Injectable()
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAdminProductDto) {
    const created = await this.prisma.product.create({
      data: {
        product_name: dto.title,
        title: dto.title,
        description: dto.description,
        price: dto.price,
        stock: dto.stock,
        category_id: dto.category_id ?? null,
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
    }

    return this.findOne(created.product_id);
  }

  findAll() {
    return this.prisma.product
      .findMany({
      include: {
        variants: true,
      },
      orderBy: { product_id: 'desc' },
      })
      .then((products) => products.map((product) => this.toFrontendProduct(product)));
  }

  async findOne(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { product_id: productId },
      include: {
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return this.toFrontendProduct(product);
  }

  async update(productId: number, dto: UpdateAdminProductDto) {
    await this.findOne(productId);

    await this.prisma.product.update({
      where: { product_id: productId },
      data: {
        product_name: dto.title,
        title: dto.title,
        description: dto.description,
        price: dto.price,
        stock: dto.stock,
        category_id: dto.category_id,
      },
    });

    return this.findOne(productId);
  }

  async updateStock(productId: number, stock: number) {
    await this.findOne(productId);

    return this.prisma.product
      .update({
      where: { product_id: productId },
      data: { stock },
      include: { variants: true },
      })
      .then((product) => this.toFrontendProduct(product));
  }

  async remove(productId: number) {
    await this.findOne(productId);
    await this.prisma.product.delete({
      where: { product_id: productId },
    });

    return { message: 'Product deleted successfully.' };
  }

  async addVariant(productId: number, dto: CreateProductVariantDto) {
    await this.findOne(productId);

    return this.prisma.product_variant.create({
      data: {
        product_id: productId,
        name: dto.name,
        sku: dto.sku ?? null,
        price: dto.price ?? null,
        stock: dto.stock,
      },
    });
  }

  async updateVariant(productId: number, variantId: number, dto: UpdateProductVariantDto) {
    await this.findOne(productId);
    await this.findVariant(productId, variantId);

    return this.prisma.product_variant.update({
      where: { variant_id: variantId },
      data: dto,
    });
  }

  async updateVariantStock(productId: number, variantId: number, stock: number) {
    await this.findOne(productId);
    await this.findVariant(productId, variantId);

    return this.prisma.product_variant.update({
      where: { variant_id: variantId },
      data: { stock },
    });
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

  private toFrontendProduct(
    product: product & {
      variants?: product_variant[];
    },
  ) {
    return {
      id: product.product_id,
      title: product.title ?? product.product_name,
      description: product.description,
      price: Number(product.price),
      current_stock: product.stock,
      category_id: product.category_id,
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
}
