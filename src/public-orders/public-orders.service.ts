import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type TrackerEvent = {
  key:
    | 'created'
    | 'new'
    | 'in_progress'
    | 'awaiting_pickup'
    | 'dispatched'
    | 'completed'
    | 'cancelled';
  label: string;
  at: Date;
};

@Injectable()
export class PublicOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async trackByToken(token: string) {
    const normalized = token?.trim();
    if (!normalized) return null;

    const tracking = await this.prisma.parcel_tracking.findUnique({
      where: { token: normalized },
      include: {
        shipment: {
          include: {
            order: {
              include: {
                user: { select: { email: true } },
                address: true,
              },
            },
          },
        },
      },
    });

    if (!tracking?.shipment?.order) return null;

    const order = tracking.shipment.order;
    const shipment = tracking.shipment;

    const orderNumber = this.toOrderNumber(order.order_id);
    const trackerStatus = this.toTrackerStatus(
      order.status,
      shipment.status,
    );

    const timeline = this.buildTimeline({
      orderDate: order.order_date,
      orderStatus: order.status,
      shippedAt: shipment.shipped_at,
      deliveredAt: shipment.delivered_at,
    });

    return {
      order_number: orderNumber,
      status: order.status,
      tracker_status: trackerStatus,
      order_date: order.order_date,
      customer_email: tracking.customer_email ?? order.user?.email ?? null,
      address: order.address,
      timeline: timeline.length ? timeline : [],
      shipment: {
        carrier: shipment.courier,
        tracking_number: shipment.tracking_number,
      },
    };
  }

  private buildTimeline(input: {
    orderDate: Date;
    orderStatus: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  }): TrackerEvent[] {
    const events: TrackerEvent[] = [
      { key: 'created', label: 'Order created', at: input.orderDate },
    ];

    const normalized = input.orderStatus.trim().toLowerCase();
    if (normalized === 'cancelled') {
      events.push({
        key: 'cancelled',
        label: 'Order cancelled',
        at: input.orderDate,
      });
      return events;
    }

    if (normalized === 'pending') {
      events.push({ key: 'new', label: 'New', at: input.orderDate });
    }
    if (normalized === 'paid') {
      events.push({ key: 'in_progress', label: 'In progress', at: input.orderDate });
    }
    if (input.shippedAt) {
      events.push({ key: 'dispatched', label: 'Dispatched', at: input.shippedAt });
    }
    if (input.deliveredAt) {
      events.push({ key: 'completed', label: 'Completed', at: input.deliveredAt });
    }

    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private toTrackerStatus(
    orderStatus: string,
    shipmentStatus?: string | null,
  ) {
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

  private toOrderNumber(orderId: number) {
    return `ORD-${10000 + orderId}`;
  }
}
