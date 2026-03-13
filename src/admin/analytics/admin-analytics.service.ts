import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MostSoldResponse } from './admin-analytics.types';

const DEFAULT_SOLD_STATUSES = ['paid', 'shipped', 'delivered'] as const;
const ALLOWED_ORDER_STATUSES = ['pending', ...DEFAULT_SOLD_STATUSES] as const;

type AllowedOrderStatus = (typeof ALLOWED_ORDER_STATUSES)[number];

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMostSoldProducts(params?: {
    take?: number;
    statuses?: string[];
  }): Promise<MostSoldResponse> {
    const take = params?.take;
    if (take !== undefined && (!Number.isInteger(take) || take <= 0)) {
      throw new BadRequestException('take must be a positive integer.');
    }

    const statuses = this.normalizeStatuses(params?.statuses);

    const grouped = await this.prisma.order_item.groupBy({
      by: ['product_id'],
      where: {
        order: {
          status: {
            in: statuses,
          },
        },
      },
      _sum: {
        quantity: true,
        subtotal: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take,
    });

    const productIds = grouped.map((row) => row.product_id);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { product_id: { in: productIds } },
          select: {
            product_id: true,
            title: true,
            product_name: true,
            imgsrc: true,
            price: true,
            stock: true,
          },
        })
      : [];

    const productMap = new Map(
      products.map((p) => [
        p.product_id,
        {
          id: p.product_id,
          title: p.title ?? p.product_name,
          imgsrc: p.imgsrc,
          price: Number(p.price),
          stock: p.stock,
        },
      ]),
    );

    const items = grouped
      .map((row) => {
        const quantitySold = row._sum.quantity ?? 0;
        const revenue = Number(row._sum.subtotal ?? 0);
        return {
          product: productMap.get(row.product_id) ?? {
            id: row.product_id,
            title: `Product #${row.product_id}`,
            imgsrc: null,
            price: 0,
            stock: 0,
          },
          quantity_sold: quantitySold,
          revenue,
          avg_unit_price: quantitySold > 0 ? revenue / quantitySold : 0,
        };
      })
      .sort((a, b) => {
        if (b.quantity_sold !== a.quantity_sold)
          return b.quantity_sold - a.quantity_sold;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return a.product.id - b.product.id;
      })
      .map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

    const totalUnitsSold = items.reduce(
      (sum, item) => sum + item.quantity_sold,
      0,
    );
    const totalRevenue = items.reduce((sum, item) => sum + item.revenue, 0);

    return {
      statuses_included: statuses,
      total_products_sold: items.length,
      total_units_sold: totalUnitsSold,
      total_revenue: totalRevenue,
      best_seller: items[0] ?? null,
      items,
    };
  }

  private normalizeStatuses(input?: string[]): AllowedOrderStatus[] {
    if (!input || input.length === 0) {
      return [...DEFAULT_SOLD_STATUSES];
    }

    const cleaned = input
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);

    if (cleaned.length === 0) {
      return [...DEFAULT_SOLD_STATUSES];
    }

    const unique = [...new Set(cleaned)];
    for (const status of unique) {
      if (!ALLOWED_ORDER_STATUSES.includes(status as AllowedOrderStatus)) {
        throw new BadRequestException(
          `Invalid status "${status}". Allowed: ${ALLOWED_ORDER_STATUSES.join(', ')}.`,
        );
      }
    }

    return unique as AllowedOrderStatus[];
  }
}
