import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicParcelsService {
  constructor(private readonly prisma: PrismaService) {}

  async trackByToken(token: string) {
    const normalized = token?.trim();
    if (!normalized) return null;

    const tracking = await this.prisma.parcel_tracking.findUnique({
      where: { token: normalized },
      include: {
        shipment: {
          select: {
            status: true,
            tracking_number: true,
            courier: true,
            shipped_at: true,
            delivered_at: true,
          },
        },
      },
    });

    if (!tracking) return null;

    return {
      etaDate: tracking.eta_date,
      status: tracking.shipment.status,
      customerEmail: tracking.customer_email,
      destinationAddress: tracking.destination_address,
      destinationLat: tracking.destination_lat
        ? Number(tracking.destination_lat)
        : null,
      destinationLng: tracking.destination_lng
        ? Number(tracking.destination_lng)
        : null,
      courier: tracking.shipment.courier,
      trackingNumber: tracking.shipment.tracking_number,
      shippedAt: tracking.shipment.shipped_at,
      deliveredAt: tracking.shipment.delivered_at,
    };
  }
}
