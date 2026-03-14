import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { OrderTrackerQueryDto, OrderTrackerTab } from './dto/order-tracker-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ParcelTrackingService } from '../../parcels/parcel-tracking.service';
import { MailerService } from '../../mailer/mailer.service';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parcelTracking: ParcelTrackingService,
    private readonly mailer: MailerService,
  ) {}

  async getTrackerSummary() {
    const { fromDate, toDateExclusive } = this.todayRange();

    const [totalOrdersToday, pendingOrdersToday, deliveredAgg, cancelledToday] =
      await Promise.all([
        this.prisma.order.count({
          where: { order_date: { gte: fromDate, lt: toDateExclusive } },
        }),
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: { in: ['pending', 'paid'] },
          },
        }),
        this.prisma.order.aggregate({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'delivered',
          },
          _sum: { total_amount: true },
        }),
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'cancelled',
          },
        }),
      ]);

    const [newCount, inProgressCount, dispatchedCount, completedCount] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'pending',
          },
        }),
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'paid',
          },
        }),
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'shipped',
          },
        }),
        this.prisma.order.count({
          where: {
            order_date: { gte: fromDate, lt: toDateExclusive },
            status: 'delivered',
          },
        }),
      ]);

    return {
      range: {
        from: fromDate,
        to: new Date(toDateExclusive.getTime() - 1),
      },
      totalOrdersToday,
      pendingOrdersToday,
      totalRevenueToday: Number(deliveredAgg._sum.total_amount ?? 0),
      customerFeedbackToday: 0,
      statusCounts: {
        new: newCount,
        in_progress: inProgressCount,
        awaiting_pickup: 0,
        dispatched: dispatchedCount,
        completed: completedCount,
        cancelled: cancelledToday,
      },
    };
  }

  async listTracker(query: OrderTrackerQueryDto) {
    const take = query.take ?? 25;
    const page = query.page ?? 1;
    if (!Number.isInteger(take) || take <= 0) {
      throw new BadRequestException('take must be a positive integer.');
    }
    if (!Number.isInteger(page) || page <= 0) {
      throw new BadRequestException('page must be a positive integer.');
    }

    const skip = (page - 1) * take;
    const { fromDate, toDateExclusive } = this.parseRange(query.from, query.to);

    const where: Prisma.orderWhereInput = {
      order_date: { gte: fromDate, lt: toDateExclusive },
      ...this.whereForTab(query.tab),
      ...this.whereForSearch(query.search),
    };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        take,
        skip,
        orderBy: { order_date: 'desc' },
        include: {
          user: { select: { user_id: true, email: true, name: true } },
          shipment: { select: { status: true } },
        },
      }),
    ]);

    const items = orders.map((order) => ({
      id: order.order_id,
      order_number: this.toOrderNumber(order.order_id),
      user: order.user,
      total_amount: Number(order.total_amount),
      status: order.status,
      tracker_status: this.toTrackerStatus(order.status, order.shipment?.status),
      order_date: order.order_date,
    }));

    return {
      page,
      take,
      total,
      items,
    };
  }

  async listAll(take = 50) {
    const orders = await this.prisma.order.findMany({
      take,
      orderBy: { order_date: 'desc' },
      include: {
        user: { select: { user_id: true, email: true, name: true } },
      },
    });

    return orders.map((order) => ({
      id: order.order_id,
      order_number: this.toOrderNumber(order.order_id),
      user: order.user,
      total_amount: Number(order.total_amount),
      status: order.status,
      order_date: order.order_date,
    }));
  }

  async listRecent(take = 8) {
    if (!Number.isInteger(take) || take <= 0) {
      throw new BadRequestException('take must be a positive integer.');
    }

    const orders = await this.prisma.order.findMany({
      take,
      orderBy: { order_date: 'desc' },
      include: {
        user: { select: { user_id: true, email: true, name: true } },
      },
    });

    return orders.map((order) => ({
      id: order.order_id,
      order_number: this.toOrderNumber(order.order_id),
      user: order.user,
      total_amount: Number(order.total_amount),
      status: order.status,
      order_date: order.order_date,
    }));
  }

  async updateStatus(orderId: number, dto: UpdateOrderStatusDto) {
    await this.ensureOrder(orderId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { order_id: orderId },
        data: { status: dto.status },
        include: {
          user: { select: { user_id: true, email: true, name: true } },
          shipment: true,
        },
      });

      if (dto.status === 'shipped') {
        if (!order.shipment) {
          throw new BadRequestException('Shipment record is missing for order.');
        }

        const now = new Date();
        const nextTrackingNumber =
          order.shipment.tracking_number ??
          (await this.generateUniqueTrackingNumber(tx, orderId));
        const nextCarrier =
          order.shipment.courier?.trim() &&
          order.shipment.courier.trim().toLowerCase() !== 'pending assignment'
            ? order.shipment.courier
            : this.generateCarrierCode();

        await tx.shipment.update({
          where: { order_id: orderId },
          data: {
            tracking_number: nextTrackingNumber,
            courier: nextCarrier,
            status: 'shipped',
            shipped_at: order.shipment.shipped_at ?? now,
          },
        });
      }

      if (dto.status === 'delivered') {
        if (order.shipment) {
          const now = new Date();
          await tx.shipment.update({
            where: { order_id: orderId },
            data: {
              status: 'delivered',
              delivered_at: order.shipment.delivered_at ?? now,
            },
          });
        }
      }

      return order;
    });

    if (dto.status === 'paid') {
      const tracking = await this.parcelTracking.ensureTrackingForPaidOrder(
        orderId,
        {
          sendEmail: false,
        },
      );
      await this.sendOrderConfirmationEmail(orderId, tracking?.token ?? null);
    }

    const shipment = await this.prisma.shipment.findUnique({
      where: { order_id: orderId },
      select: {
        courier: true,
        tracking_number: true,
        status: true,
        shipped_at: true,
        delivered_at: true,
      },
    });

    return {
      id: updated.order_id,
      order_number: this.toOrderNumber(updated.order_id),
      user: updated.user,
      total_amount: Number(updated.total_amount),
      status: updated.status,
      order_date: updated.order_date,
      shipment: shipment
        ? {
            courier: shipment.courier,
            tracking_number: shipment.tracking_number,
            status: shipment.status,
            shipped_at: shipment.shipped_at,
            delivered_at: shipment.delivered_at,
          }
        : null,
    };
  }

  private async ensureOrder(orderId: number) {
    const existing = await this.prisma.order.findUnique({
      where: { order_id: orderId },
    });
    if (!existing) {
      throw new NotFoundException('Order not found.');
    }
    return existing;
  }

  private async sendOrderConfirmationEmail(
    orderId: number,
    trackingToken: string | null,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      include: {
        user: { select: { email: true, name: true } },
        order_items: {
          include: {
            product: {
              select: {
                title: true,
                product_name: true,
                price: true,
                imgsrc: true,
                image_url: true,
              },
            },
          },
          orderBy: { order_item_id: 'asc' },
        },
        shipment: true,
      },
    });

    if (!order?.user?.email) return;

    const orderNumber = this.toOrderNumber(order.order_id);
    const customerName =
      order.user.name ?? order.user.email.split('@')[0] ?? 'Customer';
    const status = order.status;
    const totalAmount = Number(order.total_amount);

    const itemsHtml = order.order_items
      .map((item) => {
        const title = escapeHtml(
          item.product.title ?? item.product.product_name,
        );
        const qty = item.quantity;
        const subtotal = Number(item.subtotal);
        const unitPrice = Number(item.product.price);
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08)">
              <div style="font-weight:700;color:#ffffff">${title}</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.72)">Qty: ${qty} • Unit: ₱${unitPrice.toFixed(2)}</div>
            </td>
            <td align="right" style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-weight:700;color:#ffffff">₱${subtotal.toFixed(2)}</td>
          </tr>
        `.trim();
      })
      .join('');

    const siteUrl = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
    const ordersLink = siteUrl ? `${siteUrl}/orders` : '';
    const trackingUrl =
      siteUrl && trackingToken ? `${siteUrl}/track-order/${trackingToken}` : '';

    const html = `
      <div style="background:#0b0b0b;padding:24px 0">
        <div style="max-width:680px;margin:0 auto;padding:0 16px;font-family:Arial,Helvetica,sans-serif">
          <div style="background:#111111;border:1px solid rgba(255,214,0,0.25);border-radius:16px;overflow:hidden">
            <div style="padding:18px 20px;background:linear-gradient(135deg,#0b0b0b,#111111)">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:12px;height:12px;border-radius:999px;background:#ffd600;box-shadow:0 0 0 4px rgba(255,214,0,0.15)"></div>
                <div style="font-size:16px;font-weight:800;letter-spacing:0.6px;color:#ffd600;text-transform:uppercase">Katseye</div>
              </div>
              <div style="margin-top:10px;color:#ffffff;font-size:22px;font-weight:800;line-height:1.2">Thank you for your purchase!</div>
              <div style="margin-top:6px;color:rgba(255,255,255,0.78);font-size:13px;line-height:1.5">
                Hi ${escapeHtml(customerName)}, we appreciate you. Your order is confirmed and being processed.
              </div>
            </div>

            <div style="padding:18px 20px">
              <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
                <div style="color:rgba(255,255,255,0.72);font-size:12px">Order</div>
                <div style="color:#ffffff;font-size:14px;font-weight:800">${escapeHtml(orderNumber)}</div>
              </div>
              <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
                <div style="color:rgba(255,255,255,0.72);font-size:12px">Status</div>
                <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,214,0,0.14);border:1px solid rgba(255,214,0,0.35);color:#ffd600;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">
                  ${escapeHtml(status)}
                </div>
              </div>

              <div style="margin-top:18px;border-top:1px solid rgba(255,255,255,0.08)"></div>
              <div style="margin-top:14px;color:#ffffff;font-size:14px;font-weight:800">Order summary</div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse">
                <thead>
                  <tr>
                    <th align="left" style="padding:10px 0;color:rgba(255,255,255,0.72);font-size:12px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.08)">Item</th>
                    <th align="right" style="padding:10px 0;color:rgba(255,255,255,0.72);font-size:12px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.08)">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                  <tr>
                    <td style="padding:14px 0;color:rgba(255,255,255,0.72);font-size:12px">Total</td>
                    <td align="right" style="padding:14px 0;color:#ffffff;font-size:16px;font-weight:900">₱${totalAmount.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:10px">
                ${
                  trackingUrl
                    ? `
                  <a href="${trackingUrl}" style="display:inline-block;background:#ffd600;color:#0b0b0b;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:900;font-size:13px">
                    Track my order
                  </a>
                `.trim()
                    : ''
                }
                ${
                  ordersLink
                    ? `
                  <a href="${ordersLink}" style="display:inline-block;background:transparent;color:#ffd600;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:900;font-size:13px;border:1px solid rgba(255,214,0,0.45)">
                    View my orders
                  </a>
                `.trim()
                    : ''
                }
              </div>
            </div>

            <div style="padding:14px 20px;background:#0e0e0e;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);font-size:11px;line-height:1.5">
              If you didn’t make this purchase, please reply to this email.
            </div>
          </div>
        </div>
      </div>
    `.trim();

    await this.mailer.sendMail({
      to: order.user.email,
      subject: `Thank you for your purchase • ${orderNumber}`,
      html,
    });
  }

  private toOrderNumber(orderId: number) {
    return `ORD-${10000 + orderId}`;
  }

  private async generateUniqueTrackingNumber(
    tx: Prisma.TransactionClient,
    orderId: number,
  ) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const trackingNumber = this.generateTrackingNumber(orderId);
      const exists = await tx.shipment.count({
        where: { tracking_number: trackingNumber },
      });
      if (!exists) return trackingNumber;
    }
    throw new Error('Failed to generate a unique tracking number.');
  }

  private generateTrackingNumber(orderId: number) {
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return `KAT-${10000 + orderId}-${suffix}`;
  }

  private generateCarrierCode() {
    const suffix = randomBytes(2).toString('hex').toUpperCase();
    return `KATSEYE-${suffix}`;
  }

  async getDetails(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      include: {
        user: { select: { user_id: true, email: true, name: true } },
        address: true,
        shipment: { include: { parcel_tracking: true } },
        order_items: {
          include: {
            product: {
              select: {
                product_id: true,
                title: true,
                product_name: true,
                imgsrc: true,
                image_url: true,
                price: true,
              },
            },
          },
          orderBy: { order_item_id: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    return {
      id: order.order_id,
      order_number: this.toOrderNumber(order.order_id),
      order_date: order.order_date,
      status: order.status,
      tracker_status: this.toTrackerStatus(order.status, order.shipment?.status),
      payment_method: order.payment_method,
      total_amount: Number(order.total_amount),
      user: order.user,
      address: order.address,
      shipment: order.shipment
        ? {
            id: order.shipment.shipment_id,
            courier: order.shipment.courier,
            tracking_number: order.shipment.tracking_number,
            shipping_fee: Number(order.shipment.shipping_fee),
            status: order.shipment.status,
            shipped_at: order.shipment.shipped_at,
            delivered_at: order.shipment.delivered_at,
            parcel_tracking: order.shipment.parcel_tracking
              ? {
                  id: order.shipment.parcel_tracking.parcel_tracking_id,
                  token: order.shipment.parcel_tracking.token,
                  eta_date: order.shipment.parcel_tracking.eta_date,
                  destination_address:
                    order.shipment.parcel_tracking.destination_address,
                }
              : null,
          }
        : null,
      items: order.order_items.map((item) => ({
        id: item.order_item_id,
        product: {
          id: item.product.product_id,
          title: item.product.title ?? item.product.product_name,
          imgsrc: item.product.image_url ?? item.product.imgsrc,
          price: Number(item.product.price),
        },
        quantity: item.quantity,
        subtotal: Number(item.subtotal),
      })),
    };
  }

  private toTrackerStatus(orderStatus: string, shipmentStatus?: string | null) {
    const normalized = orderStatus.trim().toLowerCase();
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'delivered') return 'completed';
    if (normalized === 'shipped') return 'dispatched';
    if (normalized === 'pending') return 'new';
    if (normalized === 'paid') {
      if (shipmentStatus?.trim().toLowerCase() === 'awaiting_pickup') {
        return 'awaiting_pickup';
      }
      return 'in_progress';
    }
    return 'in_progress';
  }

  private whereForTab(tab?: OrderTrackerTab): Prisma.orderWhereInput {
    if (!tab || tab === 'all') return {};
    if (tab === 'new') return { status: 'pending' };
    if (tab === 'in_progress') return { status: 'paid' };
    if (tab === 'awaiting_pickup')
      return {
        status: 'paid',
        shipment: { is: { status: 'awaiting_pickup' } },
      };
    if (tab === 'dispatched') return { status: 'shipped' };
    if (tab === 'completed') return { status: 'delivered' };
    if (tab === 'cancelled') return { status: 'cancelled' };
    return {};
  }

  private whereForSearch(search?: string): Prisma.orderWhereInput {
    const q = (search ?? '').trim();
    if (!q) return {};

    const numeric = Number(q.replace(/[^\d]/g, ''));
    const orderId =
      Number.isInteger(numeric) && numeric >= 10000 ? numeric - 10000 : NaN;
    const byOrderId =
      Number.isInteger(orderId) && orderId > 0 ? { order_id: orderId } : null;

    return {
      OR: [
        ...(byOrderId ? [byOrderId] : []),
        { user: { is: { email: { contains: q } } } },
        { user: { is: { name: { contains: q } } } },
      ],
    };
  }

  private todayRange() {
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setHours(0, 0, 0, 0);
    const toDateExclusive = new Date(fromDate);
    toDateExclusive.setDate(toDateExclusive.getDate() + 1);
    return { fromDate, toDateExclusive };
  }

  private parseRange(from?: string, to?: string) {
    if (!from && !to) {
      return this.todayRange();
    }

    const now = new Date();
    const fromDate = from ? this.parseDate(from, 'from') : this.todayRange().fromDate;
    const toDate = to ? this.parseDate(to, 'to') : now;
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
      throw new BadRequestException(
        `${field} must be a valid date (YYYY-MM-DD or ISO string).`,
      );
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
}
