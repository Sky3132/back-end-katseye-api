import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const [
      totalProducts,
      lowStockProducts,
      outOfStockProducts,
      totalOrders,
      salesAggregate,
      booksSoldAggregate,
      recentOrders,
      topSellingGrouped,
      last30DayOrders,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({
        where: {
          stock: { gt: 0, lte: 5 },
        },
      }),
      this.prisma.product.count({
        where: { stock: 0 },
      }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        _sum: { total_amount: true },
      }),
      this.prisma.order_item.aggregate({
        _sum: { quantity: true },
      }),
      this.prisma.order.findMany({
        orderBy: { order_date: 'desc' },
        take: 8,
      }),
      this.prisma.order_item.groupBy({
        by: ['product_id'],
        _sum: { quantity: true },
        orderBy: {
          _sum: {
            quantity: 'desc',
          },
        },
        take: 5,
      }),
      this.prisma.order.findMany({
        where: {
          order_date: {
            gte: thirtyDaysAgo,
          },
        },
        select: {
          order_date: true,
          total_amount: true,
        },
        orderBy: {
          order_date: 'asc',
        },
      }),
    ]);

    const topProductIds = topSellingGrouped.map((item) => item.product_id);
    const topProductMap = new Map<number, string>();
    if (topProductIds.length > 0) {
      const topProducts = await this.prisma.product.findMany({
        where: {
          product_id: { in: topProductIds },
        },
        select: {
          product_id: true,
          title: true,
          product_name: true,
        },
      });

      for (const p of topProducts) {
        topProductMap.set(p.product_id, p.title ?? p.product_name);
      }
    }

    const salesByDay = this.groupSalesByDay(last30DayOrders);

    return {
      inventory: {
        totalProducts,
        lowStockProducts,
        outOfStockProducts,
      },
      sales: {
        totalOrders,
        totalSales: Number(salesAggregate._sum.total_amount ?? 0),
        totalBooksSold: booksSoldAggregate._sum.quantity ?? 0,
      },
      topSellingBooks: topSellingGrouped.map((item) => ({
        product_id: item.product_id,
        title: topProductMap.get(item.product_id) ?? `Product #${item.product_id}`,
        quantity_sold: item._sum.quantity ?? 0,
      })),
      recentOrders,
      salesByDay,
    };
  }

  private groupSalesByDay(
    rows: Array<{ order_date: Date | null; total_amount: unknown }>,
  ) {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.order_date) {
        continue;
      }

      const key = row.order_date.toISOString().slice(0, 10);
      const value = Number(row.total_amount ?? 0);
      map.set(key, (map.get(key) ?? 0) + value);
    }

    return [...map.entries()].map(([date, total]) => ({
      date,
      totalSales: total,
    }));
  }
}
