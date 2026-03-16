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

      const normalizeCurrency = (value: string | null | undefined) => {
        const v = (value ?? '').trim().toUpperCase();
        return v === 'USD' || v === 'PHP' || v === 'JPY' || v === 'KRW'
          ? (v as 'USD' | 'PHP' | 'JPY' | 'KRW')
          : null;
      };

      const inferDisplayCurrencyFromCountry = (countryCode2: string | null) => {
        const cc = (countryCode2 ?? '').trim().toUpperCase();
        if (cc === 'PH') return 'PHP' as const;
        if (cc === 'JP') return 'JPY' as const;
        if (cc === 'KR') return 'KRW' as const;
        return null;
      };

      const roundForCurrency = (
        currency: 'USD' | 'PHP' | 'JPY' | 'KRW',
        amount: number,
      ) => {
        const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
        const factor = 10 ** digits;
        return Math.round(amount * factor) / factor;
      };

      let displayCurrency = normalizeCurrency(dto.display_currency);
      if (!displayCurrency) {
        const cc =
          (dto.address?.country_code ?? '').trim() !== ''
            ? dto.address?.country_code ?? null
            : (
                await tx.address.findUnique({
                  where: { address_id: addressId },
                  select: { country_code: true },
                })
              )?.country_code ?? null;
        displayCurrency = inferDisplayCurrencyFromCountry(cc);
      }

      const fxRateUsdToDisplay =
        displayCurrency && displayCurrency !== 'USD'
          ? this.getUsdFxRate(displayCurrency)
          : null;
      if (displayCurrency && displayCurrency !== 'USD' && !fxRateUsdToDisplay) {
        throw new BadRequestException(
          `FX rate for ${displayCurrency} is not configured. Set FX_RATES_USD_JSON in backend .env.`,
        );
      }

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
          display_currency: displayCurrency,
          fx_rate_usd_to_display: fxRateUsdToDisplay,
          approx_total_display: fxRateUsdToDisplay
            ? roundForCurrency(
                displayCurrency ?? 'USD',
                (itemsTotal + shippingFee) * fxRateUsdToDisplay,
              )
            : null,
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

    const displayCurrency = (order.display_currency ?? '').trim().toUpperCase();
    const preferredDisplayCurrency =
      displayCurrency === 'PHP' ||
      displayCurrency === 'JPY' ||
      displayCurrency === 'KRW' ||
      displayCurrency === 'USD'
        ? (displayCurrency as 'USD' | 'PHP' | 'JPY' | 'KRW')
        : null;

    const approxCurrency =
      preferredDisplayCurrency && preferredDisplayCurrency !== 'USD'
        ? preferredDisplayCurrency
        : null;
    const persistedRate = Number((order as { fx_rate_usd_to_display?: unknown }).fx_rate_usd_to_display);
    const usdToApproxRate =
      approxCurrency && Number.isFinite(persistedRate) && persistedRate > 0
        ? persistedRate
        : approxCurrency
          ? this.getUsdFxRate(approxCurrency)
          : null;

    const formatMoney = (
      currency: 'USD' | 'PHP' | 'JPY' | 'KRW',
      amount: number,
    ) => {
      const locale =
        currency === 'PHP'
          ? 'en-PH'
          : currency === 'JPY'
            ? 'ja-JP'
            : currency === 'KRW'
              ? 'ko-KR'
              : 'en-US';
      const fractionDigits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(amount);
    };

    const itemsHtml = order.order_items
      .map((item) => {
        const title = escapeHtml(
          item.product.title ?? item.product.product_name,
        );
        const qty = item.quantity;
        const unitPriceUsd = Number(item.product.price);
        const subtotalUsd = Number(item.subtotal);
        const unitPriceApprox =
          usdToApproxRate && approxCurrency
            ? unitPriceUsd * usdToApproxRate
            : null;
        const subtotalApprox =
          usdToApproxRate && approxCurrency
            ? subtotalUsd * usdToApproxRate
            : null;
        const approxUnitLine =
          unitPriceApprox !== null && approxCurrency
            ? ` (≈ ${escapeHtml(formatMoney(approxCurrency, unitPriceApprox))})`
            : '';
        const approxSubtotalLine =
          subtotalApprox !== null && approxCurrency
            ? `<br/><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.72)">(≈ ${escapeHtml(formatMoney(approxCurrency, subtotalApprox))})</span>`
            : '';
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08)">
              <div style="font-weight:700;color:#ffffff">${title}</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.72)">
                Qty: ${qty} &bull; Unit: ${escapeHtml(formatMoney('USD', unitPriceUsd))}${approxUnitLine}
              </div>
            </td>
            <td align="right" style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-weight:700;color:#ffffff">
              ${escapeHtml(formatMoney('USD', subtotalUsd))}${approxSubtotalLine}
            </td>
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
                    <td align="right" style="padding:14px 0;color:#ffffff;font-size:16px;font-weight:900">
                      ${escapeHtml(formatMoney('USD', totalAmount))}
                      ${
                        usdToApproxRate && approxCurrency
                          ? `<br/><span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.72)">(≈ ${escapeHtml(formatMoney(approxCurrency, totalAmount * usdToApproxRate))})</span>`
                          : ''
                      }
                    </td>
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

  private getUsdFxRate(currency: 'PHP' | 'JPY' | 'KRW'): number | null {
    const raw = (process.env.FX_RATES_USD_JSON ?? '').trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = Number(parsed?.[currency]);
      if (Number.isFinite(value) && value > 0) return value;
      return null;
    } catch {
      return null;
    }
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

      const incomingPhone = dto.address?.phone;
      if (incomingPhone != null) {
        const phoneE164 = await this.normalizePhoneToE164(
          tx,
          incomingPhone,
          dto.address?.country_code ?? address.country_code ?? null,
        );

        if (phoneE164) {
          await tx.address.update({
            where: { address_id: address.address_id },
            data: { phone_e164: phoneE164 },
          });
        }
      }

      return address.address_id;
    }

    if (!dto.address) {
      throw new BadRequestException('An address or address_id is required.');
    }

    const phoneE164 = await this.normalizePhoneToE164(
      tx,
      dto.address.phone,
      dto.address.country_code ?? null,
    );

    const address = await tx.address.create({
      data: {
        user_id: userId,
        full_name: dto.address.full_name,
        email: dto.address.email,
        phone_e164: phoneE164,
        country: dto.address.country ?? '',
        region: dto.address.region ?? null,
        province: dto.address.province ?? '',
        city: dto.address.city ?? '',
        barangay: dto.address.barangay ?? null,
        zip_code: dto.address.zip_code,
        street: dto.address.street,
      },
    });

    return address.address_id;
  }

  private async normalizePhoneToE164(
    tx: Prisma.TransactionClient,
    input: string | null | undefined,
    countryCode2: string | null,
  ): Promise<string | null> {
    const value = (input ?? '').trim();
    if (value === '') return null;

    const compact = value.replace(/[^\d+]/g, '');
    if (compact === '' || compact === '+') {
      throw new BadRequestException('Phone number is invalid.');
    }

    if (compact.startsWith('+')) {
      const digits = compact.slice(1).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        throw new BadRequestException('Phone number is invalid.');
      }
      return `+${digits}`;
    }

    if (compact.startsWith('00')) {
      const digits = compact.slice(2).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        throw new BadRequestException('Phone number is invalid.');
      }
      return `+${digits}`;
    }

    const digitsOnly = compact.replace(/\D/g, '');
    if (digitsOnly.length < 6) {
      throw new BadRequestException('Phone number is invalid.');
    }

    const cc = (countryCode2 ?? '').trim().toUpperCase();
    const callingCode =
      cc.length === 2
        ? (await tx.calling_code.findUnique({
            where: { country_code: cc },
            select: { calling_code: true },
          }))?.calling_code ?? null
        : null;

    if (!callingCode) {
      throw new BadRequestException(
        'Phone number must be in E.164 format (example: +639...).',
      );
    }

    let national = digitsOnly;
    if (national.startsWith('0')) national = national.slice(1);

    const e164Digits = `${callingCode}${national}`;
    if (e164Digits.length < 8 || e164Digits.length > 15) {
      throw new BadRequestException('Phone number is invalid.');
    }

    return `+${e164Digits}`;
  }

  private toOrderResponse(order: {
    order_id: number;
    order_date: Date;
    payment_method: string;
    total_amount: unknown;
    display_currency?: string | null;
    fx_rate_usd_to_display?: unknown;
    approx_total_display?: unknown;
    status: string;
    address: {
      address_id: number;
      street: string;
      city: string;
      province: string;
      zip_code: string;
      country: string;
      phone_e164?: string | null;
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
      display_currency: (order.display_currency ?? null) as string | null,
      fx_rate_usd_to_display:
        order.fx_rate_usd_to_display === undefined ||
        order.fx_rate_usd_to_display === null
          ? null
          : Number(order.fx_rate_usd_to_display),
      approx_total_display:
        order.approx_total_display === undefined ||
        order.approx_total_display === null
          ? null
          : Number(order.approx_total_display),
      status: order.status,
      address: {
        address_id: order.address.address_id,
        street: order.address.street,
        city: order.address.city,
        province: order.address.province,
        zip_code: order.address.zip_code,
        country: order.address.country,
        phone_e164: order.address.phone_e164 ?? null,
      },
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
