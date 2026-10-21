import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BookingStatus } from '../entities/booking.entity.js';

export class ListBookingsDto {
  @IsOptional()
  @IsEnum(BookingStatus, { message: 'Trạng thái đơn không hợp lệ' })
  status?: BookingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
