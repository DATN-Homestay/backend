import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { RefundStatus } from '../entities/refund-transaction.entity.js';

export class ListRefundsDto {
  @IsOptional()
  @IsEnum(RefundStatus, { message: 'Trạng thái hoàn tiền không hợp lệ' })
  status?: RefundStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ManualRefundDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 500, { message: 'Ghi chú phải từ 5 đến 500 ký tự (VD: mã giao dịch chuyển khoản)' })
  note: string;
}
