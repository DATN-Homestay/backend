import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { PaginationQueryDto } from './admin-query.dto.js';
import { HomestayStatus } from '../../homestays/entities/homestay.entity.js';

// ─── Query / Filter ────────────────────────────────────────────────

export class AdminListHomestaysQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(HomestayStatus)
  status?: HomestayStatus;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  is_claimed?: number;

  @IsOptional()
  @IsString()
  host_id?: string;
}

// ─── Update trạng thái homestay ────────────────────────────────────

export class AdminUpdateHomestayStatusDto {
  @IsEnum(HomestayStatus, {
    message: 'Trạng thái phải là DRAFT, PENDING_VERIFICATION, ACTIVE hoặc BANNED',
  })
  status: HomestayStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ─── Gán Host cho Homestay ─────────────────────────────────────────

export class AdminAssignHostDto {
  @IsString({ message: 'host_id phải là chuỗi số' })
  host_id: string;
}

// ─── Admin cập nhật thông tin homestay ──────────────────────────────

export class AdminUpdateHomestayDto {
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
  @IsEnum(HomestayStatus)
  status?: HomestayStatus;

  @IsOptional()
  amenities_json?: Record<string, any>;

  @IsOptional()
  rules_json?: Record<string, any>;
}
