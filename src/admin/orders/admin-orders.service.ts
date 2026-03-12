import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
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
    const updated = await this.prisma.order.update({
      where: { order_id: orderId },
      data: { status: dto.status },
      include: {
        user: { select: { user_id: true, email: true, name: true } },
      },
    });

    if (dto.status === 'paid') {
      const tracking = await this.parcelTracking.ensureTrackingForPaidOrder(orderId, {
        sendEmail: false,
      });
      await this.sendOrderConfirmationEmail(orderId, tracking?.token ?? null);
    }

    return {
      id: updated.order_id,
      order_number: this.toOrderNumber(updated.order_id),
      user: updated.user,
      total_amount: Number(updated.total_amount),
      status: updated.status,
      order_date: updated.order_date,
    };
  }

  private async ensureOrder(orderId: number) {
    const existing = await this.prisma.order.findUnique({ where: { order_id: orderId } });
    if (!existing) {
      throw new NotFoundException('Order not found.');
    }
    return existing;
  }

  private async sendOrderConfirmationEmail(orderId: number, trackingToken: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      include: {
        user: { select: { email: true, name: true } },
        order_items: {
          include: {
            product: { select: { title: true, product_name: true, price: true, imgsrc: true, image_url: true } },
          },
          orderBy: { order_item_id: 'asc' },
        },
        shipment: true,
      },
    });

    if (!order?.user?.email) return;

    const orderNumber = this.toOrderNumber(order.order_id);
    const customerName = order.user.name ?? order.user.email.split('@')[0] ?? 'Customer';
    const status = order.status;
    const totalAmount = Number(order.total_amount);

    const itemsHtml = order.order_items
      .map((item) => {
        const title = escapeHtml(item.product.title ?? item.product.product_name);
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
      siteUrl && trackingToken ? `${siteUrl}/track/${trackingToken}` : '';

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
}
