import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const DEFAULT_SOLD_STATUSES = ['paid', 'shipped', 'delivered'] as const;
const ALLOWED_ORDER_STATUSES = ['pending', ...DEFAULT_SOLD_STATUSES] as const;

type AllowedOrderStatus = (typeof ALLOWED_ORDER_STATUSES)[number];

type SalesReportRow = {
  id: number;
  order_number: string;
  order_date: Date;
  status: string;
  user: { user_id: number; email: string; name: string };
  total_amount: number;
  items_count: number;
  units_sold: number;
};

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalesReport(params?: {
    from?: string;
    to?: string;
    statuses?: string;
    take?: number;
    skip?: number;
  }) {
    const { fromDate, toDateExclusive } = this.parseRange(params?.from, params?.to);
    const statuses = this.normalizeStatuses(params?.statuses);

    const take = params?.take;
    const skip = params?.skip;
    if (take !== undefined && (!Number.isInteger(take) || take <= 0)) {
      throw new BadRequestException('take must be a positive integer.');
    }
    if (skip !== undefined && (!Number.isInteger(skip) || skip < 0)) {
      throw new BadRequestException('skip must be a non-negative integer.');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        order_date: { gte: fromDate, lt: toDateExclusive },
        status: { in: statuses },
      },
      select: {
        order_id: true,
        order_date: true,
        status: true,
        total_amount: true,
        user: { select: { user_id: true, email: true, name: true } },
        order_items: { select: { quantity: true, subtotal: true } },
      },
      orderBy: { order_date: 'asc' },
      take,
      skip,
    });

    const rows: SalesReportRow[] = orders.map((order) => {
      const itemsCount = order.order_items.length;
      const unitsSold = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
      return {
        id: order.order_id,
        order_number: this.toOrderNumber(order.order_id),
        order_date: order.order_date,
        status: order.status,
        user: order.user,
        total_amount: Number(order.total_amount),
        items_count: itemsCount,
        units_sold: unitsSold,
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.total_orders += 1;
        acc.total_sales += row.total_amount;
        acc.total_units += row.units_sold;
        return acc;
      },
      { total_orders: 0, total_sales: 0, total_units: 0 },
    );

    const byDayMap = new Map<string, { date: string; totalSales: number; orders: number; units: number }>();
    for (const row of rows) {
      const date = row.order_date.toISOString().slice(0, 10);
      const current = byDayMap.get(date) ?? { date, totalSales: 0, orders: 0, units: 0 };
      current.totalSales += row.total_amount;
      current.orders += 1;
      current.units += row.units_sold;
      byDayMap.set(date, current);
    }

    const by_day = [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    return {
      range: {
        from: fromDate,
        to: new Date(toDateExclusive.getTime() - 1),
      },
      statuses_included: statuses,
      summary: {
        total_orders: totals.total_orders,
        total_sales: totals.total_sales,
        total_units: totals.total_units,
        avg_order_value: totals.total_orders ? totals.total_sales / totals.total_orders : 0,
      },
      by_day,
      orders: rows,
    };
  }

  async getSalesReportCsv(params?: {
    from?: string;
    to?: string;
    statuses?: string;
  }) {
    const report = await this.getSalesReport({ ...params });
    const header = [
      'order_id',
      'order_number',
      'order_date',
      'status',
      'user_id',
      'user_name',
      'user_email',
      'total_amount',
      'items_count',
      'units_sold',
    ];

    const lines = [header.join(',')];
    for (const row of report.orders) {
      lines.push(
        [
          row.id,
          this.csv(row.order_number),
          this.csv(row.order_date.toISOString()),
          this.csv(row.status),
          row.user.user_id,
          this.csv(row.user.name),
          this.csv(row.user.email),
          row.total_amount,
          row.items_count,
          row.units_sold,
        ].join(','),
      );
    }

    return lines.join('\n');
  }

  private csv(value: unknown) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  private parseRange(from?: string, to?: string) {
    const now = new Date();
    const fallbackFrom = new Date(now);
    fallbackFrom.setDate(now.getDate() - 30);

    const fromDate = from ? this.parseDate(from, 'from') : fallbackFrom;
    const toDate = to ? this.parseDate(to, 'to') : now;

    // treat YYYY-MM-DD as day-based range: [from, to+1day)
    const toDateExclusive = this.isDateOnly(to ?? '')
      ? this.addDays(toDate, 1)
      : toDate;

    if (toDateExclusive.getTime() <= fromDate.getTime()) {
      throw new BadRequestException('to must be after from.');
    }

    return { fromDate, toDateExclusive };
  }

  private parseDate(value: string, field: 'from' | 'to') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required.`);
    }

    const date = this.isDateOnly(trimmed)
      ? new Date(`${trimmed}T00:00:00.000Z`)
      : new Date(trimmed);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date (YYYY-MM-DD or ISO string).`);
    }

    return date;
  }

  private isDateOnly(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private normalizeStatuses(input?: string): AllowedOrderStatus[] {
    if (!input || !input.trim()) {
      return [...DEFAULT_SOLD_STATUSES];
    }

    const cleaned = input
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

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

  private toOrderNumber(orderId: number) {
    return `ORD-${10000 + orderId}`;
  }
}

