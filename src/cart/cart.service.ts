import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addItem(userId: number, dto: AddCartItemDto) {
    let product;
    try {
      product = await this.prisma.product.findFirst({
        where: {
          product_id: dto.product_id,
          archived_at: null,
        },
        include: {
          variants: {
            select: { variant_id: true, stock: true },
            orderBy: { variant_id: 'asc' },
          },
        },
      });
    } catch (err) {
      this.throwIfMissingArchivedAtColumn(err);
      throw err;
    }

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    const effectiveStock = product.variants.length
      ? product.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
      : product.stock;

    if (effectiveStock <= 0) {
      throw new BadRequestException('Out of stock.');
    }

    if (effectiveStock < dto.quantity) {
      throw new BadRequestException('Insufficient stock.');
    }

    const cart = await this.getOrCreateCart(userId);
    const existingItem = await this.prisma.cart_item.findFirst({
      where: {
        cart_id: cart.cart_id,
        product_id: dto.product_id,
      },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + dto.quantity;
      if (effectiveStock < newQuantity) {
        throw new BadRequestException(
          'Insufficient stock for requested quantity.',
        );
      }

      return this.prisma.cart_item.update({
        where: { cart_item_id: existingItem.cart_item_id },
        data: { quantity: newQuantity },
      });
    }

    return this.prisma.cart_item.create({
      data: {
        cart_id: cart.cart_id,
        product_id: dto.product_id,
        quantity: dto.quantity,
      },
    });
  }

  async getItems(userId: number) {
    const cart = await this.getOrCreateCart(userId);

    let items;
    try {
      items = await this.prisma.cart_item.findMany({
        where: { cart_id: cart.cart_id },
        include: {
          product: {
            select: {
              product_id: true,
              title: true,
              product_name: true,
              imgsrc: true,
              price: true,
              stock: true,
              archived_at: true,
            },
          },
        },
        orderBy: { cart_item_id: 'desc' },
      });
    } catch (err) {
      this.throwIfMissingArchivedAtColumn(err);
      throw err;
    }

    const archivedCartItemIds = items
      .filter((item) => item.product.archived_at != null)
      .map((item) => item.cart_item_id);

    if (archivedCartItemIds.length) {
      await this.prisma.cart_item.deleteMany({
        where: { cart_item_id: { in: archivedCartItemIds } },
      });
    }

    const activeItems = items.filter((item) => item.product.archived_at == null);

    return activeItems.map((item) => ({
      id: item.cart_item_id,
      product_id: item.product_id,
      quantity: item.quantity,
      product: {
        id: item.product.product_id,
        title: item.product.title ?? item.product.product_name,
        imgsrc: item.product.imgsrc,
        price: Number(item.product.price),
        stock: item.product.stock,
      },
    }));
  }

  async updateItem(userId: number, cartItemId: number, dto: UpdateCartItemDto) {
    const item = await this.prisma.cart_item.findUnique({
      where: { cart_item_id: cartItemId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found.');
    }

    await this.assertCartOwner(userId, item.cart_id);

    let product;
    try {
      product = await this.prisma.product.findFirst({
        where: {
          product_id: item.product_id,
          archived_at: null,
        },
        include: {
          variants: {
            select: { variant_id: true, stock: true },
            orderBy: { variant_id: 'asc' },
          },
        },
      });
    } catch (err) {
      this.throwIfMissingArchivedAtColumn(err);
      throw err;
    }
    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    const effectiveStock = product.variants.length
      ? product.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
      : product.stock;

    if (effectiveStock <= 0) {
      throw new BadRequestException('Out of stock.');
    }
    if (effectiveStock < dto.quantity) {
      throw new BadRequestException('Insufficient stock.');
    }

    return this.prisma.cart_item.update({
      where: { cart_item_id: cartItemId },
      data: { quantity: dto.quantity },
    });
  }

  async removeItem(userId: number, cartItemId: number) {
    const item = await this.prisma.cart_item.findUnique({
      where: { cart_item_id: cartItemId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found.');
    }

    await this.assertCartOwner(userId, item.cart_id);

    await this.prisma.cart_item.delete({
      where: { cart_item_id: cartItemId },
    });

    return { message: 'Cart item deleted successfully.' };
  }

  async clear(userId: number) {
    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cart_item.deleteMany({
      where: { cart_id: cart.cart_id },
    });

    return { message: 'Cart cleared successfully.' };
  }

  private async getOrCreateCart(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const existing = await this.prisma.cart.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.cart.create({
        data: { user_id: userId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003') {
          throw new UnauthorizedException('User not found.');
        }
      }
      throw err;
    }
  }

  private async assertCartOwner(userId: number, cartId: number) {
    const cart = await this.prisma.cart.findUnique({
      where: { cart_id: cartId },
    });

    if (!cart || cart.user_id !== userId) {
      throw new ForbiddenException('You do not have access to this cart item.');
    }
  }

  private throwIfMissingArchivedAtColumn(err: unknown): never | void {
    const e = err as { code?: string; meta?: { column?: string } };
    if (e?.code === 'P2022' && e?.meta?.column?.includes('archived_at')) {
      throw new ServiceUnavailableException(
        'Database is missing product.archived_at. Run Prisma migration for archived products.',
      );
    }
  }
}
