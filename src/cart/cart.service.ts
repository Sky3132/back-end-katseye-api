import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addItem(userId: number, dto: AddCartItemDto) {
    const product = await this.prisma.product.findUnique({
      where: { product_id: dto.product_id },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    if (product.stock < dto.quantity) {
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
      if (product.stock < newQuantity) {
        throw new BadRequestException('Insufficient stock for requested quantity.');
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

    return this.prisma.cart_item.findMany({
      where: { cart_id: cart.cart_id },
      orderBy: { cart_item_id: 'desc' },
    });
  }

  async updateItem(userId: number, cartItemId: number, dto: UpdateCartItemDto) {
    const item = await this.prisma.cart_item.findUnique({
      where: { cart_item_id: cartItemId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found.');
    }

    await this.assertCartOwner(userId, item.cart_id);

    const product = await this.prisma.product.findUnique({
      where: { product_id: item.product_id },
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    if (product.stock < dto.quantity) {
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
    const existing = await this.prisma.cart.findFirst({
      where: { user_id: userId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.cart.create({
      data: { user_id: userId },
    });
  }

  private async assertCartOwner(userId: number, cartId: number) {
    const cart = await this.prisma.cart.findUnique({
      where: { cart_id: cartId },
    });

    if (!cart || cart.user_id !== userId) {
      throw new ForbiddenException('You do not have access to this cart item.');
    }
  }
}
