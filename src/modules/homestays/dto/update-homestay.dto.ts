import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { CancellationPolicy, HomestayStatus } from '../entities/homestay.entity.js';

export class UpdateHomestayDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  crawled_phone?: string;

  @IsOptional()
  @IsEnum(CancellationPolicy)
  cancellation_policy?: CancellationPolicy;

  @IsOptional()
  amenities_json?: Record<string, any>;

  @IsOptional()
  property_images?: string[];

  @IsOptional()
  @IsString()
  main_image_url?: string;

  @IsOptional()
  rules_json?: Record<string, any>;

  @IsOptional()
  @IsEnum(HomestayStatus)
  status?: HomestayStatus;
}
