import { CancellationPolicy, HomestayStatus } from '../entities/homestay.entity.js';

export class CreateHomestayDto {
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  crawled_phone?: string;
  cancellation_policy?: CancellationPolicy;
  amenities_json?: Record<string, any>;
  rules_json?: Record<string, any>;
  status?: HomestayStatus;
}
