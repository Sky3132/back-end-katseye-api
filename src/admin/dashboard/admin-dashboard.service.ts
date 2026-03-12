import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

const SOLD_ORDER_STATUSES = ['paid', 'shipped', 'delivered'] as const;

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis() {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const elapsedMs = now.getTime() - startOfThisMonth.getTime();
    const rawLastMonthEnd = new Date(startOfLastMonth.getTime() + elapsedMs);
    const endOfLastMonthToDate =
      rawLastMonthEnd.getTime() > startOfThisMonth.getTime()
        ? startOfThisMonth
        : rawLastMonthEnd;

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const [
      thisMonthSalesAgg,
      lastMonthSalesAgg,
      thisMonthOrdersCount,
      thisMonthPaidOrdersCount,
      reportsGeneratedLast30Days,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          status: { in: [...SOLD_ORDER_STATUSES] },
          order_date: { gte: startOfThisMonth, lt: now },
        },
        _sum: { total_amount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: [...SOLD_ORDER_STATUSES] },
          order_date: { gte: startOfLastMonth, lt: endOfLastMonthToDate },
        },
        _sum: { total_amount: true },
      }),
      this.prisma.order.count({
        where: {
          order_date: { gte: startOfThisMonth, lt: now },
        },
      }),
      this.prisma.order.count({
        where: {
          status: 'paid',
          order_date: { gte: startOfThisMonth, lt: now },
        },
      }),
      this.prisma.notification.count({
        where: {
          created_at: { gte: thirtyDaysAgo, lt: now },
        },
      }),
    ]);

    const thisMonthSales = Number(thisMonthSalesAgg._sum.total_amount ?? 0);
    const lastMonthSalesToDate = Number(lastMonthSalesAgg._sum.total_amount ?? 0);

    const salesChangePercent =
      lastMonthSalesToDate > 0
        ? ((thisMonthSales - lastMonthSalesToDate) / lastMonthSalesToDate) * 100
        : null;

    return {
      as_of: now,
      ranges: {
        this_month: {
          from: startOfThisMonth,
          to: now,
        },
        last_month_to_date: {
          from: startOfLastMonth,
          to: endOfLastMonthToDate,
        },
        last_30_days: {
          from: thirtyDaysAgo,
          to: now,
        },
      },
      cards: {
        total_sales: {
          value: thisMonthSales,
          change_percent: salesChangePercent,
        },
        orders: {
          value: thisMonthOrdersCount,
          paid_orders: thisMonthPaidOrdersCount,
        },
        reports_generated: {
          value: reportsGeneratedLast30Days,
        },
      },
    };
  }

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
        select: {
          order_id: true,
          user_id: true,
          order_date: true,
          total_amount: true,
          status: true,
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
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
      recentOrders: recentOrders.map((order) => ({
        id: order.order_id,
        order_number: this.toOrderNumber(order.order_id),
        user_id: order.user_id,
        user_email: order.user.email,
        user_name: order.user.name,
        total_amount: Number(order.total_amount),
        status: order.status,
        order_date: order.order_date,
      })),
      salesByDay,
    };
  }

  async getCurrentStocks(lowThreshold = 5) {
    const products = await this.prisma.product.findMany({
      select: {
        product_id: true,
        title: true,
        product_name: true,
        stock: true,
        variants: {
          select: {
            variant_id: true,
            name: true,
            sku: true,
            stock: true,
          },
          orderBy: { variant_id: 'asc' },
        },
      },
      orderBy: { product_id: 'desc' },
    });

    const rows: Array<{
      product_id: number;
      title: string;
      sku: string | null;
      stock_qty: number;
      status: StockStatus;
      variant_id: number | null;
      variant_name: string | null;
    }> = [];

    for (const product of products) {
      const title = product.title ?? product.product_name;
      if (product.variants.length) {
        for (const variant of product.variants) {
          rows.push({
            product_id: product.product_id,
            title,
            sku: variant.sku ?? null,
            stock_qty: variant.stock,
            status: this.toStockStatus(variant.stock, lowThreshold),
            variant_id: variant.variant_id,
            variant_name: variant.name,
          });
        }
      } else {
        rows.push({
          product_id: product.product_id,
          title,
          sku: null,
          stock_qty: product.stock,
          status: this.toStockStatus(product.stock, lowThreshold),
          variant_id: null,
          variant_name: null,
        });
      }
    }

    return {
      lowThreshold,
      items: rows,
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

  private toOrderNumber(orderId: number) {
    return `ORD-${10000 + orderId}`;
  }

  private toStockStatus(stockQty: number, lowThreshold: number): StockStatus {
    if (stockQty <= 0) return 'out_of_stock';
    if (stockQty <= lowThreshold) return 'low_stock';
    return 'in_stock';
  }
}
