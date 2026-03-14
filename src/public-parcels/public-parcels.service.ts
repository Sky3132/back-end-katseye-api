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

  async trackByTrackingNumber(trackingNumber: string) {
    const normalized = trackingNumber?.trim();
    if (!normalized) return null;

    const shipment = await this.prisma.shipment.findFirst({
      where: { tracking_number: normalized },
      include: {
        parcel_tracking: true,
        order: {
          include: {
            user: { select: { email: true } },
            address: true,
          },
        },
      },
    });

    if (!shipment) return null;

    const fallbackDestination = shipment.order?.address
      ? this.formatAddress(shipment.order.address)
      : null;

    return {
      etaDate: shipment.parcel_tracking?.eta_date ?? null,
      status: shipment.status,
      customerEmail:
        shipment.parcel_tracking?.customer_email ??
        shipment.order?.user?.email ??
        null,
      destinationAddress:
        shipment.parcel_tracking?.destination_address ??
        fallbackDestination ??
        null,
      destinationLat: shipment.parcel_tracking?.destination_lat
        ? Number(shipment.parcel_tracking.destination_lat)
        : null,
      destinationLng: shipment.parcel_tracking?.destination_lng
        ? Number(shipment.parcel_tracking.destination_lng)
        : null,
      courier: shipment.courier,
      trackingNumber: shipment.tracking_number,
      shippedAt: shipment.shipped_at,
      deliveredAt: shipment.delivered_at,
    };
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
}
