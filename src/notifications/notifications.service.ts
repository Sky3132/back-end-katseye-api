import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

type NotificationEntity = {
  id: string;
  title: string;
  details: string;
  time: string;
  createdAt?: string;
};

type NotificationEvent = {
  action: 'created' | 'updated' | 'deleted';
  notification: NotificationEntity;
};

@Injectable()
export class NotificationsService {
  private readonly apiUrl =
    'https://69a9318232e2d46caf457de9.mockapi.io/api/users/notification';
  private readonly notificationStream = new Subject<NotificationEvent>();

  stream(): Observable<NotificationEvent> {
    return this.notificationStream.asObservable();
  }

  async findAll() {
    return this.request<NotificationEntity[]>('');
  }

  async create(dto: CreateNotificationDto) {
    const payload = {
      title: dto.title,
      details: dto.details,
      time: dto.time ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const created = await this.request<NotificationEntity>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    this.notificationStream.next({ action: 'created', notification: created });
    return created;
  }

  async update(id: string, dto: UpdateNotificationDto) {
    const updated = await this.request<NotificationEntity>(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });

    this.notificationStream.next({ action: 'updated', notification: updated });
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.request<NotificationEntity>(`/${id}`, {
      method: 'DELETE',
    });

    this.notificationStream.next({ action: 'deleted', notification: deleted });
    return { message: 'Notification deleted successfully.' };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, init);
    } catch {
      throw new InternalServerErrorException(
        'Failed to reach notification API.',
      );
    }

    if (response.status === 404) {
      throw new NotFoundException('Notification not found.');
    }

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Notification API request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  }
}
