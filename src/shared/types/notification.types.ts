import { NotificationType, RelatedType } from './common.types';
import type { ProviderId } from './provider.types';

export interface Notification {
  id: number;
  userId: number;
  /** The provider the notification is about; absent for app-wide notifications. */
  providerId?: ProviderId;
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: number;
  relatedType?: RelatedType;
  actionUrl?: string;
  isRead: boolean;
  createdAt: Date;
}

export interface NotificationInput {
  userId: number;
  providerId?: ProviderId;
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: number;
  relatedType?: RelatedType;
  actionUrl?: string;
}
