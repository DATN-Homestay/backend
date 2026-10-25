import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { CancellationPolicy, HomestayStatus } from '../entities/homestay.entity.js';

export class CreateHomestayDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên homestay không được để trống' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Địa chỉ không được để trống' })
  address: string;

  @IsString()
  @IsNotEmpty({ message: 'Tỉnh/Thành phố không được để trống' })
  city: string;

  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @IsNumber()
  @IsNotEmpty()
  longitude: number;

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
