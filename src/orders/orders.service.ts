import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParcelTrackingService } from '../parcels/parcel-tracking.service';
import { MailerService } from '../mailer/mailer.service';
import { CheckoutOrderDto } from './dto/checkout-order.dto';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parcelTracking: ParcelTrackingService,
    private readonly mailer: MailerService,
  ) {}

  rejectNonCancelStatus() {
    throw new BadRequestException('Only status=cancelled is supported.');
  }

  async checkout(userId: number, dto: CheckoutOrderDto) {
    const cart = await this.prisma.cart.findUnique({
      where: { user_id: userId },
      include: {
        cart_items: {
          include: {
            product: true,
          },
          orderBy: { cart_item_id: 'asc' },
        },
      },
    });

    if (!cart || cart.cart_items.length === 0) {
      throw new BadRequestException('Cart is empty.');
    }

    const shippingFee = dto.shipping_fee ?? 0;
    const paymentMethod = (dto.payment_method ?? '').trim().toLowerCase();
    const requestedStatus = dto.status ?? 'pending';
    const initialStatus: 'pending' | 'paid' =
      paymentMethod === 'cod'
        ? 'pending'
        : requestedStatus === 'paid'
          ? 'paid'
          : 'pending';

    const createdOrder = await this.prisma.$transaction(async (tx) => {
      const addressId = await this.resolveAddressId(tx, userId, dto);

      let itemsTotal = 0;
      for (const item of cart.cart_items) {
        const product = await tx.product.findUnique({
          where: { product_id: item.product_id },
          include: {
            variants: {
              select: { variant_id: true, stock: true },
              orderBy: { variant_id: 'asc' },
            },
          },
        });

        if (!product) {
          throw new BadRequestException(
            'A product in your cart no longer exists.',
          );
        }

        const effectiveStock = product.variants.length
          ? product.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
          : product.stock;

        if (effectiveStock < item.quantity) {
          throw new BadRequestException(
            `${item.product.title ?? item.product.product_name} does not have enough stock.`,
          );
        }

        if (product.variants.length) {
          let remaining = item.quantity;
          for (const variant of product.variants) {
            if (remaining <= 0) break;
            if ((variant.stock ?? 0) <= 0) continue;

            const take = Math.min(remaining, variant.stock ?? 0);
            const updated = await tx.product_variant.updateMany({
              where: {
                variant_id: variant.variant_id,
                stock: { gte: take },
              },
              data: { stock: { decrement: take } },
            });

            if (updated.count === 0) {
              // Another checkout could have taken the stock.
              continue;
            }

            remaining -= take;
          }

          if (remaining > 0) {
            throw new BadRequestException(
              `${item.product.title ?? item.product.product_name} is out of stock.`,
            );
          }

          // Keep product.stock aligned with total variant stock for store/admin UIs.
          const totals = await tx.product_variant.aggregate({
            where: { product_id: product.product_id },
            _sum: { stock: true },
          });
          await tx.product.update({
            where: { product_id: product.product_id },
            data: { stock: totals._sum.stock ?? 0 },
          });
        } else {
          const decreased = await tx.product.updateMany({
            where: {
              product_id: item.product_id,
              stock: {
                gte: item.quantity,
              },
            },
            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

          if (decreased.count === 0) {
            throw new BadRequestException(
              `${item.product.title ?? item.product.product_name} is out of stock.`,
            );
          }
        }

        itemsTotal += Number(item.product.price) * item.quantity;
      }

      const order = await tx.order.create({
        data: {
          user_id: userId,
          address_id: addressId,
          payment_method: dto.payment_method,
          total_amount: itemsTotal + shippingFee,
          status: initialStatus,
          order_items: {
            create: cart.cart_items.map((item) => ({
              product_id: item.product_id,
              quantity: item.quantity,
              subtotal: Number(item.product.price) * item.quantity,
            })),
          },
          shipment: {
            create: {
              courier: dto.courier ?? 'Pending assignment',
              shipping_fee: shippingFee,
              status: 'processing',
            },
          },
        },
        include: {
          address: true,
          shipment: true,
          order_items: {
            include: {
              product: true,
            },
          },
          user: { select: { email: true, name: true } },
        },
      });

      await tx.cart_item.deleteMany({
        where: {
          cart_id: cart.cart_id,
        },
      });

      return this.toOrderResponse(order);
    });

    const tracking = await this.parcelTracking.ensureTrackingForPaidOrder(
      createdOrder.id,
      {
        // The order confirmation email already includes the tracking link.
        sendEmail: false,
      },
    );
    const trackingToken = tracking?.token ?? null;

    await this.sendOrderConfirmationEmail(createdOrder.id, trackingToken);

    return createdOrder;
  }

  private async sendOrderConfirmationEmail(
    orderId: number,
    trackingToken: string | null,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      include: {
        user: { select: { email: true, name: true } },
        address: true,
        order_items: {
          include: {
            product: {
              select: { title: true, product_name: true, price: true },
            },
          },
          orderBy: { order_item_id: 'asc' },
        },
      },
    });

    if (!order) return;

    const toEmail = order.address?.email ?? order.user?.email;
    if (!toEmail) return;

    const orderNumber = `ORD-${10000 + order.order_id}`;
    const customerName =
      order.user?.name ?? toEmail.split('@')[0] ?? 'Customer';
    const totalAmount = Number(order.total_amount);

    const itemsHtml = order.order_items
      .map((item) => {
        const title = escapeHtml(
          item.product.title ?? item.product.product_name,
        );
        const qty = item.quantity;
        const unitPrice = Number(item.product.price);
        const subtotal = Number(item.subtotal);
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
    const trackingUrl =
      siteUrl && trackingToken ? `${siteUrl}/track-order/${trackingToken}` : '';
    const ordersLink = siteUrl ? `${siteUrl}/orders` : '';

    const isPaid = (order.status ?? '').toLowerCase() === 'paid';
    const headline = isPaid
      ? 'Thank you for your purchase!'
      : 'We received your order!';
    const subtitle = isPaid
      ? `Hi ${escapeHtml(customerName)}, we appreciate you. Your order is confirmed and being processed.`
      : `Hi ${escapeHtml(customerName)}, thanks! Your order is received and pending confirmation.`;

    const html = `
      <div style="background:#0b0b0b;padding:24px 0">
        <div style="max-width:680px;margin:0 auto;padding:0 16px;font-family:Arial,Helvetica,sans-serif">
          <div style="background:#111111;border:1px solid rgba(255,214,0,0.25);border-radius:16px;overflow:hidden">
            <div style="padding:18px 20px;background:linear-gradient(135deg,#0b0b0b,#111111)">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:12px;height:12px;border-radius:999px;background:#ffd600;box-shadow:0 0 0 4px rgba(255,214,0,0.15)"></div>
                <div style="font-size:16px;font-weight:800;letter-spacing:0.6px;color:#ffd600;text-transform:uppercase">Katseye</div>
              </div>
              <div style="margin-top:10px;color:#ffffff;font-size:22px;font-weight:800;line-height:1.2">${headline}</div>
              <div style="margin-top:6px;color:rgba(255,255,255,0.78);font-size:13px;line-height:1.5">${subtitle}</div>
            </div>

            <div style="padding:18px 20px">
              <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
                <div style="color:rgba(255,255,255,0.72);font-size:12px">Order</div>
                <div style="color:#ffffff;font-size:14px;font-weight:800">${escapeHtml(orderNumber)}</div>
              </div>
              <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
                <div style="color:rgba(255,255,255,0.72);font-size:12px">Status</div>
                <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,214,0,0.14);border:1px solid rgba(255,214,0,0.35);color:#ffd600;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">
                  ${escapeHtml(order.status)}
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
      to: toEmail,
      subject: `${isPaid ? 'Thank you for your purchase' : 'Order received'} • ${orderNumber}`,
      html,
    });
  }

  async findMyOrders(userId: number) {
    const orders = await this.prisma.order.findMany({
      where: { user_id: userId },
      include: {
        address: true,
        shipment: true,
        order_items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        order_date: 'desc',
      },
    });

    return orders.map((order) => this.toOrderResponse(order));
  }

  async cancelMyOrder(userId: number, orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      select: {
        order_id: true,
        user_id: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    if (order.user_id !== userId) {
      throw new ForbiddenException('You do not have access to this order.');
    }

    const cancellableStatuses = new Set(['pending', 'processing']);
    if (!cancellableStatuses.has(order.status)) {
      throw new ConflictException(
        `Order cannot be cancelled when status is '${order.status}'.`,
      );
    }

    await this.prisma.order.update({
      where: { order_id: orderId },
      data: { status: 'cancelled' },
    });

    return { id: orderId, status: 'cancelled' };
  }

  private async resolveAddressId(
    tx: Prisma.TransactionClient,
    userId: number,
    dto: CheckoutOrderDto,
  ) {
    if (dto.address_id) {
      const address = await tx.address.findFirst({
        where: {
          address_id: dto.address_id,
          user_id: userId,
        },
      });

      if (!address) {
        throw new NotFoundException('Address not found.');
      }

      return address.address_id;
    }

    if (!dto.address) {
      throw new BadRequestException('An address or address_id is required.');
    }

    const address = await tx.address.create({
      data: {
        user_id: userId,
        ...dto.address,
      },
    });

    return address.address_id;
  }

  private toOrderResponse(order: {
    order_id: number;
    order_date: Date;
    payment_method: string;
    total_amount: unknown;
    status: string;
    address: {
      address_id: number;
      street: string;
      city: string;
      province: string;
      zip_code: string;
      country: string;
    };
    shipment: {
      shipment_id: number;
      courier: string;
      tracking_number: string | null;
      shipping_fee: unknown;
      status: string;
      shipped_at: Date | null;
      delivered_at: Date | null;
    } | null;
    order_items: Array<{
      order_item_id: number;
      quantity: number;
      subtotal: unknown;
      product: {
        product_id: number;
        product_name: string;
        title: string | null;
        imgsrc: string | null;
        price: unknown;
      };
    }>;
  }) {
    return {
      id: order.order_id,
      order_date: order.order_date,
      payment_method: order.payment_method,
      total_amount: Number(order.total_amount),
      status: order.status,
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
          }
        : null,
      items: order.order_items.map((item) => ({
        id: item.order_item_id,
        quantity: item.quantity,
        subtotal: Number(item.subtotal),
        product: {
          id: item.product.product_id,
          title: item.product.title ?? item.product.product_name,
          imgsrc: item.product.imgsrc,
          price: Number(item.product.price),
        },
      })),
    };
  }
}
