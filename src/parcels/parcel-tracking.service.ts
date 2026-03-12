import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class ParcelTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async ensureTrackingForPaidOrder(
    orderId: number,
    options?: { sendEmail?: boolean },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { order_id: orderId },
      include: {
        user: { select: { email: true, name: true } },
        address: true,
        shipment: {
          include: {
            parcel_tracking: true,
          },
        },
      },
    });

    if (!order?.shipment) return null;
    if (order.shipment.parcel_tracking) return order.shipment.parcel_tracking;

    const destinationAddress = this.formatAddress(order.address);
    const customerEmail = order.user.email;

    const created = await this.createUniqueTracking({
      orderId: order.order_id,
      customerEmail,
      destinationAddress,
    });

    if (options?.sendEmail !== false) {
      await this.sendTrackingEmail({
        to: customerEmail,
        orderId: order.order_id,
        token: created.token,
      });
    }

    return created;
  }

  private async createUniqueTracking(input: {
    orderId: number;
    customerEmail: string;
    destinationAddress: string;
  }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = this.generateToken();
      try {
        return await this.prisma.parcel_tracking.create({
          data: {
            order_id: input.orderId,
            token,
            customer_email: input.customerEmail,
            destination_address: input.destinationAddress,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Failed to generate a unique tracking token.');
  }

  private generateToken() {
    return randomBytes(24).toString('base64url');
  }

  private formatAddress(address: {
    street: string;
    city: string;
    province: string;
    zip_code: string;
    country: string;
    barangay: string | null;
    region: string | null;
    full_name: string | null;
  }) {
    const parts = [
      address.full_name,
      address.street,
      address.barangay,
      address.city,
      address.province,
      address.region,
      address.zip_code,
      address.country,
    ].filter(Boolean);

    return parts.join(', ');
  }

  private async sendTrackingEmail(input: {
    to: string;
    orderId: number;
    token: string;
  }) {
    const siteUrl = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
    const link = siteUrl
      ? `${siteUrl}/track/${input.token}`
      : `/track/${input.token}`;

    const subject = 'Track your Katseye parcel';
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5">
        <p>Thank you for your purchase.</p>
        <p>Click below to track your parcel.</p>
        <p>
          <a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none">
            Track parcel
          </a>
        </p>
        <p style="color:#666;font-size:12px">Order #${10000 + input.orderId}</p>
      </div>
    `.trim();

    await this.mailer.sendMail({ to: input.to, subject, html });
  }
}
