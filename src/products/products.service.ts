import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { randomInt } from 'crypto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: dto,
    });
  }

  findAll() {
    return this.prisma.product.findMany({
      orderBy: { product_id: 'desc' },
    });
  }

  async findOne(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { product_id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return product;
  }

  async update(productId: number, dto: UpdateProductDto) {
    await this.findOne(productId);
    return this.prisma.product.update({
      where: { product_id: productId },
      data: dto,
    });
  }

  async remove(productId: number) {
    await this.findOne(productId);
    await this.prisma.product.delete({
      where: { product_id: productId },
    });

    return { message: 'Product deleted successfully.' };
  }

  async generateSamples(total = 10) {
    const created: Array<{
      product_id: number;
      product_name: string;
      price: unknown;
      stock: number;
      category_id: number | null;
    }> = [];

    for (let i = 0; i < total; i++) {
      const product = await this.prisma.product.create({
        data: {
          product_name: `Sample Product ${Date.now()}-${i + 1}`,
          price: randomInt(100, 50000) / 100,
          stock: randomInt(1, 200),
          category_id: null,
        },
      });
      created.push(product);
    }

    return created;
  }
}
